/**
 * 桌宠状态派生（纯函数，便于单测）。
 *
 * 用户确认的状态映射：
 * - idle  —— 空闲（无任务运行、无未读、无待答）
 * - walk  —— 1 个任务在跑
 * - run   —— 2 个及以上任务在跑
 * - yawn  —— 长时间空闲（打哈欠，单次播放后回到 idle）
 */

export type PetMode = "idle" | "walk" | "run" | "yawn";

/** 单条会话在桌宠气泡里的状态（优先级从高到低：待答 > 运行中 > 未读） */
export type PetSessionStatus = "awaiting" | "running" | "unread";

/** 气泡列表里的一条会话摘要（标题 + 状态，running 额外带工具名） */
export interface PetSessionBrief {
  sessionId: string;
  title: string;
  status: PetSessionStatus;
  /** 仅 running 项有：该会话当前执行的工具名 */
  toolLabel?: string;
}

/** 长时间空闲阈值：10 分钟没有任何任务/未读才打哈欠 */
export const PET_YAWN_IDLE_MS = 10 * 60 * 1000;

/** 气泡列表最多展示的会话条数（多余的在摘要行里体现为计数） */
export const PET_SESSION_LIST_LIMIT = 3;

export interface PetModeInput {
  /** 运行中的会话数 */
  running: number;
  /** 有未读的会话数 */
  unread: number;
  /** 有待答（等待用户回复/批准）的会话数 */
  awaiting?: number;
  /** 距离上次「有活动」（运行中/待答或有未读）过去了多久（ms） */
  idleMs: number;
}

/**
 * 模式派生。
 *
 * 优先级：任务数（run > walk）> 长空闲（yawn）> 空闲（idle）。
 * 有待答或未读但没有任务时不算「空闲到打哈欠」——用户有东西要看，别装睡。
 */
export function derivePetMode(input: PetModeInput): PetMode {
  const running = Math.max(0, Math.floor(input.running || 0));
  const unread = Math.max(0, Math.floor(input.unread || 0));
  const awaiting = Math.max(0, Math.floor(input.awaiting || 0));
  if (running >= 2) return "run";
  if (running === 1) return "walk";
  if (unread > 0 || awaiting > 0) return "idle";
  if (input.idleMs >= PET_YAWN_IDLE_MS) return "yawn";
  return "idle";
}

export interface PetBubble {
  /** 主行文案（摘要：会话标题 / 各类计数） */
  text: string;
  /** 副行文案（执行阶段 / 引导语） */
  sub: string;
  /** 语气：busy=有待答或任务在跑，idle=只是提醒 */
  tone: "busy" | "idle";
  /** 最多 3 条的会话列表（按状态优先级排序）；老载荷没有就退化为单行 */
  sessions?: PetSessionBrief[];
}

export interface PetBubbleInput {
  running: number;
  unread: number;
  /** 有待答（等待用户回复/批准）的会话数 */
  awaiting?: number;
  /** 最近活跃的 running 会话标题（单行回退用） */
  title?: string | null;
  /** 该会话当前执行的动作（工具名等） */
  toolLabel?: string | null;
  /** 待展示的会话列表（调用方已按最近活跃排序，这里做优先级稳定排序 + 截取） */
  sessions?: PetSessionBrief[];
}

// ──────────────────────────────────────────────────────────────
// 语义状态（mood）与素材能力映射
//
// 为什么要多这一层：同一批事件要喂给两种素材格式——
// 我们自己的逐帧素材只有 4 段（idle/walk/run/yawn），
// Codex 图集有 9 段（idle/running/waving/waiting/failed/review/…）。
// 前端只产「语义」状态，渲染层按素材实际支持的动作名做回退，
// 这样加新素材（包括将来用 hatch-pet 生成的）不用改前端。
// ──────────────────────────────────────────────────────────────

export type PetMood =
  | "starting"
  | "idle"
  | "working"
  | "waiting"
  | "success"
  | "error"
  | "sleeping"
  | "dragging-left"
  | "dragging-right";

/** 瞬态状态（启动问候 / 回合成功 / 回合失败）的展示时长 */
export const PET_TRANSIENT_MS = 2000;

export interface PetMoodInput {
  /** 运行中的会话数 */
  running: number;
  /** 有未读的会话数 */
  unread: number;
  /** 有待答（等待用户回复/批准）的会话数 */
  awaiting?: number;
  /** 距离上次活动过去了多久（ms） */
  idleMs: number;
  /** 最近一次回合终态（瞬态，带时间戳；超时由 derivePetMood 自己判断） */
  lastOutcome?: { kind: "success" | "error"; at: number } | null;
  /** 应用启动后的问候瞬态 */
  starting?: boolean;
  /** 拖动方向（渲染层知道，回传上来） */
  dragging?: "left" | "right" | null;
  /** 当前时间（测试可注入） */
  now?: number;
}

/**
 * 语义状态派生。
 *
 * 优先级（对齐 Codex 的状态折叠思路）：
 *   拖动 > 待答 > 失败 > 运行中 > 成功 > 启动 > 长空闲 > 空闲
 * 待答排得很高是因为它是**唯一需要用户动作**的状态——
 * 桌宠在这里换成 waiting，等于替用户喊一声「轮到你了」。
 */
export function derivePetMood(input: PetMoodInput): PetMood {
  const running = Math.max(0, Math.floor(input.running || 0));
  const unread = Math.max(0, Math.floor(input.unread || 0));
  const awaiting = Math.max(0, Math.floor(input.awaiting || 0));
  const now = input.now ?? Date.now();

  if (input.dragging === "left") return "dragging-left";
  if (input.dragging === "right") return "dragging-right";
  if (awaiting > 0) return "waiting";

  const outcome = input.lastOutcome;
  const outcomeFresh = Boolean(outcome) && now - (outcome?.at ?? 0) < PET_TRANSIENT_MS;
  if (outcomeFresh && outcome?.kind === "error") return "error";

  if (running > 0) return "working";
  if (outcomeFresh && outcome?.kind === "success") return "success";
  if (input.starting) return "starting";
  if (unread > 0) return "idle";
  if (input.idleMs >= PET_YAWN_IDLE_MS) return "sleeping";
  return "idle";
}

/** 素材能力：支持哪些动作名（由渲染层按素材实测） */
export type PetCapabilities = readonly string[] | ReadonlySet<string>;

function supports(caps: PetCapabilities, name: string): boolean {
  if (Array.isArray(caps)) return (caps as readonly string[]).includes(name);
  return (caps as ReadonlySet<string>).has(name);
}

/**
 * 语义状态 → 素材动作名（能力回退）。
 *
 * 逐帧素材：working 会按任务数选 walk/run，长空闲走 yawn（我们独有的哈欠）；
 * Codex 图集：working 统一 running（契约只有一个 running 行），
 * waiting/success/error 才有对应行，缺行一律回退 idle。
 */
export function resolveClip(
  mood: PetMood,
  caps: PetCapabilities,
  options: { running?: number } = {},
): string {
  const candidates: string[] = [];

  switch (mood) {
    case "starting":
      candidates.push("waving");
      break;
    case "working":
      // 图集只有 running；逐帧素材用 walk/run 表达「1 个 / 多个任务」
      candidates.push("running");
      if ((options.running ?? 0) >= 2) candidates.push("run");
      candidates.push("walk");
      break;
    case "waiting":
      candidates.push("waiting");
      break;
    case "success":
      candidates.push("review");
      break;
    case "error":
      candidates.push("failed");
      break;
    case "sleeping":
      candidates.push("yawn");
      break;
    case "dragging-left":
      candidates.push("running-left");
      break;
    case "dragging-right":
      candidates.push("running-right");
      break;
    case "idle":
      break;
  }

  candidates.push("idle");
  for (const name of candidates) {
    if (supports(caps, name)) return name;
  }
  return "idle";
}

/** 状态优先级：待答最需要用户介入，排最前（对齐 Qoder 的择优策略） */
const STATUS_PRIORITY: Record<PetSessionStatus, number> = {
  awaiting: 0,
  running: 1,
  unread: 2,
};

/**
 * 会话列表择优：按状态优先级稳定排序后截取。
 *
 * 输入应已按最近活跃降序；稳定排序保证同状态内维持活跃序。
 * 超出上限的不进列表——摘要行的计数文案仍能看到总量。
 */
export function pickPetSessions(
  sessions: PetSessionBrief[],
  limit: number = PET_SESSION_LIST_LIMIT,
): PetSessionBrief[] {
  return [...sessions]
    .sort(
      (a, b) =>
        (STATUS_PRIORITY[a.status] ?? STATUS_PRIORITY.unread) -
        (STATUS_PRIORITY[b.status] ?? STATUS_PRIORITY.unread),
    )
    .slice(0, Math.max(0, Math.floor(limit) || 0));
}

/** 摘要行：按类别拼接计数文案（沿用既有措辞，多类别用「 · 」连接） */
function buildSummaryText(
  awaiting: number,
  running: number,
  unread: number,
  title: string,
): string {
  const parts: string[] = [];
  if (awaiting > 0) parts.push(`${awaiting} 个会话待回复`);
  if (running > 0) {
    parts.push(running === 1 && title ? title : `${running} 个会话运行中`);
  }
  if (unread > 0) parts.push(`${unread} 个会话有未读消息`);
  return parts.join(" · ");
}

/**
 * 气泡内容。无内容可展示时返回 null（渲染层据此收起气泡，只剩宠物本体）。
 *
 * 有任务在跑时优先展示任务（标题 + 执行阶段），否则退化为未读提醒。
 * 传入 sessions 时额外产出排好序的会话列表，供渲染层画多行卡片。
 */
export function buildPetBubble(input: PetBubbleInput): PetBubble | null {
  const running = Math.max(0, Math.floor(input.running || 0));
  const unread = Math.max(0, Math.floor(input.unread || 0));
  const awaiting = Math.max(0, Math.floor(input.awaiting || 0));
  const title = (input.title ?? "").trim();
  const toolLabel = (input.toolLabel ?? "").trim();

  if (awaiting === 0 && running === 0 && unread === 0) return null;

  const sub = awaiting > 0 ? "有会话等待你的回复" : running > 0
    ? `正在执行 · ${toolLabel || "工具调用"}`
    : "点击打开最近会话";

  return {
    text: buildSummaryText(awaiting, running, unread, title),
    sub,
    tone: awaiting > 0 || running > 0 ? "busy" : "idle",
    sessions: input.sessions?.length
      ? pickPetSessions(input.sessions)
      : undefined,
  };
}
