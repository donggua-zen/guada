/**
 * 终端模块类型定义
 *
 * 协议（WebSocket，对齐 DSH better-sidebar）：
 *  客户端 → 服务端：
 *    { type: "input", text: string }        输入（原始文本）
 *    { type: "resize", cols: number, rows: number }  resize
 *    { type: "close" }                       关闭终端
 *  服务端 → 客户端：
 *    { type: "transcript", text: string }    连接后回放历史
 *    { type: "output", text: string }        实时输出
 *    { type: "exit", code: number }          进程退出
 *    { type: "error", message: string, fixHint?: string }  错误
 */
export interface PtyHandle {
  /** 终端 id（UI: `${sessionId}:${uuid}` / agent: uuid） */
  id: string;
  /** 归属会话 */
  sessionId: string;
  /** 工作目录（会话工作区） */
  cwd: string;
  /** node-pty 实例 */
  pty: import("node-pty").IPty;
  /** 回放缓冲（有上限） */
  transcript: string;
  /** 进程是否已退出 */
  exited: boolean;
  /** 退出码 */
  exitCode?: number;
  /** WS 断连时间（undefined 表示在线）；超时后由回收器清理 */
  disconnectedAt?: number;
}

/** 客户端 → 服务端消息 */
export type ClientTerminalMessage =
  | { type: "input"; text: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

/** 服务端 → 客户端消息 */
export type ServerTerminalMessage =
  | { type: "ready"; terminalId: string }
  | { type: "transcript"; text: string }
  | { type: "output"; text: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string; fixHint?: string };
