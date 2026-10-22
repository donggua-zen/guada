/**
 * Browser Script 运行时类型。
 *
 * 模型写一段 JS，脚本通过 browser/tab facade 编排多步浏览器操作。
 * 动作由 Electron 的 ivya live locator 解析，snapshot 只用于观察。
 */

import type { FileRef } from "../../../../common/types/conversation.types";

export interface BrowserScriptTraceStep {
  method: string;
  target?: string;
  ok: boolean;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 脚本内截图的结果条目。
 *
 * 截图只有一份持久副本（会话附件目录），因此这里记录 FileRef 与物理路径；
 * **绝不携带 base64**——本结构会进入 tool result meta / SSE / JSONL。
 */
export interface BrowserScriptScreenshot {
  /** 会话附件引用（sessions/<id>/images/...，refType='session'） */
  ref?: FileRef;
  /** 会话副本的物理绝对路径（模型可用 image_view 回看） */
  absolutePath?: string;
  /** saveTo 显式导出的工作区路径（仅当脚本请求导出时存在） */
  exportedPath?: string;
  width?: number;
  height?: number;
}

export interface BrowserScriptErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface BrowserScriptRunResult {
  status: "completed" | "failed" | "cancelled";
  /** 脚本 return 值（已通过 structured clone 校验，可 JSON 序列化） */
  value?: unknown;
  error?: BrowserScriptErrorPayload;
  trace: BrowserScriptTraceStep[];
  screenshots: BrowserScriptScreenshot[];
  logs: string[];
  lastUrl?: string;
  lastTitle?: string;
  durationMs: number;
}
