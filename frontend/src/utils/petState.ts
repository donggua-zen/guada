/**
 * 桌宠状态派生（纯函数，便于单测）。
 *
 * 用户确认的状态映射：
 * - idle  —— 空闲（无任务运行、无未读）
 * - walk  —— 1 个任务在跑
 * - run   —— 2 个及以上任务在跑
 * - yawn  —— 长时间空闲（打哈欠，单次播放后回到 idle）
 */

export type PetMode = "idle" | "walk" | "run" | "yawn";

/** 长时间空闲阈值：10 分钟没有任何任务/未读才打哈欠 */
export const PET_YAWN_IDLE_MS = 10 * 60 * 1000;

export interface PetModeInput {
  /** 运行中的会话数 */
  running: number;
  /** 有未读的会话数 */
  unread: number;
  /** 距离上次「有活动」（运行中或有未读）过去了多久（ms） */
  idleMs: number;
}

/**
 * 模式派生。
 *
 * 优先级：任务数（run > walk）> 长空闲（yawn）> 空闲（idle）。
 * 有未读但没有任务时不算「空闲到打哈欠」——用户有东西要看，别装睡。
 */
export function derivePetMode(input: PetModeInput): PetMode {
  const running = Math.max(0, Math.floor(input.running || 0));
  const unread = Math.max(0, Math.floor(input.unread || 0));
  if (running >= 2) return "run";
  if (running === 1) return "walk";
  if (unread > 0) return "idle";
  if (input.idleMs >= PET_YAWN_IDLE_MS) return "yawn";
  return "idle";
}

export interface PetBubble {
  /** 主行文案（会话标题 / 未读提示） */
  text: string;
  /** 副行文案（执行阶段 / 引导语） */
  sub: string;
  /** 语气：busy=有任务在跑，idle=只是提醒 */
  tone: "busy" | "idle";
}

export interface PetBubbleInput {
  running: number;
  unread: number;
  /** 最近活跃的 running 会话标题 */
  title?: string | null;
  /** 该会话当前执行的动作（工具名等） */
  toolLabel?: string | null;
}

/**
 * 气泡内容。无内容可展示时返回 null（渲染层据此收起气泡，只剩宠物本体）。
 *
 * 有任务在跑时优先展示任务（标题 + 执行阶段），否则退化为未读提醒。
 */
export function buildPetBubble(input: PetBubbleInput): PetBubble | null {
  const running = Math.max(0, Math.floor(input.running || 0));
  const unread = Math.max(0, Math.floor(input.unread || 0));
  const title = (input.title ?? "").trim();
  const toolLabel = (input.toolLabel ?? "").trim();

  if (running > 0) {
    return {
      text: title || `${running} 个会话运行中`,
      sub: `正在执行 · ${toolLabel || "工具调用"}`,
      tone: "busy",
    };
  }
  if (unread > 0) {
    return {
      text: `${unread} 个会话有未读消息`,
      sub: "点击打开最近会话",
      tone: "idle",
    };
  }
  return null;
}
