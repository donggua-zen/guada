/**
 * 消息工具函数 TypeScript 版本
 */

import { shallowReactive, type ShallowReactive } from "vue";

/**
 * 消息接口定义
 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  contents: MessageContent[];
  parentId?: string;
  currentTurnsId?: string;
  state: {
    isStreaming: boolean;
    isThinking?: boolean;
  };
  createdAt?: string;
  files?: FileAttachment[];
  index?: number;
}

/**
 * 消息内容接口
 */
export interface MessageContent {
  id: string;
  role?: "user" | "assistant" | "tool";
  content: string | null;
  reasoningContent?: string | null;
  turnsId?: string;
  additionalKwargs?: Record<string, any>;
  metadata?: {
    toolCalls?: Array<{
      id?: string;
      name?: string;
      arguments?: any;
      args?: any;
      [key: string]: any;
    }>;
    toolCallId?: string;
    [key: string]: any;
  };
  createdAt?: string;
  updatedAt?: string;
  thinkingStartedAt?: number | null;
  thinkingDurationMs?: number | null;
  state: {
    isStreaming: boolean;
    isThinking: boolean;
  };
  _thinkingTimer?: number;
  isCurrent?: boolean;
}

/**
 * 文件附件接口
 */
export interface FileAttachment {
  id?: string;
  name: string;
  url?: string;
  type?: string;
  size?: number;
  file?: File;
  [key: string]: any;
}

/**
 * 消息对类型
 */
export type MessagePair = [Message] | [Message, Message];


/**
 * 获取当前内容索引（已废弃）
 * @deprecated 已废弃，直接使用 message.currentTurnsId 和 turns 过滤
 */
export function getCurrentIndex(messageContents: MessageContent[]): number {
  console.warn("getCurrentIndex 已废弃，请使用 message.currentTurnsId");
  if (!messageContents?.length) return 0;
  const currentIndex = messageContents.findIndex(
    (content) => content.isCurrent,
  );
  return currentIndex !== -1 ? currentIndex : 0;
}


/**
 * 获取当前版本的内容数组
 * @param message - 消息对象
 * @returns 当前版本的内容数组（过滤后的 turns）
 */
export function getCurrentTurns(message: Message): MessageContent[] {
  if (!message?.contents) return [];

  // 过滤掉无效的 content
  const validContents = message.contents.filter((content) => content != null);
  if (validContents.length === 0) return [];

  // 如果是 assistant 消息，根据 currentTurnsId 过滤
  if (message.role === "assistant" && message.currentTurnsId) {
    const matchedContents = validContents.filter(
      (content) => content.turnsId === message.currentTurnsId && content.role === "assistant"
    );

    // 对过滤后的内容进行工具调用预处理
    return matchedContents;
  }

  // User 消息或没有 currentTurnsId 的情况：返回所有内容
  return validContents;
}

/**
 * 获取当前内容的版本号集合
 * @param message - 消息对象
 * @returns 所有唯一的 turnsId 集合
 */
export function getContentVersions(message: Message): string[] {
  if (!message?.contents) return [];

  const versions = new Set<string>();
  message.contents.forEach((content) => {
    if (content.turnsId) {
      versions.add(content.turnsId);
    }
  });

  return Array.from(versions);
}

/**
 * 创建浅响应式消息对象
 * @param data - 消息数据
 * @returns 浅响应式消息对象
 */
export function createShallowMessage(data: Message): ShallowReactive<Message> {
  return shallowReactive({
    ...data,
    contents: data.contents?.map((c) => shallowReactive(c)) || [],
    state: shallowReactive(data.state || {}),
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

/**
 * 将消息内容列表按展示规则分组
 *
 * 核心规则：content（小 content）是唯一的分隔符
 * - 单个大 content 内部顺序：think → content → tool，顺序不可变
 * - 以 content 为界，把 think/tool 分别归入前后的 process 组
 * - content 自身单独成组
 * - 连续多个 think/tool（可来自不同大 content）聚合成一个 process 组
 * - process 组按包含的 think/tool 数量 > 1 时可折叠
 *
 * 示例：
 *   单个大 content [think + content + tool] → 【process: think】→【content】→【process: tool】
 *   think → tool → think → content → tool → think → content
 *   分组：【process: think tool think】→【content】→【process: tool think】→【content】
 *
 * @param contents - 消息内容数组
 * @returns 展示分组数组
 */
/**
 * 增量分组缓存
 * 用于优化流式输出时的分组计算性能
 */
interface GroupCache {
  // 缓存的源数据引用（用于快速判断是否需要重新计算）
  contentsRef: MessageContent[];
  // 缓存的扁平化结果
  items: DisplayItem[];
  // 缓存的分组结果
  groups: DisplayGroup[];
  // 最后处理的 content 索引（用于增量计算）
  lastContentIndex: number;
}

// 全局缓存（按消息 ID 隔离，避免不同消息间的缓存冲突）
const groupCacheMap = new Map<string, GroupCache>();

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

  // 2. content
  if (content.content && content.content.trim().length > 0) {
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
      isCollapsible: currentProcess.length > 1,
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
  _messageId?: string
): DisplayGroup[] {
  if (!contents || contents.length === 0) return [];

  const items = flattenContents(contents);
  if (items.length === 0) return [];

  return doGrouping(items);
}

/**
 * 从消息内容中提取标题
 * @param message - 消息对象
 * @returns 提取的标题文本
 */
export function extractMessageTitle(message: Message): string {

  // 从内容中提取第一行或前50字符
  const content = message.contents?.[0]?.content || "";
  if (!content) return "未命名消息";

  // 去除 Markdown 标记和空白
  const cleanContent = content
    .split("\n")[0] // 取第一行
    .trim();

  // 限制长度
  return cleanContent.length > 50
    ? cleanContent.substring(0, 47) + "..."
    : cleanContent || "未命名消息";
}
