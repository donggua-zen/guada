/**
 * Browser Script 运行时类型。
 *
 * 这是一条与现有 8 个 browser_* 工具平行的执行路径：
 * 模型写一段 JS，脚本通过 browser/tab facade 编排多步浏览器操作。
 * 后端仍复用 Electron Bridge 的既有 browser_* 方法，不替换原实现。
 */

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

export interface BrowserScriptScreenshot {
  path: string;
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
  /** 最后一次快照的代号；脚本可据此判断 ref 是否过期 */
  generation: number;
  lastUrl?: string;
  lastTitle?: string;
  durationMs: number;
}
