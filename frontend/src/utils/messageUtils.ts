/**
 * 消息工具函数 TypeScript 版本
 */

import { shallowReactive, type ShallowReactive } from "vue";
import { t } from "@/locales";
// 统一复用 types/message 的消息/内容/附件类型（避免两套 Message 类型冲突）
import type { Message, MessageContent, FileAttachment } from "@/types/message";
export type { Message, MessageContent, FileAttachment } from "@/types/message";

/**
 * 消息对类型
 */
export type MessagePair = [Message] | [Message, Message];

/**
 * 创建浅响应式消息对象
 * @param data - 消息数据
 * @returns 浅响应式消息对象
 */
export function createShallowMessage(data: Message): ShallowReactive<Message> {
  return shallowReactive({
    ...data,
    contents: data.contents?.map((c) => shallowReactive(c)) || [],
    files: data.files || [],
  });
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
 */
export type DisplayItemType = "content" | "think" | "tool";

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
  // tool 类型的内容
  toolCalls?: any[];
  toolResponses?: any[];
  // 引用原始 MessageContent，用于获取状态等元数据
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

/** 计算分组中实际步骤数（think 算1个，tool 按调用数算） */
export function countSteps(items: DisplayItem[]): number {
  return items.reduce((sum, item) => {
    if (item.type === 'tool' && item.toolCalls?.length) {
      return sum + item.toolCalls.length;
    }
    return sum + 1;
  }, 0);
}

/**
 * 将单个大 content 拆分为 DisplayItem 列表
 */
function flattenSingleContent(content: MessageContent): DisplayItem[] {
  const items: DisplayItem[] = [];

  // 1. think
  if (content.reasoningContent) {
    items.push({
      id: `${content.id}-think`,
      type: "think",
      reasoningContent: content.reasoningContent,
      source: content,
    });
  }

  // 2. content（排除 tool-result 块：其结果已挂到 tool-call 的 toolCallsResponse 内联展示，不重复渲染文本）
  if (
    content.content &&
    content.content.trim().length > 0 &&
    !content.metadata?.toolCallId
  ) {
    items.push({
      id: `${content.id}-content`,
      type: "content",
      content: content.content,
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
function flattenContents(contents: MessageContent[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const content of contents) {
    items.push(...flattenSingleContent(content));
  }
  return items;
}

/**
 * 执行分组逻辑
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
    } else {
      currentProcess.push(item);
    }
  }

  flushProcess();
  return groups;
}

/**
 * 将消息内容列表按展示规则分组（支持增量计算）
 *
 * 核心规则：content（小 content）是唯一的分隔符
 * - 先把大 content 拆分为 think/content/tool 的 DisplayItem 列表
 * - 以 content 为界，把 think/tool 分别归入前后的 process 组
 * - content 自身单独成组
 * - 连续多个 think/tool 聚合成一个 process 组
 * - process 组按包含的 think/tool 数量 > 1 时可折叠
 *
 * 性能优化：
 * - 使用消息级缓存避免重复计算
 * - 流式输出时只处理新增的 content
 *
 * 示例：
 *   单个大 content [think + content + tool] → 【process: think】→【content】→【process: tool】
 *   think → tool → think → content → tool → think → content
 *   分组：【process: think tool think】→【content】→【process: tool think】→【content】
 *
 * @param contents - 消息内容数组
 * @param messageId - 消息 ID（用于缓存隔离）
 * @returns 展示分组数组
 */
export function groupContentsForDisplay(
  contents: MessageContent[],
): DisplayGroup[] {
  if (!contents || contents.length === 0) return [];

  const items = flattenContents(contents);
  if (items.length === 0) return [];

  return doGrouping(items);
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
  block?:
    | { metadata?: Record<string, any> | null; kind?: string }
    | Record<string, any>
    | null,
): boolean {
  if (!block) return false;
  const metadata = (block as any).metadata as Record<string, any> | undefined;
  if (metadata && metadata.hidden === true) return true;
  // 无 metadata 的历史数据兜底：kind='model' 即模型工作流注入
  return (block as any).kind === "model";
}

/**
 * 剥离 <system_reminder> 标签，返回内部内容（P5b）
 *
 * 通知类消息（process_monitor / sub_agent）的 text 块以
 * `<system_reminder>...</system_reminder>` 包裹（仅模型面语义），
 * 前端展示需解析出标签内文本，避免原样渲染标签。无标签时原样返回。
 */
export function stripSystemReminder(text: string): string {
  if (!text) return text;
  const match = text.match(/<system_reminder>([\s\S]*?)<\/system_reminder>/);
  return match ? match[1].trim() : text;
}

/**
 * 从消息内容中提取标题
 * @param message - 消息对象
 * @returns 提取的标题文本
 */
export function extractMessageTitle(message: Message): string {
  // 从内容中提取第一行或前50字符（通知类先剥离 <system_reminder> 标签）
  const rawContent = message.contents?.[0]?.content || "";
  const content = stripSystemReminder(rawContent) || rawContent;
  if (!content) return t("chat.message.unnamed");

  // 去除 Markdown 标记和空白
  const cleanContent = content
    .split("\n")[0] // 取第一行
    .trim();

  // 限制长度
  return cleanContent.length > 50
    ? cleanContent.substring(0, 47) + "..."
    : cleanContent || t("chat.message.unnamed");
}
