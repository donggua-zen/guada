import type { ApiContext } from "./api-context";
import type { Message, MessageContent, MessageRole, TurnContent } from "@/types/message";
import type { DomainEvent } from "@/types/stream/domain-event.types";
import type { FileRef } from "@/types/stream/content-block.types";

/**
 * 后端三层 Turn（与 backend conversation.types 对齐的轻量镜像）。
 * Turn（回合外壳：user + assistant 一对一轮回）→ Message（一次调用/注入）→ ContentBlock[]。
 */
interface TurnLike {
  id: string;
  /** 前端展示链路（display 视图）透传后端 kind：'turn' 普通回合 / 'event' 事件外壳（command/compaction） */
  kind: "turn" | "event";
  metadata: Record<string, unknown>;
  messages: Array<{
    id: string;
    role: MessageRole;
    /** 消息种类：user=人类输入 / model=模型产出（与前端 TurnContent.kind 同一取值域） */
    kind?: "user" | "model";
    /** 消息来源（后端 Message.source）——"是否人类输入"的单一真相载体 */
    source?: { kind: string; [key: string]: unknown };
    /** 后端为 Unix 毫秒时间戳（replayer 从事件 time 还原），前端转 ISO 串使用 */
    createdAt?: number;
    metadata: Record<string, unknown>;
    content: Array<{
      type: string;
      text?: string;
      summary?: string;
      toolCallId?: string;
      name?: string;
      arguments?: string;
      content?: string;
      isError?: boolean;
      /** 块级注入标记（'system' = 系统注入，渲染层跳过） */
      origin?: "system";
      /** KB 引用明细（kb-ref 块） */
      kbRefs?: Array<{ id: string; name: string; description?: string }>;
      /** 块生命周期计时（后端 BlockAssembler 打点，随持久化落库） */
      timing?: { startedAt: number; finishedAt?: number };
      attachment?: Partial<FileRef>;
    }>;
  }>;
  visible: boolean;
}

/** MIME → 展示扩展名兜底（image/png → png） */
export function extFromMediaType(mediaType?: string): string | undefined {
  const subtype = mediaType?.toLowerCase().split("/")[1];
  if (!subtype) return undefined;
  if (subtype === "jpeg") return "jpg";
  return subtype;
}

/** ContentBlock → 前端 MessageContent 块。
 * toolResultsMap: toolCallId → 工具结果内容(由 turnsToFrontend 从 tool-result 块收集),挂到对应 tool-call。
 * createdAt: 消息级时间(ISO 串)下放到内容桶——TurnItem 的消息时间读自内容桶的 createdAt。
 * 注意：消息级 metadata 里的平铺 toolCalls/toolCallsResponse 是冗余字段（后端 content 里已有 tool-call 块），
 * 必须剔除，否则 reasoning/text 块也会携带 toolCalls 被 flattenSingleContent 误判为 tool item（双渲染）。 */
function blockToContent(
  block: TurnLike["messages"][number]["content"][number],
  msgMeta: Record<string, unknown>,
  toolResultsMap?: Record<string, unknown>,
  createdAt?: string,
  /** 块在消息内的序号 + 消息 id：P6c 起作为块唯一标识（原 contentId 已删除） */
  blockRef?: { index: number; messageId: string },
): MessageContent {
  // 剔除消息级冗余平铺字段（toolCalls/toolCallsResponse 只应来自块本身）
  const { toolCalls: _msgToolCalls, toolCallsResponse: _msgToolResponses, ...restMeta } = msgMeta || {};
  const content: MessageContent = {
    id: blockRef ? `${blockRef.messageId}-${blockRef.index}` : "",
    content:
      block.type === "text"
        ? block.text ?? ""
        : block.type === "tool-result"
          ? block.content ?? ""
          : null,
    reasoningContent: block.type === "reasoning" ? block.summary : null,
    metadata: { ...restMeta },
    state: { isStreaming: false },
    ...(createdAt ? { createdAt } : {}),
  };
  // 思考时长由块级 timing 派生（后端权威打点随持久化落库）
  if (block.type === "reasoning" && block.timing?.startedAt != null) {
    const segmentMs =
      block.timing.finishedAt != null
        ? block.timing.finishedAt - block.timing.startedAt
        : 0;
    content.thinkingDurationMs = Math.max(0, segmentMs);
  }
  // 块级注入标记透传（'system' = 系统注入，渲染层跳过不重建）
  if (block.type === "text" && block.origin) {
    content.origin = block.origin;
  }
  // KB 引用块：结构化明细挂载（chips 渲染数据源；正文不渲染序列化文本）
  if (block.type === "kb-ref") {
    content.kbRefs = block.kbRefs;
  }
  if (block.type === "image" || block.type === "file") {
    const att = block.attachment;
    content.files = [
      {
        // 展示 key：新数据无 attachmentId，用存储 url 兜底保证 v-for key 稳定
        id: att?.attachmentId || att?.url || att?.name || "",
        name: att?.name || "附件",
        url: att?.url,
        type: att?.mediaType,
        ext: att?.fileExtension || extFromMediaType(att?.mediaType),
        size: att?.bytes,
        previewUrl: att?.previewUrl,
        // refType 必须带下去：编辑重发要按它决定 url 是存储引用、工作目录相对引用还是本机路径
        refType: att?.refType,
      },
    ];
  }
  if (block.type === "tool-call" && block.toolCallId) {
    content.metadata = {
      ...content.metadata,
      toolCalls: [
        {
          id: block.toolCallId,
          type: "function",
          name: block.name,
          arguments: block.arguments,
        },
      ],
      // 把对应工具结果挂到该 tool-call 下(flattenSingleContent 从 toolCallsResponse 取 toolResponses)
      ...(toolResultsMap && toolResultsMap[block.toolCallId] !== undefined
        ? { toolCallsResponse: [toolResultsMap[block.toolCallId]] }
        : {}),
    };
  }
  if (block.type === "tool-result") {
    content.metadata = {
      ...content.metadata,
      toolCallId: block.toolCallId,
      name: block.name,
    };
  }
  return content;
}

/**
 * 单条后端三层消息(Message)→ 前端 TurnContent 块数组（二级结构：跳过 Message 容器级）。
 * role 按消息角色打标（user_message 广播/重放分支用），messageId 承载消息级 API 锚点
 * （编辑/审批/继续执行按 messageId 回传）。复用 blockToContent 转换逻辑，与折叠器块语义一致。
 */
export function messageToTurnContent(
  msg: TurnLike["messages"][number],
  msgMeta: Record<string, unknown> = msg.metadata || {},
): TurnContent[] {
  // 消息级时间(后端 Unix ms → ISO 串)下放到内容桶；缺失时不伪造
  const createdAtIso = msg.createdAt
    ? new Date(msg.createdAt).toISOString()
    : undefined;
  const role = msg.role || "user";
  // 来源透传：source.kind 是"是否人类输入"的单一真相，下游据此过滤注入消息
  const source = msg.source;
  const kind = msg.kind;
  return (msg.content || []).map((b, index) => ({
    ...blockToContent(b, msgMeta, undefined, createdAtIso, { index, messageId: msg.id }),
    role,
    messageId: msg.id,
    ...(source ? { source } : {}),
    ...(kind ? { kind } : {}),
  }));
}

export interface MessageApi {
  /**
   * 获取会话事件页（前端自折叠的加载源）
   * @param options.beforeSeq 页尾上限（含）；缺省 = 当前最后 seq（初始加载）
   * @param options.turns 本页有效回合数
   * @returns { events, endSeq, nextBeforeSeq, hasMore }——events 为 JSONL 领域事件原样（前端折叠器消费）
   */
  fetchSessionEvents(
    sessionId: string,
    options?: { beforeSeq?: number; turns?: number },
  ): Promise<{
    events: DomainEvent[];
    endSeq: number;
    nextBeforeSeq: number | null;
    hasMore: boolean;
  }>;
  importMessages(sessionId: string, messages: Array<Record<string, unknown>>): Promise<{ imported: number }>;
  createMessage(
    sessionId: string,
    content: string,
    files?: FileRef[],
    replaceTurnId?: string | null,
    knowledgeBaseIds?: string[],
  ): Promise<Message>;
  clearSessionMessages(sessionId: string): Promise<boolean>;
  /** 删除本轮对话（按回合 id，整轮遮蔽） */
  deleteTurn(sessionId: string, turnId: string): Promise<{ success: boolean }>;
  updateMessage(sessionId: string, messageId: string, data: Record<string, unknown>): Promise<Message>;
  /** 后端暂无此路由（web 搜索由插件侧实现），保留占位待接 */
  webSearch(messageId: string): Promise<unknown>;
  /** 统一交互应答（审批/询问/迭代暂停继续共用；requestId 为 ask_requested 帧携带的临时凭证 uuid，
   * 唤醒后端原地阻塞的工具/引擎，无超时） */
  respond(
    sessionId: string,
    requestId: string,
    answers: import("@/types/stream/event-chunk.types").AskAnswerItem[],
  ): Promise<{ success: boolean; requestId: string; answersCount: number }>;
}

export const messageApi: MessageApi = {
  async fetchSessionEvents(
    this: ApiContext,
    sessionId: string,
    options?: { beforeSeq?: number; turns?: number },
  ) {
    const params = new URLSearchParams();
    if (options?.beforeSeq !== undefined)
      params.append("beforeSeq", options.beforeSeq.toString());
    if (options?.turns !== undefined)
      params.append("turns", options.turns.toString());
    const queryString = params.toString();
    const url = queryString
      ? `/sessions/${sessionId}/events?${queryString}`
      : `/sessions/${sessionId}/events`;
    return await this._request<{
      events: DomainEvent[];
      endSeq: number;
      nextBeforeSeq: number | null;
      hasMore: boolean;
    }>(url);
  },

  async importMessages(this: ApiContext, sessionId: string, messages: Array<Record<string, unknown>>) {
    return await this._request<{ imported: number }>(`/sessions/${sessionId}/messages/import`, {
      method: "POST",
      data: messages,
    });
  },

  async createMessage(
    this: ApiContext,
    sessionId: string,
    content: string,
    files: FileRef[] = [],
    replaceTurnId: string | null = null,
    knowledgeBaseIds?: string[],
  ) {
    return await this._request<Message>(`/sessions/${sessionId}/messages`, {
      method: "POST",
      data: {
        content,
        files,
        replaceTurnId: replaceTurnId,
        knowledgeBaseIds: knowledgeBaseIds,
      },
    });
  },

  async clearSessionMessages(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: "DELETE",
    });
  },

  /** 删除本轮对话：DELETE /sessions/:sessionId/turns/:turnId */
  async deleteTurn(this: ApiContext, sessionId: string, turnId: string) {
    return await this._request(`/sessions/${sessionId}/turns/${turnId}`, { method: "DELETE" });
  },

  async updateMessage(this: ApiContext, sessionId: string, messageId: string, data: Record<string, unknown>) {
    return await this._request<Message>(`/sessions/${sessionId}/messages/${messageId}`, {
      method: "PUT",
      data,
    });
  },

  async webSearch(this: ApiContext, messageId: string) {
    return await this._request<unknown>(`/messages/${messageId}/web_search`, {
      method: "GET",
    });
  },

  /** 统一交互应答（按 requestId 凭证投递答案批，唤醒后端原地阻塞的工具/引擎） */
  async respond(
    this: ApiContext,
    sessionId: string,
    requestId: string,
    answers: import("@/types/stream/event-chunk.types").AskAnswerItem[],
  ) {
    return await this._request(`/chat/respond`, {
      method: "POST",
      data: { sessionId, requestId, answers },
    });
  },
};
