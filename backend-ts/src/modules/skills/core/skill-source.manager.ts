import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs/promises";
import * as path from "path";
import { SkillDefinition, SkillSourceType } from "../interfaces/skill-manifest.interface";
import { SkillLoaderService } from "./skill-loader.service";
import { SkillRegistry } from "./skill-registry.service";
import { SkillWatcherService } from "./skill-watcher.service";
import { StreamStartedEvent } from "../../../common/events/stream.events";
import { WorkspaceService } from "../../../common/services/workspace.service";

export interface SkillSourceConfig {
  key: string;              // 唯一标识
  dir: string;              // 技能父目录（如 "skills/" 或 "workspace/.guada/skills"）
  source: SkillSourceType;
  baseDir: string;          // 生成 basePath 的根目录
  persistent: boolean;      // true=进程常驻, false=TTL 自动清理
  ttlMs?: number;
}

interface SkillSource extends SkillSourceConfig {
  skills: SkillDefinition[];
  timer: NodeJS.Timeout | null;
  createdAt: number;
}

const WORKSPACE_SKILLS_RELATIVE = ".guada/skills";
const DEFAULT_TTL = 3 * 60 * 60 * 1000;
const MAX_SOURCES = 10;
const SOURCE_PRIORITY: Record<string, number> = {
  system: 0, global: 1, workspace: 2,
};

@Injectable()
export class SkillSourceManager implements OnModuleDestroy {
  private readonly logger = new Logger(SkillSourceManager.name);
  private readonly sources = new Map<string, SkillSource>();
  private readonly skillsDir: string;
  private readonly systemSkillsDir: string;

  constructor(
    private configService: ConfigService,
    private loader: SkillLoaderService,
    private registry: SkillRegistry,
    private watcher: SkillWatcherService,
    private workspaceService: WorkspaceService,
  ) {
    this.skillsDir = this.configService.get<string>("SKILLS_DIR") ||
                     path.join(process.cwd(), "skills");
    this.systemSkillsDir = path.join(this.skillsDir, ".system");
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

    // system
    await this.register({
      key: "system",
      dir: this.systemSkillsDir,
      source: "system",
      baseDir: this.skillsDir,
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

  /** 重新注册 system + global 来源（用于手动触发重新扫描） */
  async restart(): Promise<void> {
    // 暂存所有待重载的 key
    const keys = Array.from(this.sources.keys());
    for (const key of keys) {
      await this.unregister(key);
    }
    await this.start();
    this.logger.log("Skill sources restarted");
  }

  // ── 注册 / 注销 ──

  async register(cfg: SkillSourceConfig): Promise<void> {
    if (this.sources.has(cfg.key)) return;

    const skills: SkillDefinition[] = [];

    try {
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
      // 目录不存在，注册一个空 source
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
            if (cfg.persistent) this.registry.update(sd);
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

  // ── Workspace 动态管理 ──

  @OnEvent("stream.started")
  async handleStreamStarted(event: StreamStartedEvent): Promise<void> {
    const wp = event.payload?.session?.workspacePath as string | undefined;
    if (!wp) return;

    const skillsDir = path.join(wp, WORKSPACE_SKILLS_RELATIVE);
    try {
      await fs.access(skillsDir);
    } catch {
      return; // 目录不存在，不注册
    }
    await this.registerOrRefresh({
      key: "workspace_" + wp,
      dir: skillsDir,
      source: "workspace",
      baseDir: skillsDir,
      persistent: false,
    });
  }

  // ── TTL ──

  private startTimer(key: string, src: SkillSource): void {
    if (src.timer) clearTimeout(src.timer);
    src.timer = setTimeout(() => {
      this.logger.log(`Skill source expired: ${key}`);
      this.unregister(key);
    }, src.ttlMs ?? DEFAULT_TTL);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, src] of this.sources) {
      if (src.createdAt < oldestTime) {
        oldestTime = src.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.unregister(oldestKey);
  }
}
