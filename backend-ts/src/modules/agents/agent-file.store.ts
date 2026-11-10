import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { mintId } from "../../common/utils/id.util";
import { Injectable, Logger } from "@nestjs/common";
import {
  AGENT_ID_MAX_LENGTH,
  AGENT_ID_PREFIX,
  AgentFileDefinition,
  DEFAULT_AGENT_ID,
  isAvatarFileName,
  isValidAgentId,
  parseAgentMarkdown,
  serializeAgentMarkdown,
} from "./agent-file.mapper";
import {
  PluginAgentRegistry,
  isPluginAgentId,
  PLUGIN_AGENT_ID_PREFIX,
} from "../plugins/registry/plugin-agent.registry";
import {
  composePluginAgentSettings,
  composePluginAgentAvatarUrl,
  mergePluginAgentOverrides,
  normalizeKitRefs,
  PluginAgentOverride,
} from "../plugins/registry/plugin-agent-settings";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

/** 用户覆盖层持久化 group（SettingsStorage，<dir>/agent-overrides.json） */
const AGENT_OVERRIDES_GROUP = "agent-overrides";

/**
 * 智能体文件存储（对齐 DSH「预设就是文件」与本项目 providers/*.yaml 的既有范式）
 *
 * 目录约定（一个智能体 = 一个目录，目录名即 id）：
 *   <AGENTS_DATA_DIR>/<id>/AGENT.md    定义（YAML frontmatter + Markdown 正文）
 *   <AGENTS_DATA_DIR>/<id>/avatar.png  头像（可选，约定 `avatar.<ext>`）
 *   <AGENTS_DATA_DIR>/.trash/<id>-<ts>/ UI 删除的回收站
 *   <AGENTS_DATA_DIR>/.tombstones.json  UI 删除墓碑（阻止补种复活）
 *
 * - 目录名即 id：findById 直接拼路径读取，零索引（列表才需要扫描缓存）
 * - 改 name 不改目录名 → 会话 agentId 引用稳定
 * - 内存缓存（外部手改文件重启生效；UI 走 API 修改即时更新缓存）
 * - 原子写（tmp + rename）；解析失败文件隔离，不崩服务、不挤占缓存
 */

export const AGENT_FILE = "AGENT.md";
export const TRASH_DIR = ".trash";
export const TOMBSTONE_FILE = ".tombstones.json";

/** 用户可写根目录 */
export function resolveAgentsDir(): string {
  return (
    process.env.AGENTS_DATA_DIR ||
    (process.env.USERDATA_DIR
      ? path.join(process.env.USERDATA_DIR, "agents")
      : path.join(process.cwd(), "data", "agents"))
  );
}

/** 随包发布的只读默认助手模板根（补种来源） */
export function resolveBundledAgentsDir(): string {
  return (
    process.env.BUNDLED_AGENTS_DIR || path.join(process.cwd(), "bundled-agents")
  );
}

/** 对外的智能体视图（字段名沿用既有 API，title 已更名为 name） */
export interface AgentDefinition {
  /** 目录名 */
  id: string;
  name: string;
  description: string | null;
  /** 存储路径，形如 `agents/<id>/avatar.png`（由 UrlService 转绝对 URL） */
  avatarUrl: string | null;
  modelId: string | null;
  settings: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  /** 是否来自 bundled 模板（补种复制后仍标记来源） */
  bundled: boolean;
  /**
   * v4：来源插件 ID（虚拟插件智能体专属标记）。
   * 非空 = 该智能体由插件注册，不落盘、用户不可编辑/删除。
   */
  pluginId?: string | null;
  /**
   * v4.1：插件绑定的工具包（`${pluginId}:${kitId}`，含跨插件引用）。
   * 这些包对用户锁定"永远打开"：UI 开关禁用，后端裁决层豁免一切裁剪。
   */
  lockedToolkits?: string[];
  /** v4.1：插件绑定的技能 id（同样锁定常开） */
  lockedSkills?: string[];
}

export interface AgentCreateInput {
  name: string;
  /**
   * 显式指定的 id（= 目录名）。必须是 ASCII slug（`^[a-z0-9][a-z0-9-]*$`）。
   * 省略时由 `name` 派生；若 name 非 ASCII（如纯中文）则回退 `agent-<8位随机>`。
   */
  id?: string;
  description?: string | null;
  modelId?: string | null;
  settings?: Record<string, any> | null;
}

export interface AgentUpdateInput {
  name?: string;
  description?: string | null;
  modelId?: string | null;
  settings?: Record<string, any> | null;
}

export interface AgentLoadError {
  file: string;
  message: string;
}

interface CachedAgent extends AgentDefinition {
  dirPath: string;
}

@Injectable()
export class AgentFileStore {
  private readonly logger = new Logger(AgentFileStore.name);
  private readonly usersDir: string;
  private cache = new Map<string, CachedAgent>();
  private loadErrors = new Map<string, AgentLoadError>();
  private ready: Promise<void> | null = null;
  /** v4.1：插件智能体用户覆盖层（agentId → override），initialize 时加载、写时同步更新 */
  private overrides = new Map<string, PluginAgentOverride>();

  constructor(private readonly settingsStorage: SettingsStorage) {
    this.usersDir = resolveAgentsDir();
  }

  getDirectory(): string {
    return this.usersDir;
  }

  /** 幂等初始化：建目录 + 全量加载 */
  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    await fsp.mkdir(this.usersDir, { recursive: true });
    await this.loadAll();
    // v4.1：加载插件智能体的用户覆盖层（失败视为无覆盖，fail-soft）
    try {
      const raw = await this.settingsStorage.getSettings(AGENT_OVERRIDES_GROUP);
      if (raw && typeof raw === "object") {
        for (const [id, value] of Object.entries(raw)) {
          if (value && typeof value === "object") {
            this.overrides.set(id, value as PluginAgentOverride);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`加载智能体覆盖层失败（视为无覆盖）: ${err?.message ?? err}`);
    }
    this.logger.log(
      `Agent file store ready at ${this.usersDir} (${this.cache.size} agent(s), ${this.overrides.size} override(s))`,
    );
  }

  /** 外部写入（补种/迁移）后强制重载 */
  async reload(): Promise<void> {
    await this.initialize();
    await this.loadAll();
  }

  // ============ 读取 API ============

  /**
   * 列表排序：`DEFAULT_AGENT_ID` 恒排第一；其余按文件创建时间升序
   * （缺失回退 mtime），同刻回退 id 字典序。
   *
   * v4：合并插件注册的虚拟智能体（磁盘智能体之后），跟随插件全局启停。
   */
  async listAgents(): Promise<AgentDefinition[]> {
    await this.initialize();
    const diskAgents = Array.from(this.cache.values())
      .sort((a, b) => {
        if (a.id === DEFAULT_AGENT_ID) return b.id === DEFAULT_AGENT_ID ? 0 : -1;
        if (b.id === DEFAULT_AGENT_ID) return 1;
        return (
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id)
        );
      })
      .map((c) => this.toView(c));
    return [...diskAgents, ...this.listVirtualAgents()];
  }

  /** v4：插件注册的虚拟智能体视图（生命周期跟随插件，含启停过滤） */
  private listVirtualAgents(): AgentDefinition[] {
    return PluginAgentRegistry.listVisible().map((reg) =>
      this.virtualToView(reg),
    );
  }

  private virtualToView(
    reg: import("../plugins/registry/plugin-agent.registry").PluginAgentRegistration,
  ): AgentDefinition {
    const now = new Date();
    // v4.1：合成声明 + 用户 override + 锁定重申（唯一合并收口，列表/findById 共用）
    const merged = mergePluginAgentOverrides(reg, this.overrides.get(reg.agentId));
    return {
      id: reg.agentId,
      name: merged.name,
      description: merged.description,
      avatarUrl: composePluginAgentAvatarUrl(reg),
      modelId: merged.modelId,
      settings: merged.settings,
      createdAt: now,
      updatedAt: now,
      bundled: false,
      pluginId: reg.pluginId,
      lockedToolkits: normalizeKitRefs(reg).map(
        (r) => `${r.pluginId}:${r.kitId}`,
      ),
      lockedSkills: (reg.def.skills ?? []).map((s) => String(s).toLowerCase()),
    };
  }

  /**
   * v4.1：更新插件智能体的用户覆盖层（内存 + 落盘）。
   *
   * 只接受字段白名单（name/description/modelId/settings 剔除锁定键），
   * 由 AgentService.updateAgent 分流调用；全量替换该 agentId 的 override。
   * 智能体当前不可见（插件禁用/卸载）时仍允许写入——重装后自动恢复。
   */
  async updateOverride(
    agentId: string,
    patch: PluginAgentOverride,
  ): Promise<void> {
    const next: PluginAgentOverride = {
      name: patch.name,
      description: patch.description,
      modelId: patch.modelId,
      settings: patch.settings,
    };
    this.overrides.set(agentId, next);
    try {
      await this.settingsStorage.updateSettings(AGENT_OVERRIDES_GROUP, {
        [agentId]: next,
      });
    } catch (err: any) {
      // 落盘失败：回滚内存，保持视图与存储一致
      this.overrides.delete(agentId);
      throw new Error(`保存智能体配置失败: ${err?.message ?? err}`);
    }
  }

  /**
   * 按 id 查找。缓存优先；未命中则直接拼 `<usersDir>/<id>/AGENT.md` 读取
   * （目录名即 id，无需索引）。
   *
   * v4：`plugin-` 前缀的 id 先查插件智能体注册表（虚拟视图），不落盘。
   */
  async findById(id: string): Promise<AgentDefinition | undefined> {
    if (!id || !isValidAgentId(id)) return undefined;
    // 虚拟插件智能体优先（id 形态 plugin-<pluginId>-<defId>，磁盘不可能同名——
    // 保留前缀对用户创建智能体不可用）
    if (isPluginAgentId(id)) {
      const reg = PluginAgentRegistry.findVisibleById(id);
      return reg ? this.virtualToView(reg) : undefined;
    }
    const cached = this.cache.get(id);
    if (cached) return this.toView(cached);
    const def = await this.readFromDisk(id);
    return def ? this.toView(def) : undefined;
  }

  /** 批量查找（水合会话列表用；缓存优先，未命中回退磁盘） */
  async findManyByIds(
    ids: string[],
  ): Promise<Map<string, AgentDefinition>> {
    await this.initialize();
    const out = new Map<string, AgentDefinition>();
    for (const id of ids) {
      if (!id || out.has(id)) continue;
      const cached = this.cache.get(id);
      if (cached) {
        out.set(id, this.toView(cached));
        continue;
      }
      const def = await this.readFromDisk(id);
      if (def) out.set(id, this.toView(def));
    }
    return out;
  }

  listLoadErrors(): AgentLoadError[] {
    return Array.from(this.loadErrors.values());
  }

  // ============ 写入 API ============

  /**
   * 新建智能体
   *
   * id 解析优先级：显式 `input.id`（推荐，前端「标识符」字段）> `name` 的 ASCII slug
   * > `agent-<8位随机>` 兜底（中文等非 ASCII 名经 slugify 会退化成 `agent`，
   * 若不兜底会导致一批助手全叫 agent / agent-2 / agent-3，无法辨认）。
   * 最终仍经 `uniqueId` 去重，冲突追加 `-2`/`-3`。
   */
  async create(input: AgentCreateInput): Promise<AgentDefinition> {
    await this.initialize();
    const id = this.uniqueId(this.resolveCreateId(input));
    const dirPath = path.join(this.usersDir, id);
    await fsp.mkdir(dirPath, { recursive: true });
    await this.writeDefinition(dirPath, {
      name: input.name,
      description: input.description ?? undefined,
      model: input.modelId ?? undefined,
      settings: this.normalizeSettings(input.settings),
    });
    await this.loadAll();
    const created = await this.findById(id);
    if (!created) throw new Error(`创建智能体失败：${id}`);
    return created;
  }

  /**
   * 解析新建时的目录 id（尚未去重）
   *
   * - 填了「标识符」→ 用它（校验 ASCII slug，非法直接抛错）
   * - 留空 → `agent-<uuid v4>`：不尝试从 name 派生
   *   （中文名无法转写为可读 slug，派生只会产出不可辨认的目录名；
   *    想要可读 id 请在「标识符」字段显式填写，如 `code-analyst`）
   */
  private resolveCreateId(input: AgentCreateInput): string {
    const explicit = (input.id ?? "").trim();
    if (explicit) {
      if (!isValidAgentId(explicit)) {
        throw new Error(
          `非法智能体 id「${explicit}」：只允许小写字母、数字与连字符，且以字母或数字开头（^[a-z0-9][a-z0-9-]*$）`,
        );
      }
      return explicit;
    }
    return mintId(AGENT_ID_PREFIX);
  }

  /** 更新：只重写 AGENT.md，目录名（id）保持不变 */
  async update(
    id: string,
    patch: AgentUpdateInput,
  ): Promise<AgentDefinition | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;
    const dirPath = path.join(this.usersDir, id);
    await this.writeDefinition(dirPath, {
      name: patch.name ?? existing.name,
      description:
        patch.description !== undefined
          ? patch.description ?? undefined
          : existing.description ?? undefined,
      model:
        patch.modelId !== undefined
          ? patch.modelId ?? undefined
          : existing.modelId ?? undefined,
      settings: this.normalizeSettings(
        patch.settings !== undefined ? patch.settings : existing.settings,
      ),
    });
    await this.loadAll();
    return this.findById(id);
  }

  /**
   * 删除：目录整体移入回收站（含头像），并写墓碑阻止补种复活。
   * 文件管理器直接删除不经此路径（无墓碑 → 启动补种恢复）。
   */
  async delete(id: string): Promise<boolean> {
    if (id === DEFAULT_AGENT_ID) {
      // 防御性拦截：正常流已在 HTTP 边界（AgentService.deleteAgent）抛 400
      throw new Error(`内置默认智能体「${id}」不可删除`);
    }
    const existing = await this.findById(id);
    if (!existing) return false;
    const dirPath = path.join(this.usersDir, id);
    const trashDir = path.join(this.usersDir, TRASH_DIR);
    await fsp.mkdir(trashDir, { recursive: true });
    const target = path.join(trashDir, `${id}-${Date.now()}`);
    try {
      await fsp.rename(dirPath, target);
    } catch (err) {
      this.logger.warn(
        `移入回收站失败，改为直接删除 ${id}: ${String(err)}`,
      );
      await fsp.rm(dirPath, { recursive: true, force: true });
    }
    await this.addTombstone(id);
    await this.loadAll();
    return true;
  }

  /**
   * 保存头像到目录内（约定 `avatar.<ext>`），返回存储路径。
   * 覆盖前清除目录内其它 avatar.*，保证单头像、无孤儿。
   */
  async saveAvatar(
    id: string,
    data: Buffer,
    ext: string,
  ): Promise<string | null> {
    if (!isValidAgentId(id)) return null;
    const dirPath = path.join(this.usersDir, id);
    try {
      await fsp.access(dirPath);
    } catch {
      return null;
    }
    const fileName = `avatar.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    for (const f of await fsp.readdir(dirPath)) {
      if (isAvatarFileName(f) && f !== fileName) {
        await fsp.unlink(path.join(dirPath, f)).catch(() => undefined);
      }
    }
    await this.atomicWrite(path.join(dirPath, fileName), data);
    await this.loadAll();
    return `agents/${id}/${fileName}`;
  }

  // ============ 墓碑 ============

  async readTombstones(): Promise<Set<string>> {
    try {
      const raw = await fsp.readFile(
        path.join(this.usersDir, TOMBSTONE_FILE),
        "utf8",
      );
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    } catch {
      /* 不存在或损坏 → 视为无墓碑 */
    }
    return new Set();
  }

  private async addTombstone(id: string): Promise<void> {
    const set = await this.readTombstones();
    if (set.has(id)) return;
    set.add(id);
    await this.atomicWrite(
      path.join(this.usersDir, TOMBSTONE_FILE),
      JSON.stringify(Array.from(set), null, 2),
    );
  }

  // ============ 内部：加载与解析 ============

  private async loadAll(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.usersDir, { withFileTypes: true });
    } catch {
      return;
    }
    const next = new Map<string, CachedAgent>();
    const nextErrors = new Map<string, AgentLoadError>();

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = entry.name;
      const dirPath = path.join(this.usersDir, id);
      const mdPath = path.join(dirPath, AGENT_FILE);
      try {
        const [content, stat, dirStat, files] = await Promise.all([
          fsp.readFile(mdPath, "utf8"),
          fsp.stat(mdPath),
          fsp.stat(dirPath),
          fsp.readdir(dirPath),
        ]);
        const def = parseAgentMarkdown(content, id);
        next.set(
          id,
          this.buildCached(id, def, dirPath, stat, dirStat, files.find(isAvatarFileName) ?? null),
        );
      } catch (err: any) {
        nextErrors.set(id, {
          file: `${id}/${AGENT_FILE}`,
          message: err?.message || String(err),
        });
        this.logger.warn(
          `Invalid agent "${id}" (isolated): ${err?.message || err}`,
        );
      }
    }

    this.cache = next;
    this.loadErrors = nextErrors;
  }

  private async readFromDisk(id: string): Promise<CachedAgent | null> {
    if (!isValidAgentId(id)) return null;
    const dirPath = path.join(this.usersDir, id);
    try {
      const [content, stat, dirStat, files] = await Promise.all([
        fsp.readFile(path.join(dirPath, AGENT_FILE), "utf8"),
        fsp.stat(path.join(dirPath, AGENT_FILE)),
        fsp.stat(dirPath),
        fsp.readdir(dirPath),
      ]);
      const def = parseAgentMarkdown(content, id);
      return this.buildCached(id, def, dirPath, stat, dirStat, files.find(isAvatarFileName) ?? null);
    } catch {
      return null;
    }
  }

  private buildCached(
    id: string,
    def: AgentFileDefinition,
    dirPath: string,
    stat: fs.Stats,
    dirStat: fs.Stats,
    avatarFileName: string | null,
  ): CachedAgent {
    const settings = this.normalizeSettings(def.settings);
    return {
      id,
      name: def.name,
      description: def.description ?? null,
      avatarUrl: avatarFileName ? `agents/${id}/${avatarFileName}` : null,
      modelId: def.model ?? null,
      settings: Object.keys(settings).length ? settings : null,
      createdAt: this.fileCreatedAt(dirStat),
      updatedAt: stat.mtime,
      bundled: false,
      dirPath,
    };
  }

  private toView(c: CachedAgent): AgentDefinition {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      avatarUrl: c.avatarUrl,
      modelId: c.modelId,
      settings: c.settings,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      bundled: c.bundled,
      pluginId: null,
    };
  }

  private fileCreatedAt(stat: fs.Stats): Date {
    const birth = stat.birthtimeMs;
    if (birth && birth > 0) return stat.birthtime;
    return stat.mtime;
  }

  private normalizeSettings(settings: any): Record<string, any> {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return {};
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  private uniqueId(base: string): string {
    const taken = new Set<string>();
    for (const id of this.cache.keys()) taken.add(id.toLowerCase());
    let candidate =
      base.length > AGENT_ID_MAX_LENGTH
        ? base.slice(0, AGENT_ID_MAX_LENGTH)
        : base;
    // v4：保留前缀 plugin- 归插件智能体，用户创建的智能体不落其上
    if (candidate.toLowerCase().startsWith(PLUGIN_AGENT_ID_PREFIX)) {
      candidate = `user-${candidate}`;
    }
    let n = 2;
    while (taken.has(candidate.toLowerCase())) {
      const suffix = `-${n++}`;
      candidate = `${base.slice(0, AGENT_ID_MAX_LENGTH - suffix.length)}${suffix}`;
    }
    return candidate;
  }

  private async writeDefinition(
    dirPath: string,
    def: AgentFileDefinition,
  ): Promise<void> {
    await fsp.mkdir(dirPath, { recursive: true });
    await this.atomicWrite(
      path.join(dirPath, AGENT_FILE),
      serializeAgentMarkdown(def),
    );
  }

  private async atomicWrite(
    filePath: string,
    data: string | Buffer,
  ): Promise<void> {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmpPath, data);
    // Windows rename 不能覆盖已存在文件，先删除目标
    try {
      await fsp.unlink(filePath);
    } catch {
      /* 目标不存在，正常 */
    }
    await fsp.rename(tmpPath, filePath);
  }
}
