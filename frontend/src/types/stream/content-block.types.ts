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

/**
 * 附件引用（self-contained 契约，与后端 conversation.types.ts FileRef 同构）：
 * 上传响应、发送 payload、事件块三端共用同一形状。mediaType 一律为真 MIME。
 */
export interface FileRef {
  /** MIME 类型（image/png、text/plain 等） */
  mediaType: string;
  /** 字节数 */
  bytes: number;
  /** 显示名（去掉本地路径信息） */
  name?: string;
  /** 存储锚点：相对存储路径（uploads/...）、data URL 或远程 URL；展示时绝对化 */
  url?: string;
  /** 预览路径（图片缩略图，展示用） */
  previewUrl?: string;
  /** 扩展名（不带点，如 png；文件展示用） */
  fileExtension?: string;
  /** @deprecated 旧数据读取回退；新写入不再产出 */
  attachmentId?: string;
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
  text: string;
  timing?: BlockTiming;
  /** 块级注入标记（与后端 conversation.types.ts 同构）：
   *  'system' = 系统注入文案（前端不渲染不重建） */
  origin?: 'system';
}

/** KB 引用块（结构化引用）：前端按 chips 渲染 kbRefs，不渲染序列化文本 */
export interface KbRefBlock {
  type: 'kb-ref';
  kbRefs: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  timing?: BlockTiming;
}

/** 推理/思考块（与可见文本分离） */
export interface ReasoningBlock {
  type: 'reasoning';
  /** 推理文本 */
  summary: string;
  timing?: BlockTiming;
}

/** 模型请求的工具调用 */
export interface ToolCallBlock {
  type: 'tool-call';
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
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  /**
   * UI 渲染元数据（仅前端消费，不进 LLM 上下文）。
   * card 标识结果卡片类型（terminal/diff/read/...），其余为该卡片的结构化字段。
   */
  meta?: Record<string, any>;
}

/** 图片块：始终引用（attachment.url），不内联 base64；LLM 侧由 adapter 转 base64 */
export interface ImageBlock {
  type: 'image';
  attachment: FileRef;
}

/** 通用文件块：引用为主。inline 为可选内联文本（当前版本不填充，统一引用） */
export interface FileBlock {
  type: 'file';
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
  | FileBlock
  | KbRefBlock;

export type ContentBlockType = ContentBlock['type'];