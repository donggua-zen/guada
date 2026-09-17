import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { SettingsStorage } from "../../utils/settings-storage.util";
import { UploadPathService } from "../../services/upload-path.service";
import {
  AGENT_FILE,
  AgentFileStore,
  REKEY_FILE,
  resolveAgentsDir,
} from "../../../modules/agents/agent-file.store";
import {
  isAvatarFileName,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  slugifyAgentId,
  AGENT_ID_MAX_LENGTH,
} from "../../../modules/agents/agent-file.mapper";

const MIGRATED_MARKER = ".migrated-from-db";

/**
 * ⚠️ 迁移脚手架（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 由 MigrationBootstrapService 编排调用，移除清单见 docs/design/metadata-file-format.md。
 *
 * 智能体定义 DB → 文件一次性导出（含引用重键）
 *
 * 权威源切换到 `agents/<id>/AGENT.md` 后，原 DB 主键（cuid）与新的目录名
 * （由 name 派生的 slug）不再相等。引用散落在 `session.agent_id`、
 * `bot_instance.default_agent_id`、调度任务 JSON，以及各智能体的
 * `settings.agents` 白名单键里，必须同批改写，否则会静默断链。
 *
 * 设计对齐 ProviderBootstrapService：
 * - 共用一个 marker，只跑一次；导出只读 DB、只写文件，DB 行原样保留作回滚
 * - 先跑 DB 迁移（0004 已解除 session→agent 外键），否则写非 cuid 值会撞外键
 *   （由编排器保证：migrationRunner.run() 先于本服务）
 * - 映射落在 `agents/.rekey.json`，供其它迁移（如模型引用改写）反查旧 id
 *
 * 顺序约束：必须先于 ProviderBootstrapService（其改写 AGENT.md frontmatter 需要
 * 智能体文件已存在）与 MetadataFileBootstrapService（其导出会话/机器人时读取的
 * DB 引用由本服务改写归一化）。
 */
@Injectable()
export class AgentFileBootstrapService {
  private readonly logger = new Logger(AgentFileBootstrapService.name);

  // 脚手架自持构造 store（不经 DI）：避免持久化模块反向 import 域模块。
  private readonly store: AgentFileStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsStorage: SettingsStorage,
    private readonly uploadPathService: UploadPathService,
  ) {
    this.store = new AgentFileStore();
  }

  /** @returns 是否完整执行（含引用改写成功）；失败时由编排器记日志，下次启动重试 */
  async run(): Promise<boolean> {
    const agentsDir = resolveAgentsDir();
    await fsp.mkdir(agentsDir, { recursive: true });
    const markerPath = path.join(agentsDir, MIGRATED_MARKER);
    if (fs.existsSync(markerPath)) return true;

    const exported = await this.exportAgents(agentsDir);
    if (!exported.ok) return false; // DB 不可读 / 引用改写失败：不落 marker，下次启动重试

    await this.writeMarker(markerPath);
    return true;
  }

  /**
   * @returns ok=false 表示未完成（DB 不可读或引用改写失败）
   *
   * 引用改写失败时不落 marker：外键未解除会让 update 抛错，此时若落 marker
   * 会永久留下指向旧 cuid 的悬空引用（会话/机器人/定时任务静默断链）。
   */
  private async exportAgents(
    agentsDir: string,
  ): Promise<{ ok: boolean }> {
    let rows: Array<Record<string, any>>;
    try {
      rows = await this.prisma.character.findMany({
        orderBy: { createdAt: "asc" },
      });
    } catch (err) {
      this.logger.warn(`DB unreadable, skip agent export: ${String(err)}`);
      return { ok: false };
    }

    if (rows.length === 0) {
      this.logger.log("No legacy agent rows; export skipped");
      return { ok: true };
    }

    // 已落盘目录名（小写）占位，避免新分配时撞名
    const taken = new Set<string>();
    for (const entry of await fsp.readdir(agentsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        taken.add(entry.name.toLowerCase());
      }
    }

    // 重跑时沿用上次的映射：既保证引用改写目标一致，也不会产生 `xxx-2` 重复目录
    const rekey = await this.readExistingRekey(agentsDir);
    let migrated = 0;

    for (const row of rows) {
      const name = String(row.title ?? row.id);
      const dirId =
        rekey[row.id] ?? this.uniqueId(slugifyAgentId(name), taken);
      rekey[row.id] = dirId;
      taken.add(dirId.toLowerCase());

      const dirPath = path.join(agentsDir, dirId);
      const mdPath = path.join(dirPath, AGENT_FILE);

      // 已存在则保留现有内容（可能是用户手改过的），只做引用改写
      if (fs.existsSync(mdPath)) continue;

      await fsp.mkdir(dirPath, { recursive: true });

      const settings = this.normalizeSettings(row.settings);
      const legacyAvatar =
        typeof row.avatarUrl === "string" && row.avatarUrl
          ? row.avatarUrl
          : null;

      const body = serializeAgentMarkdown({
        name,
        description: row.description ?? undefined,
        model: row.modelId ?? undefined,
        settings,
      });
      await fsp.writeFile(mdPath, body, "utf8");
      if (legacyAvatar) {
        await this.migrateAvatar(legacyAvatar, dirPath);
      }
      migrated += 1;
    }

    await fsp.writeFile(
      path.join(agentsDir, REKEY_FILE),
      JSON.stringify(rekey, null, 2),
      "utf8",
    );

    // 白名单键与外部引用必须在所有目录写完后统一改写（白名单指向的智能体可能尚未导出）
    const rewrittenAgents = await this.rewriteAgentWhitelists(agentsDir, rekey);
    const { sessions, bots, tasks, failed } =
      await this.rewriteExternalRefs(rekey);

    this.logger.log(
      `Agent definitions migrated from DB: ${migrated} written; ` +
        `refs rewritten: session=${sessions}, botInstance=${bots}, ` +
        `schedulerTask=${tasks}, agentWhitelist=${rewrittenAgents}` +
        (failed ? " (有引用改写失败，稍后重试)" : ""),
    );
    return { ok: !failed };
  }

  /** 旧头像文件 → 智能体目录内 `avatar.<ext>`（复制不删除，原文件保持可回滚） */
  private async migrateAvatar(
    legacyAvatarUrl: string,
    dirPath: string,
  ): Promise<void> {
    try {
      const physical = this.uploadPathService.toPhysicalPath(legacyAvatarUrl);
      if (!fs.existsSync(physical)) return;
      const ext = path.extname(physical).replace(".", "").toLowerCase() || "png";
      await fsp.copyFile(physical, path.join(dirPath, `avatar.${ext}`));
    } catch (err) {
      this.logger.warn(
        `Avatar migration failed for ${legacyAvatarUrl}: ${String(err)}`,
      );
    }
  }

  /**
   * 改写各智能体 frontmatter 的 `settings.agents` 白名单键（旧 id → 目录名）。
   * 只保留能映射到的键：映射不到的旧键（智能体已删）直接丢弃。
   */
  private async rewriteAgentWhitelists(
    agentsDir: string,
    rekey: Record<string, string>,
  ): Promise<number> {
    let changed = 0;
    const entries = await fsp.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dirId = entry.name;
      const mdPath = path.join(agentsDir, dirId, AGENT_FILE);
      try {
        const content = await fsp.readFile(mdPath, "utf8");
        const def = parseAgentMarkdown(content, dirId);
        const whitelist = def.settings?.agents;
        if (!whitelist || typeof whitelist !== "object" || Array.isArray(whitelist)) {
          continue;
        }
        const next: Record<string, any> = {};
        let touched = false;
        for (const [key, value] of Object.entries(whitelist)) {
          const mapped = rekey[key] ?? key;
          if (mapped !== key) touched = true;
          next[mapped] = value;
        }
        if (!touched) continue;
        def.settings.agents = next;
        await fsp.writeFile(mdPath, serializeAgentMarkdown(def), "utf8");
        changed += 1;
      } catch (err) {
        this.logger.warn(`Agent whitelist rewrite failed (${dirId}): ${String(err)}`);
      }
    }
    return changed;
  }

  /** 改写 DB 列与调度任务 JSON 里的智能体引用；failed=true 表示有目标未改写成功 */
  private async rewriteExternalRefs(rekey: Record<string, string>): Promise<{
    sessions: number;
    bots: number;
    tasks: number;
    failed: boolean;
  }> {
    const map = (value: string | null | undefined): string | null => {
      if (!value) return null;
      return rekey[value] ?? null;
    };

    let sessions = 0;
    let bots = 0;
    let tasks = 0;
    let failed = false;

    try {
      const sessionRows = await this.prisma.session.findMany({
        where: { characterId: { not: null } },
        select: { id: true, characterId: true },
      });
      for (const row of sessionRows) {
        const next = map(row.characterId);
        if (next && next !== row.characterId) {
          await this.prisma.session.update({
            where: { id: row.id },
            data: { characterId: next },
          });
          sessions += 1;
        }
      }
    } catch (err) {
      // 常见原因：0004 未执行（character 外键仍在）→ 升级外键前不能断链
      this.logger.error(`session.characterId rewrite failed: ${String(err)}`);
      failed = true;
    }

    try {
      // defaultCharacterId 在 schema 里非空（不能对非空字段做 not: null 过滤），
      // 空值由 map() 自然跳过
      const botRows = await this.prisma.botInstance.findMany({
        select: { id: true, defaultCharacterId: true },
      });
      for (const row of botRows) {
        const next = map(row.defaultCharacterId);
        if (next && next !== row.defaultCharacterId) {
          await this.prisma.botInstance.update({
            where: { id: row.id },
            data: { defaultCharacterId: next },
          });
          bots += 1;
        }
      }
    } catch (err) {
      this.logger.error(
        `botInstance.defaultCharacterId rewrite failed: ${String(err)}`,
      );
      failed = true;
    }

    try {
      tasks = await this.rewriteSchedulerTasks(rekey);
    } catch (err) {
      this.logger.warn(`scheduler task rewrite failed: ${String(err)}`);
      failed = true;
    }

    return { sessions, bots, tasks, failed };
  }

  private async rewriteSchedulerTasks(
    rekey: Record<string, string>,
  ): Promise<number> {
    const dataDir =
      process.env.USERDATA_DIR ||
      process.env.DATA_DIR ||
      path.join(process.cwd(), "data");
    const tasksFile = path.join(dataDir, "scheduler", "tasks.json");
    if (!fs.existsSync(tasksFile)) return 0;
    const parsed = JSON.parse(await fsp.readFile(tasksFile, "utf8"));
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tasks)
        ? parsed.tasks
        : null;
    if (!list) return 0;

    let changed = 0;
    for (const task of list) {
      if (!task || typeof task.agentId !== "string") continue;
      const next = rekey[task.agentId];
      if (next && next !== task.agentId) {
        task.agentId = next;
        changed += 1;
      }
    }
    if (changed > 0) {
      await fsp.writeFile(tasksFile, JSON.stringify(parsed, null, 2), "utf8");
    }
    return changed;
  }

  // --- 工具 ---

  /** 读取上次导出留下的旧 id → 目录名映射（不存在或损坏则返回空） */
  private async readExistingRekey(
    agentsDir: string,
  ): Promise<Record<string, string>> {
    try {
      const raw = await fsp.readFile(path.join(agentsDir, REKEY_FILE), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v) out[k] = v;
        }
        return out;
      }
    } catch {
      /* 首次导出或无映射 */
    }
    return {};
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

  private uniqueId(base: string, taken: Set<string>): string {
    let candidate =
      base.length > AGENT_ID_MAX_LENGTH
        ? base.slice(0, AGENT_ID_MAX_LENGTH)
        : base;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) {
      const suffix = `-${n++}`;
      candidate = `${base.slice(0, AGENT_ID_MAX_LENGTH - suffix.length)}${suffix}`;
    }
    return candidate;
  }

  private async writeMarker(markerPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(
      markerPath,
      `migrated at ${new Date().toISOString()}\n`,
      "utf8",
    );
  }
}
