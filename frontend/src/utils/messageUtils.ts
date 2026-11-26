/**
 * 消息工具函数 TypeScript 版本
 */

// 统一复用 types/message 的消息/内容/附件类型（避免两套 Message 类型冲突）
import type { MessageContent, FileAttachment, MessageBundle, ToolCallResponseEntry, StampedBlock } from "@/types/message";
import { isStandaloneTool, type ToolCall } from "./toolDisplay";
import { isInTurnJobNoticeBundle } from "./jobNotice";
import { perfStart } from "./perf";
export type { Message, MessageContent, FileAttachment, MessageBundle } from "@/types/message";

/**
 * 用户消息束 → 编辑/复制视图（兼容旧消费方）。
 * bundle 是消息级聚合单元（消息级字段挂 bundle、块内不复制），但编辑/复制/重发等
 * 旧消费方仍按"单个对象带 content/files/id"访问。此函数聚合跨块文本与附件，
 * 并保留消息级元数据。注入块不入正文：origin='system'（系统提示，对用户不可见）
 * 与 kb-ref（KB 引用，TurnItem 按 chips 单独渲染）。
 */
export function toUserMessageView(
  bundle: MessageBundle | null | undefined,
): (MessageBundle & { content: string; files: FileAttachment[]; id: string }) | null {
  if (!bundle) return null;
  return {
    ...bundle,
    id: bundle.messageId,
    content: (bundle.blocks || [])
      .filter((b) => !(b as MessageContent).origin && !(b as MessageContent).kbRefs)
      .map((b) => b.content || "")
      .filter((t) => t.length > 0)
      .join("\n"),
    files: (bundle.blocks || []).flatMap((b) => b.files ?? []),
  };
}

/** KB 引用条目（块级 kbRefs / 历史 metadata 归一化后的展示形态） */
export interface KbRefLike {
  id: string;
  name: string;
  description?: string;
}

/**
 * 收集消息束的 KB 引用（chips 渲染 / 编辑回填 / 重答重发三处共用，保证单一事实源一致）。
 * 优先取 kb-ref 块明细（新架构落库形态，LLM 面投影、前端 chips 同源）；
 * 历史数据回退 metadata.referencedKbs（兼容 string[]（旧后端直接存 id 数组）
 * 与 {id,...}[] 两种形态，统一归一化为 {id, name}）。
 */
export function collectReferencedKbs(
  bundle: MessageBundle | null | undefined,
): KbRefLike[] {
  if (!bundle) return [];
  const fromBlocks = (bundle.blocks ?? []).flatMap((b) => b.kbRefs ?? []);
  if (fromBlocks.length > 0) return fromBlocks;
  const legacy = bundle.metadata?.referencedKbs;
  if (!Array.isArray(legacy)) return [];
  return legacy
    .map(
      (
        kb: string | { id?: string; name?: string; description?: string },
      ): KbRefLike => {
        if (typeof kb === "string") return { id: kb, name: kb };
        return {
          id: kb?.id,
          name: kb?.name || kb?.id,
          ...(kb?.description ? { description: kb.description } : {}),
        } as KbRefLike;
      },
    )
    .filter((kb: KbRefLike) => !!kb.id);
}

/**
 * 格式化思考时长
 * @param ms - 毫秒数
 * @returns 格式化后的时长
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "";
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(1);
  return `${minutes}分${remainingSeconds}秒`;
}

/**
 * 展示分组类型
 */
export type DisplayGroupType = "content" | "process";

/**
 * 展示项类型
 * 将大 content 拆分为独立的展示单元
 *
 * 'event' 代表**一整条事件卡**（压缩卡 / 上下文提示 / 截图裁剪 / 作业完成通知）：
 * 它不拆 think/content/tool，直接由 EventCard 读整条消息束渲染。
 */
export type DisplayItemType = "content" | "think" | "tool" | "event";

/**
 * 展示项接口
 * 扁平化结构，每个项只包含一种类型的内容
 */
export interface DisplayItem {
  id: string;
  type: DisplayItemType;
  // content 类型的内容
  content?: string;
  // think 类型的内容
  reasoningContent?: string;
  // tool 类型的内容（toolCalls 与 metadata.toolCalls / toolResponses 与
  // metadata.toolCallsResponse 同构，条目契约见 ToolCallEntry/ToolCallResponseEntry）
  toolCalls?: ToolCall[];
  toolResponses?: ToolCallResponseEntry[];
  /** event 类型的事件束（EventCard 的数据源） */
  event?: MessageBundle;
  // 引用原始 MessageContent，用于获取状态等元数据（event 项为事件束首块）
  source: MessageContent;
}

/**
 * 展示分组接口
 * 用于将连续的 think/tool 聚合为「中间处理过程」
 */
export interface DisplayGroup {
  id: string;
  type: DisplayGroupType;
  // process 组存 DisplayItem，content 组也存 DisplayItem（但只有一个 content 类型的）
  items: DisplayItem[];
  isCollapsible: boolean;
  isExpanded: boolean;
}

/**
 * 思考内容预览：按行拆分取最后一行（从行首显示、超长结尾截断）。
 * 思考中实时跟随最新一行变化，结束后保留——作为思考步骤行与
 * 分组标题的摘要文字（与工具行的 args 摘要同位）。
 */
export function getThinkingPreview(reasoningContent: string | null | undefined): string {
  if (!reasoningContent) return '';
  const span = perfStart('thinking.preview');
  try {
    const lines = reasoningContent.split('\n').map((l) => l.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';
    return lastLine.length > 200 ? lastLine.substring(0, 200) + '...' : lastLine;
  } finally {
    span?.end({ chars: reasoningContent.length });
  }
}

/**
 * 文本是否含可见内容（纯空白不算）。
 *
 * 上游会在正文前注入只含空格/换行的 message item（GPT6 每轮都有），后端按原文保留
 * 成独立 text 块。展示层统一用这个判定"有内容"，避免空块被当成正文渲染、被选中
 * 作为复制锚点，或被算进标题生成/大纲摘要。
 */
export function hasVisibleText(text?: string | null): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

/**
 * 块上的消息级戳记 —— 类型定义在 types/message（StampedBlock），此处转出供展示层引用。
 * 展示派生只需要"有则用"，不对块做强转。
 */
export type { StampedBlock } from "@/types/message";

/**
 * 该块是否属于"回合中段事件卡"。
 *
 * 判定只看块上的戳记（转换层对每条消息的每个块都写 role/source，见
 * services/modules/message.api.ts 的 messageToTurnContent）：
 * - role='event'：折叠器合成的事件束（压缩卡/上下文提示/截图裁剪/上下文窗口提示）
 * - source.kind ∈ {sub_agent, process_monitor}：工具边界注入的作业完成通知
 *   （角色仍是 'user'，靠 source.kind 与人类输入区分，词表见 utils/jobNotice）
 *
 * isInTurnJobNoticeBundle 需要 role + source + metadata，这里用块级戳记拼出同形状，
 * 保持"通知判定唯一真相"不出现第二份词表。
 */
export function isEventBlock(content: StampedBlock): boolean {
  if (content.role === "event") return true;
  return isInTurnJobNoticeBundle({
    role: content.role,
    source: content.source ?? null,
    metadata: content.metadata ?? null,
  });
}

/**
 * 事件块 → EventCard 消费的消息束形状。
 * EventCard 读 bundle 的 metadata（eventType/compressing/compactInfo/contextNotice…）
 * 与 blocks（展开后的正文）；事件块与其实所属束在这些字段上等价，故就地组一个单块束。
 */
function toEventBundle(content: StampedBlock): MessageBundle {
  const messageId = content.messageId ?? content.id;
  const role = content.role ?? "event";
  return {
    messageId,
    role,
    ...(content.source ? { source: content.source } : {}),
    metadata: content.metadata ?? {},
    // MessageBundle.blocks 的契约是 TurnContent（戳记必填）。展示层拿到的块可能缺戳记
    // （历史数据/外部导入），这里按块自身 id 与事件角色补齐——值是确定的，不是断言。
    blocks: [{ ...content, role, messageId }],
  };
}

/**
 * 将单个大 content 拆分为 DisplayItem 列表
 *
 * 事件卡（压缩/上下文提示/截图裁剪/作业完成通知）整条对应一个 event 项，不拆
 * think/content/tool：它的块级 metadata 里是卡片字段（eventType/compactInfo…），
 * 正文虽在 content 上（压缩摘要在 content、其余为空），但由 EventCard 读整束渲染，
 * 走块路径会被当成普通正文再画一遍。
 */
export function flattenSingleContent(content: StampedBlock): DisplayItem[] {
  // 事件卡：识别依赖块上的 role/source 戳记（折叠器/转换层对每条消息的每个块都打了）
  if (isEventBlock(content)) {
    return [
      {
        id: `${content.id}-event`,
        type: "event",
        event: toEventBundle(content),
        source: content,
      },
    ];
  }

  const items: DisplayItem[] = [];

  // 1. think
  //    纯空白思考块不渲染：上游没有思考内容时会发占位空格（与正文前占位 item 同源），
  //    落库后是只有空白的 reasoning 块。渲染它只会在过程组里留下「已思考」空行。
  //    流式期间同理——真在思考但还没出字时，底部的 ThinkingStatus 已经承担指示作用。
  if (hasVisibleText(content.reasoningContent)) {
    items.push({
      id: `${content.id}-think`,
      type: "think",
      reasoningContent: content.reasoningContent || "",
      source: content,
    });
  }

  // 2. content（排除 tool-result 块：其结果已挂到 tool-call 的 toolCallsResponse 内联展示，不重复渲染文本）
  if (hasVisibleText(content.content) && !content.metadata?.toolCallId) {
    items.push({
      id: `${content.id}-content`,
      type: "content",
      content: content.content as string,
      source: content,
    });
  }

  // 3. tool
  if (content.metadata?.toolCalls?.length) {
    items.push({
      id: `${content.id}-tool`,
      type: "tool",
      toolCalls: content.metadata.toolCalls,
      toolResponses: content.metadata.toolCallsResponse,
      source: content,
    });
  }

  return items;
}

/**
 * 将大 content 列表拆分为扁平化的 DisplayItem 列表（全量计算）
 */
function flattenContents(contents: StampedBlock[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const content of contents) {
    items.push(...flattenSingleContent(content));
  }
  return items;
}

/**
 * 执行分组逻辑
 *
 * 分隔符有三类：content、「独立渲染工具」（isStandaloneTool，如计划卡）与事件卡。
 * 后两者单独成组且不可折叠：独立渲染工具的正文就是用户要看的产物，事件卡则是
 * 时间线上的一次记录——折进过程标题会把"第几步发生了什么"抹平。
 */
function doGrouping(items: DisplayItem[]): DisplayGroup[] {
  const groups: DisplayGroup[] = [];
  let currentProcess: DisplayItem[] = [];

  const flushProcess = () => {
    if (currentProcess.length === 0) return;
    groups.push({
      id: `process-${currentProcess[0].id}`,
      type: "process",
      items: [...currentProcess],
      isCollapsible: true,
      isExpanded: false,
    });
    currentProcess = [];
  };

  for (const item of items) {
    if (item.type === "content") {
      flushProcess();
      groups.push({
        id: `content-${item.id}`,
        type: "content",
        items: [item],
        isCollapsible: false,
        isExpanded: true,
      });
      continue;
    }
    // 独立渲染工具：切断前后过程分组，单独成组且不可折叠（无标题行、直接渲染）。
    // 同块并行调用整项独立、不拆行——避免按 toolCallId 二次过滤响应
    if (item.type === "tool" && (item.toolCalls ?? []).some(isStandaloneTool)) {
      flushProcess();
      groups.push({
        id: `standalone-${item.id}`,
        type: "process",
        items: [item],
        isCollapsible: false,
        isExpanded: true,
      });
      continue;
    }
    // 事件卡：切断前后过程分组，单独成组且不可折叠（无标题行、直接由 EventCard 渲染）。
    // 位置 = 该事件块在消息流里的位置，与它真实发生的那一步对齐。
    if (item.type === "event") {
      flushProcess();
      groups.push({
        id: `event-${item.id}`,
        type: "process",
        items: [item],
        isCollapsible: false,
        isExpanded: true,
      });
      continue;
    }
    currentProcess.push(item);
  }

  flushProcess();
  return groups;
}

/**
 * 将消息内容列表按展示规则分组
 *
 * 核心规则：分隔符 = content（小 content）、独立渲染工具（isStandaloneTool）
 * 与事件卡
 * - 先把大 content 拆分为 think/content/tool/event 的 DisplayItem 列表
 * - 以 content 为界，把 think/tool 分别归入前后的 process 组
 * - content 自身单独成组
 * - 连续多个 think/tool 聚合成一个 process 组（一律可折叠：默认收起，点标题展开）
 * - 独立渲染工具（plan 卡等）单独成组且不可折叠，直接渲染
 * - 事件卡单独成组且不可折叠，位置 = 它在流里的位置
 *
 * 示例：
 *   单个大 content [think + content + tool] → 【process: think】→【content】→【process: tool】
 *   tool → submit_plan → tool → content
 *   分组：【process: tool】→【standalone: plan】→【process: tool】→【content】
 *   tool → 事件卡 → tool
 *   分组：【process: tool】→【event】→【process: tool】
 *
 * @param contents - 消息内容数组
 * @returns 展示分组数组
 */
export function groupContentsForDisplay(
  contents: StampedBlock[],
): DisplayGroup[] {
  if (!contents || contents.length === 0) return [];

  const span = perfStart("group.build");
  const items = flattenContents(contents);
  if (items.length === 0) return [];

  const groups = doGrouping(items);
  span?.end({ blocks: contents.length, groups: groups.length });
  return groups;
}

/**
 * 块是否应隐藏（唯一显隐开关 = metadata.hidden）
 *
 * 显隐与形态解耦（P4 修正）：
 * - 隐藏：仅 metadata.hidden === true（插件注入：TURN_STOPPING 续跑 / 工具图片 / 待办注入）
 * - 显示：其余全部——真实用户输入 + 队列投递的通知（sub_agent/scheduler/process_monitor，
 *   P4b 后 source.kind 非 'user'，但仍需展示，形态由 source.kind 区分）
 * - 无 metadata 的历史数据兜底：kind='model' 即模型工作流注入（隐藏语义的历史近似）
 *
 * @param block - 回合内容块（TurnContent 或任意带 metadata/kind 的对象）
 * @returns true = 应隐藏，不作为用户消息/锚点展示
 */
export function isHiddenBlock(
  block?: { metadata?: Record<string, unknown> | null; kind?: string } | null,
): boolean {
  if (!block) return false;
  const metadata = block.metadata;
  if (metadata && metadata.hidden === true) return true;
  // 无 metadata 的历史数据兜底：kind='model' 即模型工作流注入
  return block.kind === "model";
}

/**
 * 是否为主代理投递给子代理的协调者消息（source.kind='coordinator'）
 *
 * 它与人类输入共用同一条投递队列，但语义上不是人类发言：
 * - 是可见的真实回合锚点（刷新可回放，不再用 metadata.hidden 隐藏）
 * - 渲染成「主代理补充指令」样式，不作为可编辑/可重新生成的用户输入
 */
export function isCoordinatorMessage(
  message?: { source?: { kind?: string } | null; metadata?: Record<string, unknown> | null } | null,
): boolean {
  return message?.source?.kind === "coordinator";
}

/**
 * 剥离 <system_reminder> 标签，返回内部内容（P5b/P5c）
 *
 * 通知类消息（process_monitor / sub_agent）的 text 块以
 * `<system_reminder>...</system_reminder>` 包裹（仅模型面语义），
 * 前端展示需解析出标签内文本，避免原样渲染标签。无标签时原样返回。
 * 合并批次一条消息可含多段 reminder：全部剥出并按序拼接（空段丢弃）。
 */
export function stripSystemReminder(text: string): string {
  if (!text) return text;
  const matches = [...text.matchAll(/<system_reminder>([\s\S]*?)<\/system_reminder>/g)];
  if (matches.length === 0) return text;
  return matches
    .map((m) => m[1].trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}
