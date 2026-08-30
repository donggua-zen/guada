/**
 * 内容块类型（ContentBlock 判别联合，含附件引用结构）
 *
 * 与后端 backend-ts/src/common/types/conversation.types.ts 的 ContentBlock 段
 * 逐字段同构（命名/判别字面量/字段结构一致）——SSE 流协议 block_end 事件
 * 携带的权威块即此结构。
 *
 * 迁移说明：将来做前后端共享包时，本文件整体搬入 packages/shared/src/conversation/，
 * 消费方 import 路径从 "@/types/stream" 改为 "@guada/shared" 即可。
 */

// ==================== ContentBlock（内容块，判别联合） ====================

/** 附件引用（物理文件在磁盘，前端仅需 url 访问；base64 由 adapter 在边界现转） */
export interface FileRef {
  /** 附件存储标识（非文件路径） */
  attachmentId: string;
  /** MIME 类型（image/png、text/plain 等） */
  mediaType: string;
  /** 字节数 */
  bytes: number;
  /** 显示名（去掉本地路径信息） */
  name?: string;
  /** 相对存储路径（前端静态访问用） */
  url?: string;
}

/**
 * 块生命周期计时（epoch ms）：由后端 BlockAssembler 在块首见/闭合时统一打点，
 * 随 block_end 权威块广播、随持久化落库；思考时长等派生视图以此为准。
 */
export interface BlockTiming {
  /** 块首见时间（block_start / 首个增量到达） */
  startedAt: number;
  /** 块闭合时间（block_end / 流结束收口）；未闭合时缺省 */
  finishedAt?: number;
}

/** 纯文本块 */
export interface TextBlock {
  type: 'text';
  contentId: string;
  text: string;
  timing?: BlockTiming;
}

/** 推理/思考块（与可见文本分离） */
export interface ReasoningBlock {
  type: 'reasoning';
  contentId: string;
  /** 推理文本 */
  summary: string;
  timing?: BlockTiming;
}

/** 模型请求的工具调用 */
export interface ToolCallBlock {
  type: 'tool-call';
  contentId: string;
  /** 供应商颁发的调用 id，与 tool-result 关联 */
  toolCallId: string;
  name: string;
  /** 模型产出的原始 JSON 参数字符串 */
  arguments: string;
  timing?: BlockTiming;
}

/** 工具执行结果（回传给模型） */
export interface ToolResultBlock {
  type: 'tool-result';
  contentId: string;
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** 图片块：始终引用（attachment.url），不内联 base64；LLM 侧由 adapter 转 base64 */
export interface ImageBlock {
  type: 'image';
  contentId: string;
  attachment: FileRef;
}

/** 通用文件块：引用为主。inline 为可选内联文本（当前版本不填充，统一引用） */
export interface FileBlock {
  type: 'file';
  contentId: string;
  attachment: FileRef;
  inline?: string;
}

/** 内容块判别联合 */
export type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | ToolCallBlock
  | ToolResultBlock
  | ImageBlock
  | FileBlock;

export type ContentBlockType = ContentBlock['type'];