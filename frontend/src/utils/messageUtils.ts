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
