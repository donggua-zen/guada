import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SkillDefinition, SkillSourceType } from "../interfaces/skill-manifest.interface";
import { SkillLoaderService } from "./skill-loader.service";
import { SkillRegistry } from "./skill-registry.service";
import { SkillWatcherService } from "./skill-watcher.service";
import { StreamStatusChangedEvent } from "../../../common/events/stream.events";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { normalizeWorkspaceKey } from "../../../common/utils/workspace-key.util";

export interface SkillSourceConfig {
  key: string;              // 唯一标识
  dir: string;              // 技能父目录（如 "skills/" 或 "workspace/.guada/skills"）
  source: SkillSourceType;
  baseDir: string;          // 生成 basePath 的根目录
  persistent: boolean;      // true=进程常驻, false=TTL 自动清理
  ttlMs?: number;
  /** 项目来源的归一化目录键（workspace 来源专用，用于跨写法查找同一目录） */
  pathKey?: string;
}

interface SkillSource extends SkillSourceConfig {
  skills: SkillDefinition[];
  timer: NodeJS.Timeout | null;
  createdAt: number;
  /** 最近一次注册/续期时间：容量淘汰按它而非 createdAt，避免浏览项目挤掉活跃会话来源 */
  lastTouchedAt: number;
}

const WORKSPACE_SKILLS_RELATIVE = ".guada/skills";
const WORKSPACE_SOURCE_PREFIX = "workspace_";
const DEFAULT_TTL = 3 * 60 * 60 * 1000;
/**
 * 同时保留的动态来源上限。
 *
 * 技能管理页会给「选中的项目」注册来源（即便该目录从未跑过会话），活跃项目 +
 * 活跃会话的工作目录叠加后轻松超过 10 个；旧值 10 会让后访问的项目把正在
 * 使用中的会话来源挤掉（技能清单短暂缺项）。工作量级是「读目录 + 挂 chokidar」，
 * 24 个仍属轻量。
 */
const MAX_SOURCES = 24;

/** 项目来源的缓存键：由归一化路径派生，`D:\a` 与 `d:/a/` 命中同一来源 */
export function workspaceSourceKey(pathKey: string): string {
  return WORKSPACE_SOURCE_PREFIX + pathKey;
}
const SOURCE_PRIORITY: Record<string, number> = {
  agents: 1, global: 2, workspace: 3,
};

@Injectable()
export class SkillSourceManager implements OnModuleDestroy {
  private readonly logger = new Logger(SkillSourceManager.name);
  private readonly sources = new Map<string, SkillSource>();
  private readonly skillsDir: string;
  private readonly agentsSkillsDir: string;

  constructor(
    private configService: ConfigService,
    private loader: SkillLoaderService,
    private registry: SkillRegistry,
    private watcher: SkillWatcherService,
    private workspaceService: WorkspaceService,
  ) {
    this.skillsDir = this.configService.get<string>("SKILLS_DIR") ||
                     path.join(process.cwd(), "skills");
    this.agentsSkillsDir = this.configService.get<string>("AGENTS_SKILLS_DIR") ||
                           path.join(os.homedir(), ".agents", "skills");
    this.workspaceService.registerSafeWritePath(this.skillsDir);
  }

  async onModuleDestroy(): Promise<void> {
    for (const key of this.sources.keys()) {
      await this.unregister(key);
    }
  }

  // ── 生命周期 ──

  async start(): Promise<void> {
    this.logger.log("Initializing skill sources...");

    // 内置技能已全部改为插件注册的文本技能（SkillBundledPlugin / registerSkill），
    // 不再有文件系统 system 来源（原 .system 目录机制已废弃）。

    // agents (shared directory ~/.agents/skills/, read-only, lower priority than global)
    await this.register({
      key: "agents",
      dir: this.agentsSkillsDir,
      source: "agents",
      baseDir: this.agentsSkillsDir,
      persistent: true,
    });

    // global
    await this.register({
      key: "global",
      dir: this.skillsDir,
      source: "global",
      baseDir: this.skillsDir,
      persistent: true,
    });

    this.logger.log(`Skill sources initialized, total skills: ${this.registry.getAll().size}`);
  }

  /** 重新注册 agents + global 来源（用于手动触发重新扫描） */
  async restart(): Promise<void> {
    // 只重建持久来源；workspace 等动态来源由会话事件驱动注册，
    // 手动扫描不应把它们一并注销（否则扫描后 workspace 技能消失，需等下次会话才回来）
    const persistentKeys = Array.from(this.sources.entries())
      .filter(([, src]) => src.persistent)
      .map(([key]) => key);
    for (const key of persistentKeys) {
      await this.unregister(key);
    }
    await this.start();
    this.logger.log("Skill sources restarted");
  }

  // ── 注册 / 注销 ──

  async register(cfg: SkillSourceConfig): Promise<void> {
    if (this.sources.has(cfg.key)) return;

    const skills: SkillDefinition[] = [];
    let dirMissing = false;

    try {
      // 持久来源目录必须先落盘再挂监听：chokidar v4 对不存在的路径 add() 会
      // 退化为「监听父目录 + 仅放行该 target」，同一父目录下其他子目录（新技能）
      // 的 add 事件会被永久过滤掉，导致自动注册静默失效（如全新安装时的 skills）。
      if (cfg.persistent) {
        await fs.mkdir(cfg.dir, { recursive: true });
      }
      await fs.access(cfg.dir);
      const entries = await fs.readdir(cfg.dir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => path.join(cfg.dir, e.name));

      const results = await Promise.allSettled(
        dirs.map((d) => this.loader.loadManifest(d, cfg.source, cfg.baseDir)),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          const sd = r.value;
          skills.push(sd);
          if (cfg.persistent) {
            this.registry.register(sd);
          }
        } else {
          this.logger.warn(`Failed to load skill from ${cfg.dir}: ${r.reason}`);
        }
      }
    } catch {
      // 目录不存在：持久来源注册一个空 source（目录已由 mkdir 建好，走到这里
      // 说明确实不可读）；动态来源（项目 `.guada/skills`）**不落空 source**——
      // chokidar 对不存在的路径会永久过滤同父目录后续新增，注册了反而更糟。
      if (!cfg.persistent) {
        this.logger.log(`Skill source skipped (dir not found): ${cfg.key}`);
        return;
      }
      dirMissing = true;
    }
    if (dirMissing) {
      this.logger.warn(`Skill source dir unreadable: ${cfg.dir}`);
    }

    // 文件监控
    const pattern = `${cfg.dir}/*/SKILL.md`;
    this.watcher.addWatch(pattern, {
      onAdd: async (absDir) => {
        try {
          const sd = await this.loader.loadManifest(absDir, cfg.source, cfg.baseDir);
          const src = this.sources.get(cfg.key);
          if (src) {
            const idx = src.skills.findIndex((s) => s.id === sd.id);
            if (idx >= 0) src.skills[idx] = sd;
            else src.skills.push(sd);
            if (cfg.persistent) this.registry.register(sd);
          }
          this.logger.log(`Skill ${sd.id} updated [${cfg.key}]`);
        } catch (e: any) {
          this.logger.warn(`Failed to load skill: ${e.message}`);
        }
      },
      onRemove: (id) => {
        const src = this.sources.get(cfg.key);
        if (src) {
          src.skills = src.skills.filter((s) => s.id !== id);
          if (cfg.persistent) this.registry.unregister(id);
          this.logger.log(`Skill ${id} removed [${cfg.key}]`);
        }
      },
    });

    const source: SkillSource = {
      ...cfg,
      skills,
      timer: null,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
    };

    // TTL 由 ttlMs 决定，与 persistent 解耦
    if (cfg.ttlMs != null && cfg.ttlMs > 0) {
      this.startTimer(cfg.key, source);
    }

    this.sources.set(cfg.key, source);
    this.logger.log(`Registered skill source: ${cfg.key} (${skills.length} skills)`);
  }

  async unregister(key: string): Promise<void> {
    const src = this.sources.get(key);
    if (!src) return;

    if (src.timer) clearTimeout(src.timer);
    this.watcher.removeWatch(`${src.dir}/*/SKILL.md`);

    if (src.persistent) {
      for (const s of src.skills) this.registry.unregister(s.id);
    }

    this.sources.delete(key);
    this.logger.log(`Unregistered skill source: ${key}`);
  }

  // ── 公开 API ──

  getSourceSkills(key: string): SkillDefinition[] {
    return this.sources.get(key)?.skills ?? [];
  }

  getAllSources(): SkillSourceConfig[] {
    return Array.from(this.sources.values());
  }

  /** 按优先级合并所有 source 的技能，返回完整列表 */
  getAllSkills(): SkillDefinition[] {
    const ordered = Array.from(this.sources.values())
      .sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 0) - (SOURCE_PRIORITY[b.source] ?? 0));
    const merged = new Map<string, SkillDefinition>();
    for (const src of ordered) {
      for (const s of src.skills) merged.set(s.id, s);
    }
    return Array.from(merged.values());
  }

  /** 获取已启用的技能（仅 persistent source 中的） */
  getEnabledSkills(): SkillDefinition[] {
    return this.registry.getEnabled();
  }

  // ── 通用注册/续期（非 persistent 来源用） ──

  /**
   * 注册或刷新一个来源。如果已存在则续期 TTL，不存在则直接注册。
   * 调用方只需构造 SkillSourceConfig，无需关心来源类型。
   */
  async registerOrRefresh(cfg: SkillSourceConfig): Promise<void> {
    const existing = this.sources.get(cfg.key);
    if (existing) {
      existing.lastTouchedAt = Date.now();
      if (cfg.ttlMs != null || !cfg.persistent) {
        this.startTimer(cfg.key, existing);
      }
      return;
    }
    if (this.sources.size >= MAX_SOURCES) {
      this.evictOldest();
    }
    await this.register(cfg);
  }

  // ── Workspace（项目）动态管理 ──

  /**
   * 确保某个项目工作目录的技能来源已加载（幂等 + 续期）。
   *
   * 与旧实现的区别：
   * - key 由**归一化路径**派生（见 normalizeWorkspaceKey），`D:\a` 与 `d:/a/`
   *   命中同一来源，避免同一目录裂成两份技能清单；
   * - 目录不存在时若已有该来源则注销，且**不注册空来源**（chokidar 对不存在
   *   路径会永久过滤同父目录的后续新增）；
   * - 不依赖「会话开始跑」这一事件——技能管理页浏览项目也要能拿到技能。
   *
   * @param refresh true 时强制注销重建（手动扫描用），否则仅续期 TTL
   * @returns 该来源当前的技能（目录不存在时为空数组）
   */
  async ensureWorkspaceSource(
    workspacePath: string,
    opts: { refresh?: boolean } = {},
  ): Promise<SkillDefinition[]> {
    if (!workspacePath) return [];
    const pathKey = normalizeWorkspaceKey(workspacePath);
    const key = workspaceSourceKey(pathKey);
    const skillsDir = path.join(workspacePath, WORKSPACE_SKILLS_RELATIVE);

    let dirExists = true;
    try {
      const stat = await fs.stat(skillsDir);
      dirExists = stat.isDirectory();
    } catch {
      dirExists = false;
    }

    if (!dirExists) {
      // 目录被删/从未创建：清掉旧来源，返回空（不建目录、不抛错）
      if (this.sources.has(key)) await this.unregister(key);
      return [];
    }

    if (this.sources.has(key)) {
      if (opts.refresh) {
        await this.unregister(key);
      } else {
        await this.registerOrRefresh({
          key,
          dir: skillsDir,
          source: "workspace",
          baseDir: skillsDir,
          persistent: false,
          pathKey,
        });
        return this.getSourceSkills(key);
      }
    }

    await this.registerOrRefresh({
      key,
      dir: skillsDir,
      source: "workspace",
      baseDir: skillsDir,
      persistent: false,
      pathKey,
    });
    return this.getSourceSkills(key);
  }

  /** 按归一化目录键取项目技能（找不到来源时返回空数组，不触发加载） */
  getWorkspaceSkillsByPathKey(pathKey: string): SkillDefinition[] {
    return this.getSourceSkills(workspaceSourceKey(pathKey));
  }

  /**
   * 用重载后的定义替换某来源里的同 id 技能（热更新回写）。
   * 来源不存在时忽略——调用方不应把技能塞进不存在的来源。
   */
  replaceSourceSkill(key: string, skill: SkillDefinition): void {
    const src = this.sources.get(key);
    if (!src) return;
    const idx = src.skills.findIndex((s) => s.id === skill.id);
    if (idx >= 0) src.skills[idx] = skill;
    else src.skills.push(skill);
    src.lastTouchedAt = Date.now();
  }

  /** 该目录键对应的来源 key（不存在也返回，供调用方判断 has） */
  findWorkspaceSourceKey(pathKey: string): string {
    return workspaceSourceKey(pathKey);
  }

  /**
   * 来源缓存里最「新」的项目技能版本（同 ID 取最后注册的）。
   * 供 skill_learn 在无会话上下文时按名称兜底查找项目技能。
   */
  findWorkspaceSkillByName(name: string): SkillDefinition | undefined {
    const id = name.toLowerCase();
    const candidates = Array.from(this.sources.values())
      .filter((src) => src.source === "workspace")
      .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
    for (const src of candidates) {
      const hit = src.skills.find((s) => s.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  @OnEvent("stream.status_changed")
  async handleStreamStarted(event: StreamStatusChangedEvent): Promise<void> {
    if (event.payload.status !== "running") return;
    // running 事件 workspacePath 在 payload 顶层(chat-runner 注入);兼容旧 session 内嵌
    const wp = (event.payload?.workspacePath ||
      event.payload?.session?.workspacePath) as string | undefined;
    if (!wp) return;
    await this.ensureWorkspaceSource(wp);
  }

  // ── TTL ──

  private startTimer(key: string, src: SkillSource): void {
    if (src.timer) clearTimeout(src.timer);
    src.timer = setTimeout(() => {
      this.logger.log(`Skill source expired: ${key}`);
      this.unregister(key);
    }, src.ttlMs ?? DEFAULT_TTL);
  }

  /**
   * 容量淘汰：只淘汰动态来源，按「最久未续期」优先。
   *
   * 持久来源（global/agents）是进程级基础清单，淘汰会让全局技能凭空消失；
   * 动态来源按 lastTouchedAt 而不是 createdAt，正在被浏览/使用的项目不会被
   * 一个刚打开的项目挤掉。
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, src] of this.sources) {
      if (src.persistent) continue;
      if (src.lastTouchedAt < oldestTime) {
        oldestTime = src.lastTouchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.logger.log(`Skill source evicted (capacity): ${oldestKey}`);
      void this.unregister(oldestKey);
    }
  }
}
