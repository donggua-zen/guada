import {
  extractBaseExternalId,
  hasResetMarker,
  parseExternalId,
} from './external-id';
import { isMeaningfulSenderName } from './bot-user';

/** 会话聚合所需的最小会话字段（SessionMeta 结构兼容） */
export interface ChatGroupSession {
  id: string;
  title?: string | null;
  botId?: string | null;
  platform?: string | null;
  externalId?: string | null;
  lastActiveAt?: string | null;
  /** 会话置顶标记；聚合到「用户」维度后决定该行的展示优先级 */
  pinned?: boolean;
  data?: Record<string, any> | null;
}

/** 机器人分组展示所需的最小机器人字段 */
export interface ChatBotMeta {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  status?: string;
  runtimeStatus?: string | null;
  online?: boolean;
  /** 用户拖拽设定的顺序；缺省/全 0 表示未拖过，分组退回按活跃排 */
  sortOrder?: number;
}

export interface BotChatSessionRef {
  id: string;
  title: string;
  lastActiveAt: string | null;
  /** 该会话是否已被 clear_session 清空（externalId 带 @timestamp） */
  cleared: boolean;
}

export interface BotChatConversation {
  /** 聚合键：botId + 基础 externalId */
  key: string;
  /** 默认打开的会话（该用户最新会话） */
  sessionId: string;
  /** 该用户全部会话，按 lastActiveAt 倒序 */
  sessions: BotChatSessionRef[];
  sessionCount: number;
  botId: string | null;
  platform: string | null;
  externalId: string | null;
  sourceType: 'private' | 'group' | null;
  nativeId: string | null;
  displayName: string;
  /** 平台提供的用户头像；缺失时前端回退到 IM 平台图标 */
  avatarUrl: string | null;
  lastActiveAt: string | null;
  cleared: boolean;
  /** 该用户名下任一会话被置顶，则整行置顶 */
  pinned: boolean;
}

export interface BotChatGroup {
  botId: string;
  name: string;
  platform: string;
  enabled: boolean;
  status: string;
  runtimeStatus: string | null;
  online: boolean;
  conversations: BotChatConversation[];
  /** 聚合后的用户会话数（未截断） */
  total: number;
  hasMore: boolean;
  unknownBot: boolean;
}

const UNKNOWN_BOT_NAME = '未知机器人';
const UNNAMED_CONVERSATION = '未命名会话';
/** 防止极端数据把整表读入后无限膨胀 */
const MAX_SESSIONS = 5000;

/**
 * 去掉 clear_session 写入的标题后缀：`xxx (已清空)` → `xxx`。
 * 该后缀由 session-management.plugin 硬编码，属于 Bot 会话的既有格式。
 */
export function stripClearedSuffix(title?: string | null): string {
  if (!title) return '';
  return title.replace(/\s*\(已清空\)\s*$/u, '').trim();
}

/**
 * 无昵称时的回退展示名：去掉 `平台 私聊/群聊 ` 前缀。
 *
 * 例：`WECOM 私聊 ZhenDong` → `ZhenDong`；
 *     `QQ 群聊 53790ECD` → `53790ECD`（行内仍有“群聊”标签）。
 * 平台前缀由 generateBotSessionTitleFromExternalId 生成，属于技术标识，
 * 不适合直接当用户名称展示。
 */
export function cleanSessionTitle(title?: string | null): string {
  const cleaned = stripClearedSuffix(title);
  const stripped = cleaned
    .replace(/^[A-Z0-9_-]+\s+(私聊|群聊)\s+/u, '')
    .trim();
  return stripped || cleaned;
}

function toTime(value?: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function pickDisplayName(
  sessions: ChatGroupSession[],
  latest: ChatGroupSession,
): string {
  for (const session of sessions) {
    const name = session.data?.botUser?.name;
    if (isMeaningfulSenderName(name)) {
      return name!.trim();
    }
  }
  return cleanSessionTitle(latest.title) || UNNAMED_CONVERSATION;
}

function pickAvatarUrl(sessions: ChatGroupSession[]): string | null {
  for (const session of sessions) {
    const url = session.data?.botUser?.avatarUrl;
    if (typeof url === 'string' && url.trim()) {
      return url.trim();
    }
  }
  return null;
}

/** 置顶行恒在前，其余按最后活跃时间倒序 */
function compareConversations(a: BotChatConversation, b: BotChatConversation): number {
  return (
    Number(b.pinned) - Number(a.pinned) ||
    toTime(b.lastActiveAt) - toTime(a.lastActiveAt)
  );
}

function buildConversation(
  botId: string | null,
  baseExternalId: string,
  sessions: ChatGroupSession[],
): BotChatConversation {
  const latest = sessions[0];
  const parsed = baseExternalId ? parseExternalId(baseExternalId) : null;
  const sessionRefs: BotChatSessionRef[] = sessions.map((session) => ({
    id: session.id,
    title: cleanSessionTitle(session.title) || UNNAMED_CONVERSATION,
    lastActiveAt: session.lastActiveAt ?? null,
    cleared: session.externalId ? hasResetMarker(session.externalId) : false,
  }));

  return {
    key: `${botId ?? ''}::${baseExternalId}`,
    sessionId: latest.id,
    sessions: sessionRefs,
    sessionCount: sessionRefs.length,
    botId,
    platform: latest.platform ?? parsed?.platform ?? null,
    externalId: baseExternalId || null,
    sourceType: parsed?.type ?? null,
    nativeId: parsed?.nativeId ?? null,
    displayName: pickDisplayName(sessions, latest),
    avatarUrl: pickAvatarUrl(sessions),
    lastActiveAt: latest.lastActiveAt ?? null,
    cleared: sessionRefs[0]?.cleared ?? false,
    pinned: sessions.some((session) => session.pinned === true),
  };
}

/**
 * 按「机器人 → 用户（botId + 基础 externalId）」聚合 Bot 会话。
 *
 * - 同一用户被 clear_session 拆分出的多个会话合并为一行，默认展示最新会话；
 * - 机器人分组来自 bots 列表（没有会话的机器人也会保留空分组）；
 * - 找不到对应机器人的会话归入「未知机器人」分组；
 * - 聚合在内存中完成，适合实验性规模；超大表后续可加 conversation_key 列走 SQL。
 */
export function buildChatGroups(
  sessions: ChatGroupSession[],
  bots: ChatBotMeta[],
  perBotLimit = 200,
): BotChatGroup[] {
  const limit = perBotLimit > 0 ? perBotLimit : Infinity;

  // botId -> 基础 externalId -> 会话列表（按 lastActiveAt 倒序）
  const byBot = new Map<string, Map<string, ChatGroupSession[]>>();
  const ordered = [...sessions]
    .filter((session) => !!session.id)
    .sort((a, b) => toTime(b.lastActiveAt) - toTime(a.lastActiveAt))
    .slice(0, MAX_SESSIONS);

  for (const session of ordered) {
    const botId = session.botId ?? '';
    const baseExternalId = session.externalId
      ? extractBaseExternalId(session.externalId)
      : session.id;

    if (!byBot.has(botId)) byBot.set(botId, new Map());
    const users = byBot.get(botId)!;
    if (!users.has(baseExternalId)) users.set(baseExternalId, []);
    users.get(baseExternalId)!.push(session);
  }

  const groups: BotChatGroup[] = [];

  // 已知机器人（包括没有会话的机器人）
  for (const bot of bots) {
    const users = byBot.get(bot.id);
    const conversations = users
      ? Array.from(users.entries()).map(([base, list]) =>
          buildConversation(bot.id, base, list),
        )
      : [];
    conversations.sort(compareConversations);

    groups.push({
      botId: bot.id,
      name: bot.name,
      platform: bot.platform,
      enabled: bot.enabled,
      status: bot.status ?? 'stopped',
      runtimeStatus: bot.runtimeStatus ?? null,
      online: bot.online === true,
      conversations: conversations.slice(0, limit),
      total: conversations.length,
      hasMore: conversations.length > limit,
      unknownBot: false,
    });
    byBot.delete(bot.id);
  }

  // 找不到机器人的会话：按实际 botId 分组，统一显示为「未知机器人」
  for (const [botId, users] of byBot.entries()) {
    const conversations = Array.from(users.entries()).map(([base, list]) =>
      buildConversation(botId || null, base, list),
    );
    conversations.sort(compareConversations);

    groups.push({
      botId: botId || '__unknown__',
      name: UNKNOWN_BOT_NAME,
      platform: conversations[0]?.platform ?? 'unknown',
      enabled: false,
      status: 'stopped',
      runtimeStatus: null,
      online: false,
      conversations: conversations.slice(0, limit),
      total: conversations.length,
      hasMore: conversations.length > limit,
      unknownBot: true,
    });
  }

  // 分组顺序：用户拖拽的 sortOrder 优先；全为 0（从未拖过）时自然退回按最近活跃冒泡
  const rankByBotId = new Map(bots.map((bot) => [bot.id, bot.sortOrder ?? 0]));

  groups.sort((a, b) => {
    if (a.unknownBot !== b.unknownBot) return a.unknownBot ? 1 : -1;
    const rank =
      (rankByBotId.get(a.botId) ?? 0) - (rankByBotId.get(b.botId) ?? 0);
    if (rank !== 0) return rank;
    const aLatest = toTime(a.conversations[0]?.lastActiveAt);
    const bLatest = toTime(b.conversations[0]?.lastActiveAt);
    if (aLatest !== bLatest) return bLatest - aLatest;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return groups;
}
