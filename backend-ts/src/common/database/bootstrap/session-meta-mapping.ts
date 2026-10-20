/**
 * 会话元信息映射（DB session 行 → SessionMeta 文件形态）
 *
 * 从 MetadataFileBootstrapService 提取的共享纯函数：元数据映射单一来源，
 * 元信息导出（metadata-file-bootstrap）与会话消息迁移（session-message-db-migrator）
 * 共用，保证元信息转换线与消息迁移的 meta 修复口径逐字段一致。
 */
import type { SessionMeta } from "../../../modules/chat/session-meta.store";

/** DB 日期值（Date | 字符串 | null）→ ISO 字符串，不可解析返回 null */
export function toISO(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** DB session 行 → SessionMeta（全字段保留；id 即 cuid 目录名，无需重键） */
export function sessionRowToMeta(row: Record<string, any>): SessionMeta {
  const now = new Date().toISOString();
  return {
    id: String(row.id),
    title: row.title ?? null,
    avatarUrl: row.avatarUrl ?? null,
    description: row.description ?? null,
    modelId: row.modelId ?? null,
    // 右值是 prisma 字段名（DB 列 character_id，未改名），左键为文件 schema 新名
    agentId: row.characterId ?? null,
    groupId: row.groupId ?? null,
    settings:
      row.settings && typeof row.settings === "object" ? row.settings : null,
    // 冻结库无 data 列（通用扩展字段 2026-09-20 引入，仅存在于 SQLite 元库）
    data: null,
    sessionType: row.sessionType ?? "web",
    archived: row.archived === true,
    // 冻结库无 pinned 列（置顶 2026-10 引入，仅存在于 SQLite 元库）
    pinned: false,
    botId: row.botId ?? null,
    platform: row.platform ?? null,
    externalId: row.externalId ?? null,
    workspacePath: row.workspacePath ?? null,
    // 派生键（v6）由写入层的 upsertMetaRow/迁移按 workspacePath 计算
    workspaceKey: null,
    parentId: row.parentId ?? null,
    // 冻结库无 root_id 列；由 SQLite 元库导入时按父链回填
    rootId: null,
    closedAt: toISO(row.closedAt),
    closeReason: row.closeReason ?? null,
    createdAt: toISO(row.createdAt) ?? now,
    updatedAt: toISO(row.updatedAt) ?? now,
    lastActiveAt: toISO(row.lastActiveAt),
  };
}

/**
 * 骨架判定：库内行由孤儿自愈（SessionMetaStore.healOrphanRows）从事件日志重建的
 * 最小骨架（title/agentId/groupId 全空）——可安全地用 DB 行全量覆盖修复。
 * 用户实际使用过的行（任一字段有值）不触碰。
 */
export function isHealSkeletonMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return true;
  const m = meta as Record<string, any>;
  return !m.title && !m.agentId && !m.groupId;
}
