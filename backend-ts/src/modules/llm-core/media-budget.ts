/**
 * 请求级媒体字节预算（wire 视图裁剪，provider 无关）
 *
 * 问题：工具产出图（浏览器截图 / 桌面截图 / image_view）单张已被转码到 150KB 预算内，
 * 但**张数没有上限**。存储层把每张图的 FileRef 挂在 tool-result.images，请求边界
 * 展开成隐藏 user 消息后，adapter 每轮把**全部历史图片**重新转 base64 塞进请求体。
 * 而 token 计量对图片固定按 1500/张估算（token-meter.service.ts），压缩触发线是窗口
 * 的 0.9——一张 1M 窗口的会话可以带着上百张截图、请求体几十 MB，却永远触发不了压缩，
 * 直到撞上 provider/网关的 HTTP body 限制（413）。
 *
 * 本模块按**字节**做总账，与 token 预算正交：
 * - 最新一条真实用户消息的媒体受保护（用户刚发的图不应该被丢弃）；
 * - 其余媒体按从新到旧贪心装入预算，装不下的 image 块替换为带路径的文本占位——
 *   模型仍能凭路径调用 image_view / image_recognize 按需回看，信息没有真正丢失；
 * - 只改本次请求的 wire 副本，存储层 tool-result.images 原样保留（历史与前端展示不变）。
 *
 * 位置：必须排在 expandToolResultImages 之后（工具图此时已全部是 image 块），
 * 与 ensureToolPairing 同层——只改本次请求视图，不写回存储。
 *
 * 压力状态（shrinkMediaBudgetForSession）：上游真的返回 413 时，把该会话的预算对半砍并
 * 重试一次（见 compaction-coordinator 的 request_error 恢复路径）。状态放模块级 Map 并带
 * TTL，不污染 ISessionContext 接口，风格对齐 coordinator 现有的 overflowRetries。
 */
import { Logger } from '@nestjs/common';
import type { ContentBlock, Message } from '../../common/types/conversation.types';
import { resolveModelVisiblePath } from './utils/attachment.util';

/** 默认请求媒体预算：16 MiB（≈80 张 150KB 工具图，按其 base64 计约 200KB/张） */
export const DEFAULT_REQUEST_MEDIA_BUDGET_BYTES = 16 * 1024 * 1024;
/** 压力收缩的下限：低于此值再收缩没有意义（约 10 张图），交由上游错误兜底 */
export const MIN_REQUEST_MEDIA_BUDGET_BYTES = 2 * 1024 * 1024;
/** 压力状态 TTL：上游 413 恢复后一段时间内保持收紧，避免立刻反弹回原预算 */
export const MEDIA_BUDGET_PRESSURE_TTL_MS = 120_000;
/**
 * 淘汰边界的量化粒度（相对保留容量的比例）。
 *
 * 为什么需要量化：按「最新的、恰好填满预算的那一截」精确保留时，每新增一张图就会把
 * 最旧的一张挤成占位，裁剪点每轮前移一格。前缀缓存只能命中第一个差异点之前的部分——
 * 而差异点正好落在保留图片区的起点，于是**每次请求都要重发全部保留图片**（最贵的那部分）。
 *
 * 改为把淘汰数向上取整到**绝对下标**的整数倍：边界落在固定的下标上，追加新图不会移动它，
 * 于是连续若干次请求的 wire 逐字节一致（缓存可覆盖包含图片在内的整段历史），
 * 直到累计新图把最小淘汰数推过下一条边界才整体跳一格。
 *
 * 量化步长 = 保留容量 × 本比例。0.25 ⇒ 每 4 次请求约跳 1 次，最差仍保留约 3/4 的容量。
 * 注意：不能用「最少淘汰数 + 固定余量」——那个余量会随最少淘汰数一起每轮 +1，等于没锚定。
 */
export const MEDIA_BUDGET_EVICTION_OVERSHOOT = 0.25;

const logger = new Logger('MediaBudget');

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 默认请求媒体预算（字节）：env CHAT_REQUEST_MEDIA_BUDGET_MB，夹在 1..256 MiB */
export function getRequestMediaBudgetBytes(): number {
  return readIntEnv('CHAT_REQUEST_MEDIA_BUDGET_MB', 16, 1, 256) * 1024 * 1024;
}

// ─── 会话级压力状态 ───

interface MediaBudgetPressure {
  bytes: number;
  expiresAt: number;
}

const pressureBySession = new Map<string, MediaBudgetPressure>();

/**
 * 当前生效的媒体预算：无压力记录（或已过期）时用默认值，否则用收缩后的值。
 * 过期记录顺手清理，避免长时间运行的进程累积。
 */
export function getMediaBudgetBytesForSession(
  sessionId: string,
  nowMs: number = Date.now(),
): number {
  const pressure = pressureBySession.get(sessionId);
  if (!pressure) return getRequestMediaBudgetBytes();
  if (pressure.expiresAt <= nowMs) {
    pressureBySession.delete(sessionId);
    return getRequestMediaBudgetBytes();
  }
  return pressure.bytes;
}

/**
 * 上游报「请求体过大」后收缩该会话的预算（对半砍）。
 * @returns 新的预算字节；已到下限时返回 null（调用方保留原始错误，不再重试）
 */
export function shrinkMediaBudgetForSession(
  sessionId: string,
  nowMs: number = Date.now(),
): number | null {
  const current = getMediaBudgetBytesForSession(sessionId, nowMs);
  const next = Math.floor(current / 2);
  if (next < MIN_REQUEST_MEDIA_BUDGET_BYTES) return null;
  pressureBySession.set(sessionId, {
    bytes: next,
    expiresAt: nowMs + MEDIA_BUDGET_PRESSURE_TTL_MS,
  });
  return next;
}

/** 清除压力状态（模型/窗口变化、会话结束后调用；不改变正在进行中的请求） */
export function clearMediaBudgetPressure(sessionId: string): void {
  pressureBySession.delete(sessionId);
}

// ─── 投影 ───

export interface MediaBudgetProjectionOptions {
  /** 本次请求允许的媒体总字节；缺省读 env */
  maxMediaBytes?: number;
  /** 会话工作目录（占位文案里解析模型可读的绝对路径用） */
  workspaceDir?: string | null;
  /** 是否保护最后一条真实用户消息的媒体（默认 true） */
  preserveLatestUserMedia?: boolean;
  /**
   * 淘汰量化的过冲比例（0..0.9，默认 MEDIA_BUDGET_EVICTION_OVERSHOOT）。
   * 0 = 精确填充（缓存不友好）；越大越省缓存但单次多丢图。测试可注入。
   */
  evictionOvershoot?: number;
}

export interface MediaBudgetProjectionResult {
  messages: Message[];
  /** 被替换为占位的 image 块数量 */
  omittedImageCount: number;
  /** 预算内保留的 image 块数量 */
  retainedImageCount: number;
  /** 全部 image 块按 base64 计的字节数 */
  totalMediaBytes: number;
  /** 实际进入请求的媒体字节数 */
  projectedMediaBytes: number;
  /** 生效的预算 */
  maxMediaBytes: number;
}

interface ImageBlockRef {
  messageIndex: number;
  blockIndex: number;
  requestBytes: number;
  protected: boolean;
}

/**
 * base64 编码后的字符数（= 请求体里占的字节数，ASCII 单字节）。
 * bytes 是落盘体积；解码后重新编码的 base64 长度由它唯一确定。
 */
function base64LengthFor(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / 3) * 4;
}

/** 一个 image 块在请求体里的近似字节数 */
function imageRequestBytes(block: ContentBlock): number {
  if (block.type !== 'image') return 0;
  const url = block.attachment?.url;
  // data: URL 已内联 base64，长度即请求体开销
  if (url?.startsWith('data:')) return url.length;
  const bytes = block.attachment?.bytes;
  if (typeof bytes === 'number' && bytes > 0) return base64LengthFor(bytes);
  // 既无字节数又无 data URL（远程 http 链接）：按一个保守中位值计，避免零成本漏算
  return base64LengthFor(200 * 1024);
}

/** 最后一条真实用户消息（source.kind === 'user'）的下标；找不到返回 -1 */
function findLatestRealUserMessageIndex(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === 'user' && message.source.kind === 'user') return i;
  }
  return -1;
}

/**
 * 占位文案：保留路径，模型可按需回看。
 * 与 image-projection 的占位同构——不内联 base64，只给模型一个可用的工具入口。
 */
function imageOmittedText(
  attachment: ContentBlock & { type: 'image' },
  workspaceDir: string | null,
): string {
  const imagePath = resolveModelVisiblePath(attachment.attachment, {
    workspaceDir,
  });
  const pathInfo = imagePath
    ? ` Image file path: ${imagePath}. Call image_view with this path if you need to look at it again.`
    : '';
  return `[Image omitted from this request to keep the request body under the media budget.${pathInfo}]`;
}

/**
 * 决定从最旧端淘汰多少张图（淘汰后必须真的装得下）。
 *
 * @param evictable 可淘汰媒体（旧→新顺序）
 * @param availableBytes 保护媒体之外剩余的预算
 * @param overshoot 过冲比例（0..0.9）
 *
 * 思路：
 * 1. 求「精准填充」所需的最小淘汰数 minEvict（后缀和，见 minEvictCount）。
 * 2. 若已触发淘汰，则再额外多淘汰「保留容量的 overshoot 倍」——向上取整。
 *    只要新增的图没把 minEvict 推过这次多淘汰释放出的余量，淘汰数量就保持不变，
 *    裁剪点稳定，wire 前缀逐字节一致，缓存整段命中。
 * 3. 结果夹在 [minEvict, length] 内；量化只会删得更多，因此必然仍满足预算。
 */
function resolveEvictCount(
  evictable: readonly ImageBlockRef[],
  availableBytes: number,
  overshoot: number,
): number {
  if (evictable.length === 0) return 0;
  const minEvict = minEvictCount(evictable, availableBytes);
  if (minEvict <= 0) return 0;

  // 步长 = 保留容量 × 比例：决定"每隔约几步才跳一次边界"，也决定单次最多多丢多少张
  const keeping = evictable.length - minEvict;
  const ratio = Math.min(0.9, Math.max(0, overshoot));
  const step = Math.max(1, Math.round(keeping * ratio));
  // 关键：量化的是**绝对下标**，不是"最少淘汰数 + 余量"。
  // 前者让边界钉在固定下标上（追加新图不移动），后者会随最少淘汰数每轮一起增长。
  const boundary = Math.ceil(minEvict / step) * step;
  return Math.min(evictable.length, boundary);
}

/**
 * 求最小淘汰数 k，使得 evictable[k..] 的字节和 ≤ availableBytes。
 * 返回 evictable.length 表示全部淘汰（仍装不下受保护媒体时由调用方放行）。
 */
function minEvictCount(
  evictable: readonly ImageBlockRef[],
  availableBytes: number,
): number {
  // 从新到旧累加后缀和，首个 ≤ 预算的位置即为最小淘汰数
  let suffix = 0;
  let k = evictable.length;
  for (let i = evictable.length - 1; i >= 0; i--) {
    suffix += evictable[i]!.requestBytes;
    if (suffix > availableBytes) {
      // 加上第 i 张就超了 → 必须淘汰到 i（即保留 i+1..end）
      k = i + 1;
      break;
    }
    k = i;
  }
  return k;
}

/**
 * 按字节预算裁剪请求视图里的图片。
 *
 * 纯函数：不改入参，淘汰项生成一个新消息对象；没有任何 image 块时原样返回入参（零拷贝）。
 * 预算内 → 原样返回。超预算 → 保留受保护的最新用户媒体，其余从新到旧贪心装入。
 */
export function projectMessagesForMediaBudget(
  messages: readonly Message[],
  opts: MediaBudgetProjectionOptions = {},
): MediaBudgetProjectionResult {
  const maxMediaBytes = opts.maxMediaBytes ?? getRequestMediaBudgetBytes();
  const overshoot = opts.evictionOvershoot ?? MEDIA_BUDGET_EVICTION_OVERSHOOT;

  const refs: ImageBlockRef[] = [];
  // 哪些消息含图片：淘汰改写时按 messageIndex 直接判空，避免逐块线性查找
  const messagesWithImages = new Set<number>();
  messages.forEach((message, messageIndex) => {
    message.content.forEach((block, blockIndex) => {
      if (block.type !== 'image') return;
      refs.push({
        messageIndex,
        blockIndex,
        requestBytes: imageRequestBytes(block),
        protected: false,
      });
      messagesWithImages.add(messageIndex);
    });
  });

  if (refs.length === 0) {
    return {
      messages: messages as Message[],
      omittedImageCount: 0,
      retainedImageCount: 0,
      totalMediaBytes: 0,
      projectedMediaBytes: 0,
      maxMediaBytes,
    };
  }

  const latestUserIndex =
    opts.preserveLatestUserMedia === false
      ? -1
      : findLatestRealUserMessageIndex(messages);
  if (latestUserIndex >= 0) {
    for (const ref of refs) {
      if (ref.messageIndex === latestUserIndex) ref.protected = true;
    }
  }

  const totalMediaBytes = refs.reduce((sum, ref) => sum + ref.requestBytes, 0);
  if (totalMediaBytes <= maxMediaBytes) {
    return {
      messages: messages as Message[],
      omittedImageCount: 0,
      retainedImageCount: refs.length,
      totalMediaBytes,
      projectedMediaBytes: totalMediaBytes,
      maxMediaBytes,
    };
  }

  // 受保护媒体超出全部预算时也不能丢（用户刚发的图），直接放行——由上游错误兜底，
  // 与 zcode 的「当前附件本身过大 → 明确报错而非静默丢弃」取向一致：这里的取舍是
  // 让模型看到用户真正关心的图，而不是发出一份没有图的请求。
  const retained = new Set<string>();
  let remainingBytes = maxMediaBytes;
  for (const ref of refs) {
    if (!ref.protected) continue;
    retained.add(`${ref.messageIndex}:${ref.blockIndex}`);
    remainingBytes -= ref.requestBytes;
  }

  // 可淘汰媒体：refs 本身按消息顺序（旧→新），这里保持该顺序。
  // 淘汰总是从最旧的一端开始，因此保留集合 = 可淘汰序列的一个后缀。
  const evictable = refs.filter((ref) => !ref.protected);
  const evictCount = resolveEvictCount(evictable, remainingBytes, overshoot);

  for (let i = evictCount; i < evictable.length; i++) {
    const ref = evictable[i]!;
    retained.add(`${ref.messageIndex}:${ref.blockIndex}`);
  }

  const workspaceDir = opts.workspaceDir ?? null;
  const messagesWithBudget = messages.map((message, messageIndex) => {
    if (!messagesWithImages.has(messageIndex)) return message;
    const content: ContentBlock[] = message.content.map((block, blockIndex) => {
      if (block.type !== 'image') return block;
      if (retained.has(`${messageIndex}:${blockIndex}`)) return block;
      return {
        type: 'text',
        text: imageOmittedText(block, workspaceDir),
      };
    });
    return { ...message, content };
  });

  const projectedMediaBytes = refs
    .filter((ref) => retained.has(`${ref.messageIndex}:${ref.blockIndex}`))
    .reduce((sum, ref) => sum + ref.requestBytes, 0);
  const omittedImageCount = refs.length - retained.size;

  logger.warn(
    `[media-budget] omitted ${omittedImageCount}/${refs.length} images ` +
      `(retained ${retained.size}, media ${(projectedMediaBytes / 1024 / 1024).toFixed(1)}MiB ` +
      `of ${(totalMediaBytes / 1024 / 1024).toFixed(1)}MiB, budget ${(maxMediaBytes / 1024 / 1024).toFixed(1)}MiB)`,
  );

  return {
    messages: messagesWithBudget,
    omittedImageCount,
    retainedImageCount: retained.size,
    totalMediaBytes,
    projectedMediaBytes,
    maxMediaBytes,
  };
}
