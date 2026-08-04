import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import Module from "module";
import { PluginManager } from "../plugin.manager";
import { PluginBase } from "../base-plugin";
import { PluginManifest } from "../types/plugin.types";

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

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly configService: ConfigService,
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

    // 支持 default 导出或命名导出
    const PluginClass =
      pluginModule.default ||
      pluginModule[Object.keys(pluginModule).find((k) => {
        const val = pluginModule[k];
        return typeof val === "function" && val.prototype;
      }) || ""];

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
}
