/**
 * 三层对话模型 — 统一类型定义（命名对齐 deepseek-harness）
 *
 * 结构：
 *   Turn（回合外壳，一次输入回合）→ Message[]（真实消息：一次 LLM 调用 / 一次注入）→ ContentBlock[]（内容块）
 *
 * 命名规范（一层一词，不跨层混用）：
 *   - Turn.kind   ：回合种类（统一 'turn'，一次用户输入 + 助手多轮次/多版本）
 *   - Message.role：协议值（user / assistant / tool），转 OpenAI 等协议时直接映射
 *   - Message.kind：逻辑归属（user=真实用户 / model=模型工作流），解决"注入的系统提示/图片"
 *   - Message.source：来源细分（user / plugin / model / tool），未来承载更细来源
 *   - ContentBlock.type  ：内容形态（text / reasoning / tool-call / tool-result / image / file）
 */

// ==================== ContentBlock（内容块，判别联合） ====================

/**
 * 附件引用（self-contained 契约）：上传响应、发送 payload、JSONL 块三端共用同一形状。
 * 物理文件在磁盘，引用与元数据内嵌于事件；base64 由 adapter 在边界现转。
 * mediaType 一律为真 MIME（归一入口 normalizeMediaType，见 common/utils/media-type.util）。
 */
export interface FileRef {
  /** MIME 类型（image/png、text/plain 等） */
  mediaType: string;
  /** 字节数 */
  bytes: number;
  /** 显示名（去掉本地路径信息） */
  name?: string;
  /** 存储锚点：相对存储路径（uploads/...）、data URL 或远程 URL；后端读盘转 base64、前端展示时绝对化 */
  url?: string;
  /** 预览路径（图片缩略图，前端展示用） */
  previewUrl?: string;
  /** 扩展名（不带点，如 png；前端文件展示用） */
  fileExtension?: string;
  /** @deprecated 旧数据读取回退（旧 JSONL/迁移数据的附件标识）；新写入不再产出 */
  attachmentId?: string;
}

/**
 * 块生命周期计时（epoch ms）：由 BlockAssembler 在块首见/闭合时统一打点，
 * 随 block_end 权威块广播、随持久化落库，思考时长等派生视图均以此为准。
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
}

/** 图片块：始终引用（attachment.url），不内联 base64；LLM 侧由 adapter 转 base64 */
export interface ImageBlock {
  type: 'image';
  attachment: FileRef;
}

/**
 * 通用文件块：引用为主。
 * - inline 为可选内联文本（小文本文件时由转换层填充）——TODO：暂不启用，统一走 attachment.url 引用。
 */
export interface FileBlock {
  type: 'file';
  attachment: FileRef;
  /** TODO：小文本文件内联内容（当前版本不填充，统一引用） */
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

// ==================== Message（真实消息 = 一次 LLM 调用 / 一次注入） ====================

/** 协议值（role）：转 OpenAI 等协议时直接映射 system / user / assistant / tool；
 *  'event' 已废弃使用（2026-08-30：检查点改为 user + source.plugin='compact'，对齐 DSH
 *  MessageRole=system/user/assistant；保留类型值以兼容旧数据/代码） */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'event';

/** 逻辑归属（kind）：真实用户 / 模型工作流（含注入的系统提示、图片、工具结果） */
export type MessageKind = 'user' | 'model';

/**
 * 消息来源判别（对齐 DSH MessageSourceMap）
 *
 * 【单一真相】“这条消息是不是人类输入”唯一由 source.kind 决定，
 * 判断请用 isUserFacingMessage()，不要再读 metadata.hidden
 * （metadata.hidden 为历史兼容字段，DSH 决策笔记已否决 origin 判别字段）。
 *
 * 各写入点约定：
 * - user    ：终端用户真实输入（前端可见）
 * - plugin  ：插件注入（interceptor=TURN_STOPPING 续跑 / image=工具图片 /
 *             todo=待办注入 / compact=压缩检查点），非人类输入
 * - model   ：模型产出（role=assistant）
 * - tool    ：工具结果（role=tool）
 * - sub_agent / scheduler / process_monitor：跨回合投递的入站消息（队列来源）
 */
export type MessageSource =
  | { kind: 'user' } // 用户真实输入
  | { kind: 'plugin'; plugin: string } // 注入的用户消息（图片/拦截器/命令/压缩/待办）
  | { kind: 'model'; provider: string; model: string } // 模型产出
  | { kind: 'tool'; toolCallId: string } // 工具结果（role='tool'）
  | { kind: 'sub_agent'; subSessionId: string; agentName?: string } // 子代理结果回传
  | { kind: 'scheduler'; schedulerId: string } // 定时任务投递
  | { kind: 'process_monitor'; processId: string } // 后台进程结束通知
  | { kind: 'coordinator'; senderSessionId?: string }; // 协调者中继（未来：专家团/多代理）

/**
 * 消息是否面向用户的真实输入（单一真相 = source.kind）
 *
 * 后端语义：判断"是不是人说的话"（token 统计、模型可见性、审计等）。
 * 注意与前端显隐判定区分——前端展示用 isHiddenBlock（metadata.hidden 开关）：
 * 队列投递的通知（sub_agent/scheduler/process_monitor）非用户输入但仍需展示，
 * 前端显隐只看 metadata.hidden；本函数用于后端来源语义，两者不互相替代。
 */
export function isUserFacingMessage(
  message: Pick<Message, 'source'>,
): boolean {
  return message.source.kind === 'user';
}

/** 一次 LLM 调用的 token 明细 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** 缓存明细（read=命中读取 / written=写入缓存 / missed=未命中） */
  cachedTokens?: {
    read?: number;
    written?: number;
    missed?: number;
  };
  totalTokens: number;
  /** 推理 token（单独统计，对应思考块） */
  reasoningTokens?: number;
}

/** 真实消息 */
export interface Message {
  id: string;
  /** 协议值（user / assistant / tool），转协议直接映射 */
  role: MessageRole;
  /** 逻辑归属（user=真实用户 / model=模型工作流） */
  kind: MessageKind;
  /** 来源细分（未来承载更细来源；当前 user/plugin/model/tool） */
  source: MessageSource;
  /** 调用级元数据：usage / retryInfo 等 */
  metadata: {
    usage?: TokenUsage;
    retryInfo?: unknown;
    [key: string]: unknown;
  };
  /** 内容块（判别联合，可并存多种类型） */
  content: ContentBlock[];
  createdAt?: number;
}

// ==================== Turn（回合外壳） ====================

/** 回合种类：'turn' 一次用户输入 + 助手回答（一对一）；'event' 事件类消息外壳（command/compaction 等，非对话） */
export type TurnKind = 'turn' | 'event';

/** 回合外壳：一次输入回合（user + assistant，一对一） */
export interface Turn {
  id: string;
  kind: TurnKind;
  /** 回合级元数据：finishReason / errorDetail / modelName / totalDurationMs */
  metadata: {
    /** 模型结束原因（stop / tool-calls / error / timeout / user_cancel 等，原样保留） */
    finishReason?: string;
    /** 异常详情 */
    errorDetail?: unknown;
    /** 所用模型 */
    modelName?: string;
    /** 整轮耗时 ms */
    totalDurationMs?: number;
    [key: string]: unknown;
  };
  /** 真实消息（一次输入回合：user 锚点 + assistant/tool） */
  messages: Message[];
  /** 可见性（删除 = 遮蔽） */
  visible: boolean;
  createdAt?: number;
}
