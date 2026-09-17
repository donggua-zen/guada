/**
 * 会话消息 DB → JSONL 迁移核心（被两处复用）：
 * - SessionMessageMigrationBootstrapService：启动期一次性迁移（marker 门控，常态路径）
 * - src/scripts/migrate-messages.ts：手动 --force 重迁 CLI
 *
 * 转换映射（对齐 DSH 分层事件模型，assistant/message 原生存储 ContentBlock[]）：
 *   Message（外壳）           → turn/start（kind=turn）
 *   user MessageContent       → user/message（blocks；hidden 注入 → kind='model'）
 *   assistant MessageContent  → assistant/message（reasoning/text/tool-call/image/file 块）
 *   tool MessageContent       → tool/result
 *   metadata.usage/finishReason/modelName → turn/finish
 *                                              + usedTokens 锚点（usage.promptTokens 真值优先，
 *                                                回退 surface 估算：字符/4 累计，importTurns 同口径）
 *                                              + effectiveContextWindow（model.config.contextWindow，
 *                                                CLI 可覆盖，兜底 128000）
 *   session_context_state（旧压缩记录）→ compaction/start + compaction/summary + compaction/end
 *
 * 每回合恒写 turn/finish（usedTokens 锚点兜底后，无 usage 的回合也有占用锚点——
 * 前端环形指示器与压缩历史 before/after 回退链依赖这些锚点）。
 *
 * 元信息修复：meta.json 缺失或为 heal 骨架（title/characterId/groupId 全空）时，
 * 从 DB session 行全量重写（复用 sessionRowToMeta，与元信息导出线同口径）——
 * healOrphanSessions 的骨架会让侧栏出现空行并丢失角色/分组/设置绑定。
 *
 * ⚠️ 只读 DB、只写文件，不删除任何数据库数据（可回滚/重新迁移）。
 */
import * as fsp from "fs/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
  BaseEvent,
} from "../../persistence/types";
import { MetadataBootstrapGate } from "../metadata-bootstrap.gate";
import { SessionFileStore } from "../../../modules/chat/session-file.store";
import { generateOrderedMessageId } from "../../../common/utils/ordered-id.util";
import {
  normalizeMediaType,
  isVisionImageMediaType,
} from "../../../common/utils/media-type.util";
import {
  isHealSkeletonMeta,
  sessionRowToMeta,
} from "./session-meta-mapping";

/** 迁移选项 */
export interface SessionMessageMigrateOptions {
  /** 覆盖重迁：已有 JSONL（>1 事件）也删除重建（手动 CLI 路径；bootstrap 恒为 false） */
  force?: boolean;
  /** 有效上下文窗口覆盖（缺省读 DB model.config.contextWindow，兜底 128000） */
  contextWindowOverride?: number;
}

export interface SessionMessageMigrateResult {
  /** 新迁移的会话数 */
  migrated: number;
  /** 已有 JSONL 跳过的会话数（幂等） */
  skipped: number;
  /** meta 骨架修复数（含缺失重建） */
  metaRepaired: number;
  /** 失败会话数 */
  failed: number;
}

/** 旧压缩记录行（session_context_state：schema 已冻结无 Prisma 模型，raw 读取） */
interface LegacyContextStateRow {
  summary_content: string | null;
  last_compacted_message_id: string | null;
  last_compacted_content_id: string | null;
  cleaning_strategy: string | null;
  updated_at: Date | string | null;
}

@Injectable()
export class SessionMessageDbMigratorService {
  private readonly logger = new Logger(SessionMessageDbMigratorService.name);

  // 脚手架自持构造 store（不经 DI）：避免持久化模块反向 import 域模块。
  private readonly sessionStore: SessionFileStore;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PERSISTENCE_BACKEND_TOKEN) private readonly backend: PersistenceBackend,
    gate: MetadataBootstrapGate,
  ) {
    this.sessionStore = new SessionFileStore(gate);
  }

  /** 列出所有有消息的会话（CLI 无参调用时的候选清单） */
  async listSessionsWithMessages(): Promise<
    Array<{ id: string; title: string | null; count: number }>
  > {
    const sessions = await this.prisma.session.findMany({
      where: { messages: { some: {} } },
      select: {
        id: true,
        title: true,
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      count: s._count.messages,
    }));
  }

  /** 全量迁移：逐会话幂等（已有 JSONL 跳过），meta 骨架修复不跳过 */
  async migrateAll(
    opts: SessionMessageMigrateOptions = {},
  ): Promise<SessionMessageMigrateResult> {
    const candidates = await this.listSessionsWithMessages();
    let migrated = 0;
    let skipped = 0;
    let metaRepaired = 0;
    let failed = 0;
    for (const c of candidates) {
      try {
        const r = await this.migrateSession(c.id, opts);
        migrated += r.migrated;
        skipped += r.skipped;
        metaRepaired += r.metaRepaired;
      } catch (e: any) {
        failed += 1;
        this.logger.warn(`会话 ${c.id} 迁移失败: ${e?.message ?? e}`);
      }
    }
    if (metaRepaired > 0) {
      await this.sessionStore.reload();
    }
    return { migrated, skipped, metaRepaired, failed };
  }

  /** 迁移单个会话（幂等；meta 修复独立于事件迁移执行） */
  async migrateSession(
    sessionId: string,
    opts: SessionMessageMigrateOptions = {},
  ): Promise<{ migrated: number; skipped: number; metaRepaired: number }> {
    // DB 会话行：title/init 事件与 meta 修复的数据源（只读）
    const dbRow = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (await this.backend.hasSession(sessionId)) {
      // 已损坏会话（seq 缺口等）无法 getAllEvents（会抛 CorruptSessionLogError）——
      // catch 后视为"需重迁"，无论是否 force 都删除重建（损坏日志不可用，重建是唯一出路）
      let existing: BaseEvent[] = [];
      let corrupted = false;
      try {
        existing = await this.backend.getAllEvents(sessionId);
      } catch (e: any) {
        corrupted = true;
        this.logger.warn(`会话 ${sessionId} 已有 JSONL 但损坏（${e?.message}），删除重迁`);
      }
      if (existing.length > 1) {
        if (!opts.force) {
          // 幂等：事件已迁移，仍执行 meta 修复（骨架修复不依赖事件重写）
          const repaired = await this.repairSessionMeta(sessionId, dbRow);
          return { migrated: 0, skipped: 1, metaRepaired: repaired };
        }
        const dbCount = await this.prisma.message.count({ where: { sessionId } });
        this.logger.log(
          `会话 ${sessionId} force 覆盖重迁（DB 有 ${dbCount} 条消息；DB 无消息行时按测试数据直接重建）`,
        );
        await this.removeSessionDir(sessionId);
      } else {
        // 空壳（只有 session/init）或损坏（getAllEvents 抛错）→ 删除重迁
        this.logger.log(
          `会话 ${sessionId} ${corrupted ? "损坏" : "为空壳"}，删除重迁`,
        );
        await this.removeSessionDir(sessionId);
      }
    }

    // 先读取 DB 消息，成功后再建会话（避免失败留下空壳）
    const messages = await this.loadMessagesBatched(sessionId);
    if (messages.length === 0) {
      const repaired = await this.repairSessionMeta(sessionId, dbRow);
      return { migrated: 0, skipped: 1, metaRepaired: repaired };
    }

    // 创建 JSONL 会话（session/init 携带真实 title，heal 兜底重建时也有正确标题）
    await this.backend.createSession(sessionId, {
      title: dbRow?.title || "新对话",
    });

    // 有效上下文窗口（turn/finish 与 compaction/end 锚点配套字段）
    const effectiveContextWindow = await this.resolveEffectiveContextWindow(
      sessionId,
      opts.contextWindowOverride,
    );

    const events: BaseEvent[] = [];
    // seq 从 1 开始：createSession 已写入 seq=0 的 session/init（会话首事件约定），
    // 迁移事件必须接续（从 0 开始会与 init 冲突 → 两个 seq 0 → 扫描报"期望 1，实际 0"缺口）
    let seq = 1;
    // 导入消息 id 序列（事件序）：旧压缩记录 shadowedCount 的定位依据
    const importedMessageIds: string[] = [];
    // surface 估算累计（字符）：无 provider usage 回合的 usedTokens 回退口径（importTurns 同款）
    let cumulativeChars = 0;
    // 最后一个回合的 usedTokens：compaction/end 锚点取值
    let lastUsedTokens = 0;

    for (const msg of messages) {
      // 仅 user 消息（parentId 为空）开新回合；assistant 版本由下方按组归并
      if (msg.parentId) continue;

      // 回合外壳：turn/start
      events.push({
        type: "turn/start",
        seq: seq++,
        time: new Date(msg.createdAt).getTime(),
        data: {
          turnId: msg.id,
          kind: "turn",
          metadata: msg.metadata,
        },
      });

      // 本回合 surface 字符累计（usedTokens 回退口径）
      let turnChars = 0;

      // 该 user 的 assistant 版本（parentId=本 user）：只保留最新一条为完整轮次
      const versions = messages.filter((m: any) => m.parentId === msg.id);
      const latestAssistant = versions.sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

      // 待写消息：user 外壳 + 最新 assistant 版本（含其全部内容块）
      const roundMsgs = latestAssistant ? [msg, latestAssistant] : [msg];

      // 消息级三事件（对齐 DSH：tool/result、assistant/message、user/message，合并原 content 块）
      for (const m of roundMsgs) {
        for (const content of m.contents) {
          const meta = (content.metadata as any) || {};
          const files = content.files.map((f: any) => ({
            fileId: f.id,
            fileName: f.fileName,
            displayName: f.displayName || f.fileName,
            fileSize: f.fileSize || 0,
            fileType: f.fileType,
            fileExtension: f.fileExtension,
            url: f.url,
            previewUrl: f.previewUrl,
            contentHash: f.contentHash,
          }));

          const isTool = content.role === "tool";

          if (isTool) {
            // 工具结果 → tool/result（归属由当前回合括号界定，不带 turnId）
            turnChars += (content.content || "").length;
            importedMessageIds.push(content.id);
            events.push({
              type: "tool/result",
              seq: seq++,
              time: new Date(content.createdAt).getTime(),
              data: {
                messageId: content.id,
                toolCallId: meta.toolCallId ?? "",
                name: meta.name,
                content: content.content || "",
                isError: meta.isError,
                metadata: meta,
              },
            });
          } else if (content.role === "assistant") {
            // 助手回答 → assistant/message（content 原生存储 ContentBlock[]，与内存/SSE 结构一致零转换）
            // 由 DB 平铺字段组装为块：reasoningContent → reasoning 块；content 文本 → text 块；
            // metadata.toolCalls → tool-call 块。顺序对齐运行时组装约定（reasoning → text → tool-call）。
            const blocks: Array<Record<string, unknown>> = [];
            let toolCallChars = 0;
            if (content.reasoningContent) {
              blocks.push({ type: "reasoning", summary: content.reasoningContent });
            }
            if (content.content) {
              blocks.push({ type: "text", text: content.content });
            }
            for (const tc of (meta.toolCalls ?? []) as any[]) {
              const argsJson =
                typeof tc?.arguments === "string"
                  ? tc.arguments
                  : JSON.stringify(tc?.arguments ?? {});
              toolCallChars += argsJson.length;
              blocks.push({
                type: "tool-call",
                toolCallId: tc?.id ?? "",
                name: tc?.name ?? "",
                arguments: argsJson,
              });
            }
            turnChars +=
              (content.reasoningContent?.length ?? 0) +
              (content.content?.length ?? 0) +
              toolCallChars;
            importedMessageIds.push(content.id);

            events.push({
              type: "assistant/message",
              seq: seq++,
              time: new Date(content.createdAt).getTime(),
              data: {
                messageId: content.id,
                content: blocks,
                metadata: meta,
              },
            });
          } else {
            // 用户消息 → user/message（真实用户 kind='user'；注入 kind='model'；归属由当前回合括号界定）
            const userBlocks: Array<Record<string, unknown>> = [];
            turnChars += content.content?.length ?? 0;
            importedMessageIds.push(content.id);
            if (content.content) {
              userBlocks.push({ type: "text", text: content.content });
            }
            for (const f of files) {
              // 旧 DB fileType 为 'image'/'text' 语义值 → 归一为真 MIME（与 replayer 读取路径同口径）
              const mediaType = normalizeMediaType(f.fileType, f.fileExtension);
              userBlocks.push({
                type: isVisionImageMediaType(mediaType) ? "image" : "file",
                attachment: {
                  mediaType,
                  bytes: f.fileSize || 0,
                  name: f.displayName ?? f.fileName,
                  url: f.url ?? f.previewUrl,
                },
              });
            }
            events.push({
              type: "user/message",
              seq: seq++,
              time: new Date(content.createdAt).getTime(),
              data: {
                messageId: content.id,
                kind: meta.hidden === true ? "model" : "user",
                blocks: userBlocks,
                metadata: meta,
              },
            });
          }
        }
      }

      // 回合完成信息 → turn/finish（恒写：usedTokens 锚点兜底，无 usage 的回合也有占用锚点）。
      // usage 取最新 assistant 内容块 meta（块级是真源，外壳 meta_data 仅 133 条有 usage）；
      // 无 usage/为 0 时回退 surface 估算（字符/4 累计，importTurns 同口径）。
      const finishMsg = latestAssistant ?? msg;
      const lastAssistantContent = [...finishMsg.contents]
        .reverse()
        .find((c: any) => c.role === "assistant");
      const lastMeta = (lastAssistantContent?.metadata as any) || {};
      const usage = lastMeta.usage || {};
      const promptTokens = usage.promptTokens ?? 0;
      cumulativeChars += turnChars;
      lastUsedTokens =
        promptTokens > 0 ? promptTokens : Math.ceil(cumulativeChars / 4);
      events.push({
        type: "turn/finish",
        seq: seq++,
        time: new Date(
          lastAssistantContent?.updatedAt ?? finishMsg.updatedAt,
        ).getTime(),
        data: {
          turnId: msg.id,
          promptTokens,
          completionTokens: usage.completionTokens ?? 0,
          cachedTokens: usage.cachedTokens?.read ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          usedTokens: lastUsedTokens,
          effectiveContextWindow,
          ...(lastMeta.finishReason !== undefined
            ? { finishReason: lastMeta.finishReason }
            : {}),
          ...(finishMsg.totalDurationMs != null
            ? { totalDurationMs: finishMsg.totalDurationMs }
            : {}),
          ...(lastMeta.modelName !== undefined
            ? { modelName: lastMeta.modelName }
            : {}),
        },
      });
    }

    // 旧压缩记录 → compaction 括号事件（session_context_state：schema 已冻结无 Prisma 模型，raw 读取；
    // 表不存在或该会话无记录 → 无压缩历史，跳过）。括号置于回合事件后（seq 顺延），time 取记录 updated_at；
    // end 锚点取最后回合 usedTokens（旧记录无压缩后实测占用的近似口径）。
    const ctxState = await this.loadLegacyContextState(sessionId);
    if (ctxState) {
      const compactionTime = ctxState.updated_at
        ? new Date(ctxState.updated_at).getTime()
        : Date.now();
      // 遮蔽边界 id 可能指向 message（外壳）或 message_content（内容级）→ 依次对导入消息 id 序列定位
      const boundaryId =
        ctxState.last_compacted_content_id ||
        ctxState.last_compacted_message_id ||
        "";
      const shadowedIdx = boundaryId
        ? importedMessageIds.indexOf(boundaryId)
        : -1;
      events.push(
        {
          type: "compaction/start",
          seq: seq++,
          time: compactionTime,
          data: { sourceCommandId: "legacy_db" },
        },
        {
          type: "compaction/summary",
          seq: seq++,
          time: compactionTime,
          data: {
            ...(boundaryId ? { shadowedEndId: boundaryId } : {}),
            shadowedCount: shadowedIdx >= 0 ? shadowedIdx + 1 : 0,
            summary: ctxState.summary_content || "",
            summaryMessageId: generateOrderedMessageId("c"),
          },
        },
        {
          type: "compaction/end",
          seq: seq++,
          time: compactionTime,
          data: {
            sourceCommandId: "legacy_db",
            usedTokens: lastUsedTokens,
            effectiveContextWindow,
          },
        },
      );
      this.logger.log(
        `会话 ${sessionId} 迁移压缩记录（strategy=${ctxState.cleaning_strategy ?? "unknown"}, shadowed=${shadowedIdx >= 0 ? shadowedIdx + 1 : 0}）`,
      );
    }

    // 批量写入
    await this.backend.appendEvents(sessionId, events);

    // meta 修复（新建迁移的会话 meta.json 缺失 → 直接从 DB 行写全量）
    const metaRepaired = await this.repairSessionMeta(sessionId, dbRow);

    this.logger.log(
      `会话 ${sessionId} 迁移 ${messages.length} 条消息, ${events.length} 个事件` +
        (metaRepaired ? "（meta 已修复）" : ""),
    );
    return { migrated: 1, skipped: 0, metaRepaired };
  }

  // ─── 元信息修复 ───

  /**
   * meta 骨架修复：meta.json 缺失，或为 healOrphanSessions 重建的最小骨架
   * （title/characterId/groupId 全空，侧栏空行 + 丢绑定）→ 从 DB 行全量重写。
   * 用户实际使用过的 meta（任一字段有值）不触碰。DB 无该行（纯 JSONL 会话）→ 跳过。
   */
  private async repairSessionMeta(
    sessionId: string,
    dbRow: Record<string, any> | null,
  ): Promise<number> {
    if (!dbRow) return 0;
    let current: unknown = null;
    try {
      const raw = await fsp.readFile(this.sessionStore.getMetaPath(sessionId), "utf-8");
      current = JSON.parse(raw);
    } catch {
      current = null; // 缺失/损坏 → 视为骨架
    }
    if (!isHealSkeletonMeta(current)) return 0;
    await this.sessionStore.writeMetaDirect(sessionRowToMeta(dbRow as Record<string, any>));
    return 1;
  }

  // ─── DB 读取 ───

  /** 分批加载会话消息，规避 SQLite 参数限制 */
  private async loadMessagesBatched(sessionId: string): Promise<any[]> {
    const BATCH_SIZE = 30;
    const totalCount = await this.prisma.message.count({ where: { sessionId } });
    const messages = [];
    for (let skip = 0; skip < totalCount; skip += BATCH_SIZE) {
      const batch = await this.prisma.message.findMany({
        where: { sessionId },
        include: {
          contents: {
            orderBy: { createdAt: "asc" },
            include: { files: { orderBy: { createdAt: "asc" } } },
          },
        },
        orderBy: { createdAt: "asc" },
        skip,
        take: BATCH_SIZE,
      });
      messages.push(...batch);
    }
    return messages;
  }

  /** 解析有效上下文窗口：CLI 覆盖 → DB model.config.contextWindow → 128000 兜底 */
  private async resolveEffectiveContextWindow(
    sessionId: string,
    override?: number,
  ): Promise<number> {
    if (override && override > 0) return override;
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { modelId: true },
      });
      if (session?.modelId) {
        const model = await this.prisma.model.findUnique({
          where: { id: session.modelId },
          select: { config: true },
        });
        const cfg = model?.config as any;
        const cw = cfg?.contextWindow ?? cfg?.config?.contextWindow;
        if (typeof cw === "number" && cw > 0) return cw;
      }
    } catch {
      // 模型缺失/配置异常 → 兜底
    }
    return 128000;
  }

  /** 读取旧压缩记录（每会话至多一行，session_id 唯一；表不存在/查询失败 → null） */
  private async loadLegacyContextState(
    sessionId: string,
  ): Promise<LegacyContextStateRow | null> {
    try {
      const rows = await this.prisma.$queryRaw<LegacyContextStateRow[]>`
        SELECT summary_content, last_compacted_message_id, last_compacted_content_id,
               cleaning_strategy, updated_at
        FROM session_context_state
        WHERE session_id = ${sessionId}
      `;
      return rows[0] ?? null;
    } catch {
      return null; // 旧库无此表
    }
  }

  /** 删除会话目录（仅用于清理空壳/损坏/force 覆盖重迁） */
  private async removeSessionDir(sessionId: string): Promise<void> {
    await fsp.rm(this.sessionStore.getSessionDir(sessionId), {
      recursive: true,
      force: true,
    });
  }
}
