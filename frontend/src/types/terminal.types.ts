/**
 * 终端 WebSocket 协议类型（前端，与后端对齐）
 */
export type ClientTerminalMessage =
  | { type: "input"; text: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

export type ServerTerminalMessage =
  | { type: "ready"; terminalId: string }
  | { type: "transcript"; text: string }
  | { type: "output"; text: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string; fixHint?: string };
