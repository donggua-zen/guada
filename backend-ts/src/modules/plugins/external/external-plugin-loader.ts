import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import Module from "module";
import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { PluginManager } from "../plugin.manager";
import { PluginBase } from "../base-plugin";
import { PluginManifest } from "../types/plugin.types";
import { NlsService } from "../i18n/nls.service";
import { EventBusService } from "../../../common/events/event-bus.service";
import { parsePluginSource } from "./plugin-source";

const execFile = promisify(execFileCb);

interface ExternalManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
  category?: "system" | "core" | "extended" | "user";
  icon?: string;
  main?: string;
}

@Injectable()
export class ExternalPluginLoader implements OnModuleInit {
  private readonly logger = new Logger(ExternalPluginLoader.name);
  private pluginPaths = new Map<string, { dir: string; source: "dev" | "user" }>();
  private requireQueue: Promise<void> = Promise.resolve();
  /** 安装 job 队列（前端轮询日志/取消） */
  private installJobs = new Map<
    string,
    {
      log: string[];
      done: boolean;
      result?: { success: boolean; id?: string };
      controller?: AbortController;
    }
  >();

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly configService: ConfigService,
    private readonly nlsService: NlsService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit() {
    await this.loadAllExternalPlugins();
  }

  private getScanDirs(): Array<{ dir: string; source: "dev" | "user" }> {
    const dirs: Array<{ dir: string; source: "dev" | "user" }> = [];

    // 用户安装目录（始终扫描）
    const userDir = this.configService.get<string>("PLUGINS_USER_DIR");
    if (userDir) dirs.push({ dir: userDir, source: "user" });

    // 开发目录（仅 dev 模式有值）
    const devDir = this.configService.get<string>("PLUGINS_DEV_DIR");
    if (devDir) dirs.push({ dir: devDir, source: "dev" });

    return dirs;
  }

  async loadAllExternalPlugins(): Promise<void> {
    for (const { dir, source } of this.getScanDirs()) {
      if (!fs.existsSync(dir)) {
        this.logger.log(`Plugin directory not found, skipping: ${dir} (${source})`);
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        this.logger.error(`Failed to read plugin directory ${dir}: ${err.message}`);
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const pluginDir = path.join(dir, entry.name);
        try {
          await this.loadExternalPlugin(pluginDir, source);
        } catch (err: any) {
          this.logger.error(
            `Failed to load external plugin from ${pluginDir}: ${err.message}`,
          );
        }
      }
    }
  }

  async loadExternalPlugin(
    pluginDir: string,
    source: "dev" | "user",
  ): Promise<void> {
    // 1. 读取 manifest.json
    const manifestPath = path.join(pluginDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      this.logger.warn(`No manifest.json in ${pluginDir}, skipping`);
      return;
    }

    let manifest: ExternalManifest;
    try {
      manifest = JSON.parse(
        await fs.promises.readFile(manifestPath, "utf-8"),
      );
    } catch (err: any) {
      throw new Error(`Invalid manifest.json: ${err.message}`);
    }

    // 2. 校验 manifest
    this.validateManifest(manifest);

    // 3. 检查 id 冲突（内建插件优先）
    if (this.pluginManager.getPlugin(manifest.id)) {
      this.logger.warn(
        `Plugin ${manifest.id} already registered (builtin?), skipping external`,
      );
      return;
    }

    // 4. 检查依赖
    if (manifest.dependencies && manifest.dependencies.length > 0) {
      for (const depId of manifest.dependencies) {
        if (!this.pluginManager.getPlugin(depId)) {
          throw new Error(`Missing dependency: ${depId}`);
        }
      }
    }

    // 5. 确定入口文件
    const mainFile = manifest.main || "index.js";
    const entryPath = this.resolveEntry(pluginDir, mainFile, source);
    if (!entryPath) {
      throw new Error(`Entry file not found: tried ${mainFile}`);
    }

    // 6. 动态加载（清除缓存以支持热重载）
    try {
      delete require.cache[require.resolve(entryPath)];
    } catch {
      // 首次加载时 require.resolve 可能尚未缓存，忽略
    }

    // 临时 patch 模块解析：外部插件无法找到 backend-ts 的 node_modules，
    // 添加 backend-ts/node_modules 作为 fallback 搜索路径
    const pluginModule = await this.requireWithFallback(entryPath);

    // 支持 default 导出 / 命名导出 / CommonJS 直出类（module.exports = class）
    let PluginClass = pluginModule?.default;
    if (!PluginClass && typeof pluginModule === "function" && pluginModule.prototype) {
      // CommonJS 直出类：module.exports = class Valid { ... }
      PluginClass = pluginModule;
    }
    if (!PluginClass) {
      PluginClass = pluginModule[Object.keys(pluginModule).find((k) => {
        const val = pluginModule[k];
        return typeof val === "function" && val.prototype;
      }) || ""];
    }

    if (!PluginClass) {
      throw new Error("No plugin class export found in entry file");
    }

    // 7. 实例化（不注入 DI，外部插件通过 onLoad(api) 获取能力）
    const instance: PluginBase = new PluginClass();

    // 8. 合并 manifest（manifest.json 覆盖类内 manifest，注入 source 和 pluginPath）
    const mergedManifest: PluginManifest = {
      ...instance.manifest,
      ...manifest,
      source,
      pluginPath: pluginDir,
    };
    instance.manifest = mergedManifest;

    // 8.5. 加载外部插件语言包 (lang/zh.json)
    const langFile = path.join(pluginDir, "lang", "zh.json");
    if (fs.existsSync(langFile)) {
      try {
        const messages = JSON.parse(
          await fs.promises.readFile(langFile, "utf-8"),
        );
        this.nlsService.registerBundle(manifest.id, "zh", messages);
        this.logger.debug(
          `Loaded NLS bundle for external plugin: ${manifest.id}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to load NLS bundle for ${manifest.id}: ${err.message}`,
        );
      }
    }

    // 9. 注册到 PluginManager
    await this.pluginManager.registerPlugin(instance);

    // 10. 记录路径（供 icon/uninstall 使用）
    this.pluginPaths.set(manifest.id, { dir: pluginDir, source });

    this.logger.log(
      `External plugin loaded: ${manifest.name} (${manifest.id}) from ${source}`,
    );
  }

  /**
   * 解析入口文件路径
   * dev 模式优先 .ts，回退 .js；user 模式仅 .js
   */
  private resolveEntry(
    pluginDir: string,
    mainFile: string,
    source: string,
  ): string | null {
    // dev 模式：如果指定了 .ts，直接用
    if (source === "dev") {
      if (mainFile.endsWith(".ts")) {
        const p = path.join(pluginDir, mainFile);
        return fs.existsSync(p) ? p : null;
      }
      // 尝试 .ts 变体
      const tsVariant = mainFile.replace(/\.js$/, ".ts");
      const tsPath = path.join(pluginDir, tsVariant);
      if (fs.existsSync(tsPath)) return tsPath;
    }

    // 通用：直接用 mainFile
    const directPath = path.join(pluginDir, mainFile);
    return fs.existsSync(directPath) ? directPath : null;
  }

  /**
   * 动态 require 插件入口文件，同时让插件内部能解析到 backend-ts 的 node_modules。
   *
   * 外部插件目录没有自己的 node_modules，import zod 等依赖时 Node 会从插件目录
   * 逐级向上搜索，找不到就报错。这里临时 patch Module._resolveFilename，
   * 将 backend-ts/node_modules 作为 fallback 搜索路径，require 完成后立即恢复。
   */
  private async requireWithFallback(entryPath: string): Promise<any> {
    const backendNodeModules = path.resolve(process.cwd(), "node_modules");
    const mod = Module as any;

    const doRequire = (): any => {
      const originalResolveFilename = mod._resolveFilename;

      mod._resolveFilename = function (
        request: string,
        parent: NodeJS.Module | undefined,
        isMain?: boolean,
        options?: any,
      ): string {
        try {
          return originalResolveFilename.call(
            this,
            request,
            parent,
            isMain,
            options,
          );
        } catch {
          return originalResolveFilename.call(
            this,
            request,
            { ...parent, paths: [...(parent?.paths || []), backendNodeModules] },
            isMain,
            options,
          );
        }
      };

      try {
        return require(entryPath);
      } finally {
        mod._resolveFilename = originalResolveFilename;
      }
    };

    const result = this.requireQueue.then(() => doRequire());
    this.requireQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private validateManifest(m: ExternalManifest): void {
    if (!m.id || typeof m.id !== "string")
      throw new Error("manifest.json: id is required");
    if (!m.name || typeof m.name !== "string")
      throw new Error("manifest.json: name is required");
    if (!m.version) throw new Error("manifest.json: version is required");
    if (!m.description)
      throw new Error("manifest.json: description is required");
  }

  /** 获取插件目录路径（供 icon 接口使用） */
  getPluginPath(pluginId: string): string | undefined {
    return this.pluginPaths.get(pluginId)?.dir;
  }

  /** 获取插件来源 */
  getPluginSource(pluginId: string): "dev" | "user" | undefined {
    return this.pluginPaths.get(pluginId)?.source;
  }

  /** 卸载外部插件：从 PluginManager 注销 + 删除目录 */
  async uninstallPlugin(pluginId: string): Promise<void> {
    const info = this.pluginPaths.get(pluginId);
    if (!info) {
      throw new Error(`External plugin not found: ${pluginId}`);
    }

    await this.pluginManager.unregisterPlugin(pluginId);

    await fs.promises.rm(info.dir, { recursive: true, force: true });
    this.pluginPaths.delete(pluginId);

    this.logger.log(`External plugin uninstalled: ${pluginId}`);
  }

  /** 重载外部插件（dev 调试用） */
  async reloadExternalPlugin(pluginId: string): Promise<void> {
    const info = this.pluginPaths.get(pluginId);
    if (!info) {
      throw new Error(`External plugin not found: ${pluginId}`);
    }

    await this.pluginManager.unregisterPlugin(pluginId);
    this.pluginPaths.delete(pluginId);
    await this.loadExternalPlugin(info.dir, info.source);
  }

  // ── 分发安装（分发体系）──

  /** 用户插件安装目录 */
  private userPluginDir(): string {
    const dir = this.configService.get<string>("PLUGINS_USER_DIR");
    if (!dir) throw new Error("PLUGINS_USER_DIR is not configured; cannot install plugins");
    return dir;
  }

  /**
   * 从分发源安装插件（github:/gitee:/git:/local:）
   * 下载到用户插件目录 → 加载 → 广播 plugins.changed。onLog 实时推送进度行。
   */
  private async doInstall(
    source: string,
    onLog?: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<{ id: string; dir: string }> {
    const parsed = parsePluginSource(source);
    const userDir = this.userPluginDir();
    const targetDir = path.join(userDir, parsed.dirName);
    const push = (line: string) => onLog?.(line);

    if (fs.existsSync(targetDir)) {
      throw new Error(`插件目录已存在，请先卸载或使用更新: ${parsed.dirName}`);
    }

    // 下载
    if (parsed.protocol === "local") {
      if (!fs.existsSync(parsed.localPath)) {
        throw new Error(`本地插件路径不存在: ${parsed.localPath}`);
      }
      push(`[local] 复制本地插件: ${parsed.localPath}`);
      await fs.promises.cp(parsed.localPath, targetDir, { recursive: true });
    } else {
      const tmpDir = `${targetDir}.tmp-${Date.now()}`;
      push(`[git] 克隆 ${parsed.display}${parsed.ref ? ` @${parsed.ref}` : ""}`);
      try {
        await this.gitClone(parsed.cloneUrl!, parsed.ref, tmpDir, push, signal);
        await fs.promises.rename(tmpDir, targetDir);
        push(`[git] 下载完成`);
      } catch (err: any) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
        throw err;
      }
    }

    // 记录分发源（供 update/溯源）
    try {
      await fs.promises.writeFile(path.join(targetDir, ".gd-source"), source, "utf-8");
    } catch {
      /* 记录失败不致命 */
    }

    // 加载
    push(`[load] 加载插件 ${parsed.dirName} …`);
    await this.loadExternalPlugin(targetDir, "user");
    const id = this.readManifestId(targetDir);
    this.eventBus.emit("plugins.changed", { pluginId: id, action: "installed" });
    this.logger.log(`Plugin installed: ${id} from ${source}`);
    push(`[done] 插件已安装: ${id}`);
    return { id, dir: targetDir };
  }

  /** 同步安装（内部/测试用），无日志回调 */
  async installPlugin(source: string): Promise<{ id: string; dir: string }> {
    return this.doInstall(source);
  }

  /**
   * 后台任务安装：立即返回 jobId，前端轮询 getInstallLog 实时显示进度。
   */
  async installPluginJob(source: string): Promise<{ jobId: string }> {
    const jobId = `plugin-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: {
      log: string[];
      done: boolean;
      result?: { success: boolean; id?: string };
      controller?: AbortController;
    } = { log: [], done: false };
    const controller = new AbortController();
    job.controller = controller;
    this.installJobs.set(jobId, job);

    void (async () => {
      try {
        const res = await this.doInstall(source, (line) => job.log.push(line), controller.signal);
        job.result = { success: true, id: res.id };
        job.done = true;
      } catch (err: any) {
        job.log.push(`❌ 安装失败: ${err?.message || err}`);
        job.result = { success: false };
        job.done = true;
      }
    })();

    return { jobId };
  }

  /** 查询安装任务日志（前端轮询） */
  async getInstallLog(jobId: string): Promise<
    { log: string[]; done: boolean; result?: { success: boolean; id?: string } } | null
  > {
    const job = this.installJobs.get(jobId);
    if (!job) return null;
    return { log: job.log, done: job.done, result: job.result };
  }

  /** 取消安装任务（窗口关闭/组件卸载时调用） */
  async cancelInstall(jobId: string): Promise<{ cancelled: boolean }> {
    const job = this.installJobs.get(jobId);
    if (!job || job.done) return { cancelled: false };
    job.controller?.abort();
    job.log.push("⛔ 已取消安装");
    job.done = true;
    return { cancelled: true };
  }

  /** 更新已安装插件（重新拉取分发源并重载）。仅 git 分发的插件可更新。 */
  async updatePlugin(pluginId: string): Promise<{ id: string; dir: string }> {
    const info = this.pluginPaths.get(pluginId);
    if (!info) throw new Error(`外部插件不存在: ${pluginId}`);

    const sourceFile = path.join(info.dir, ".gd-source");
    const source = fs.existsSync(sourceFile)
      ? (await fs.promises.readFile(sourceFile, "utf-8")).trim()
      : "";
    if (!source) {
      throw new Error(`${pluginId} 无分发源记录，无法更新（仅 git 安装的插件可更新）`);
    }

    await this.pluginManager.unregisterPlugin(pluginId);
    this.pluginPaths.delete(pluginId);
    await fs.promises.rm(info.dir, { recursive: true, force: true });

    return this.doInstall(source);
  }

  /**
   * git 浅克隆，支持分支/tag/commit
   * onLog 实时推送 git 输出（进度条等），signal 可中止
   */
  private async gitClone(
    url: string,
    ref: string | undefined,
    dir: string,
    onLog?: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ["clone", "--depth", "1", "--single-branch"];
      if (ref) {
        args.push("-b", ref);
      }
      args.push(url, dir);
      const child = spawn("git", args, { windowsHide: true });
      const push = (d: Buffer) => {
        const s = d.toString().trim();
        if (s) onLog?.(s);
      };
      child.stdout?.on("data", push);
      child.stderr?.on("data", push); // git 进度/错误走 stderr
      child.on("error", (e) => reject(e));
      child.on("close", (code) => {
        if (signal?.aborted) return reject(new Error("aborted"));
        if (code === 0) resolve();
        else reject(new Error(`git clone 退出码 ${code}`));
      });
    });
  }

  /** 读取插件目录 manifest 的 id */
  private readManifestId(dir: string): string {
    try {
      const m = JSON.parse(
        fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"),
      );
      return m.id;
    } catch {
      return path.basename(dir);
    }
  }
}
