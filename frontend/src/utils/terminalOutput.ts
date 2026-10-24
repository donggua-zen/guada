/**
 * 终端类工具结果解析（标记契约，对齐 DSH parseExitStatus 的思路）
 *
 * 后端 shell 工具（run_command / job_read）的模型文本契约：
 *   stdout 裸文本（空则 "(no output)"）+ 行级 [...] 标记；[exit code: N, uptime: X] 恒为末行。
 * 旧格式（历史会话）：`Latest output:\n---\nX\n---` 包装 + 标记行（截断/提权提示可能在 exit 标记之后）。
 *
 * 解析器镜像后端的标记字面量（前端不依赖后端包），按"已知标记逐个剥离"还原纯净 stdout
 * 与结构化状态。新会话优先用工具结果 meta（见 ToolCustomView），本解析器是剥离正文与
 * 历史会话兜底的统一入口。
 *
 * 剥离语义（对齐 DSH）：exit/status 标记剥掉（UI 有 pill，避免重复显示）；
 * timeout/sandbox 提示行无对应 pill，直接丢弃；截断提示剥出 logFilePath 单独成条。
 */

export interface TerminalResultInfo {
  /** 剥离元数据标记后的输出主体（"(no output)" 归一为空串） */
  body: string;
  exitCode?: number | null;
  /** 后端格式化的耗时文本（如 "1s"、"1m 2s"） */
  uptimeText?: string;
  /** poll 状态行中的进程状态（running/completed/error/...） */
  processStatus?: string;
  backgrounded: boolean;
  /** 后台任务 id（新文案 Job ID: job-...）；历史会话无 */
  jobId?: string;
  /** 旧文案的 processId（历史会话回放兼容；新文案不再出现） */
  processId?: string;
  truncated: boolean;
  logFilePath?: string;
  sandboxNote?: string;
  /** 至少识别到一种已知标记；false 时调用方应回退原样展示 */
  recognized: boolean;
}

// 标记字面量（与 shell.plugin.ts 保持同步）
const LEGACY_WRAPPER = /Latest output:\n---\n([\s\S]*?)\n---/;
const SANDBOX_NOTE_LINE =
  /^(Sandbox mode enabled[^\n]*|Read-only mode: sandbox read-only enabled[^\n]*)\n+/;
const TRUNCATED_NOTE =
  /\[Note: Output was truncated\.[^\]]*?at: (.*?)\. (?:You can read it using the read tool if needed|Read it with the read tool)[^\]]*\]\n?/;
// 沙盒提示行：新文案（denied，引导用户切档）+ 旧版"提权"文案（历史会话回放）
const SANDBOX_HINT = /\[sandbox: (?:denied|escalation available)[^\]]*\]\n?/g;
// 新文案带 jobId（Job ID: job-...）；旧文案（历史会话）带 processId。两者取其一。
const BACKGROUND_MARKER =
  /\[(?:Process moved to background|Command exceeded [^\]]*?switched to background)[^\]]*?(?:Job ID:\s*(job-[^\s,\]]+)|processId:\s*([^\s,\]]+))(?:, uptime: ([^\].]+))?\.?\s*[^\]]*\]\n?/;
const STATUS_MARKER =
  /\[status: ([a-z]+)(?:, exit code: (\d+))?(?:, uptime: ([^\]]+?))?(?:, waited: ([^\]]+))?\]/g;
const EXIT_MARKER = /\[exit code: (\d+)(?:, uptime: ([^\]]+?))?\]/g;

/** 删除 text 中指定 match（matchAll 的最后一项），只剥末次出现——正文可能含同名样式文本 */
function removeLastMatch(
  text: string,
  match: RegExpMatchArray,
): string {
  const index = match.index ?? 0;
  return text.slice(0, index) + text.slice(index + match[0].length);
}

/**
 * 从终端类工具结果文本中剥离元数据标记，还原输出主体与结构化状态。
 * 未识别到任何已知标记时返回 null（调用方回退原样展示）。
 */
export function parseTerminalResult(content: string): TerminalResultInfo | null {
  if (!content || typeof content !== "string") return null;

  let text = content;
  const info: TerminalResultInfo = {
    body: "",
    backgrounded: false,
    truncated: false,
    recognized: false,
  };
  let recognized = false;

  // 1. 旧格式的 Latest output 包装 → 还原为裸正文（新格式无此包装，跳过）
  const wrapper = LEGACY_WRAPPER.exec(text);
  if (wrapper) {
    text = text.slice(0, wrapper.index) + wrapper[1] + text.slice(wrapper.index + wrapper[0].length);
    recognized = true;
  }

  // 2. 沙盒说明（首行，两种已知文案）
  const sandboxNote = SANDBOX_NOTE_LINE.exec(text);
  if (sandboxNote) {
    info.sandboxNote = sandboxNote[1];
    text = text.slice(sandboxNote[0].length);
    recognized = true;
  }

  // 3. 截断提示（新旧格式均为独立标记行；剥出完整日志路径，只取末次）
  const truncatedNotes = [...text.matchAll(new RegExp(TRUNCATED_NOTE.source, "g"))];
  if (truncatedNotes.length > 0) {
    info.truncated = true;
    const last = truncatedNotes[truncatedNotes.length - 1];
    info.logFilePath = last[1].trim();
    text = removeLastMatch(text, last);
    recognized = true;
  }

  // 4. 沙盒提示行（无对应 UI 元素，直接丢弃）
  const afterSandboxHint = text.replace(SANDBOX_HINT, "");
  if (afterSandboxHint !== text) {
    text = afterSandboxHint;
    recognized = true;
  }

  // 5. 后台标记（run_command 转后台；新文案带 jobId，旧文案 processId 仅供历史回放）
  const bg = BACKGROUND_MARKER.exec(text);
  if (bg) {
    info.backgrounded = true;
    if (bg[1]) info.jobId = bg[1];
    if (bg[2]) info.processId = bg[2];
    if (bg[3]) info.uptimeText = bg[3];
    text = removeLastMatch(text, bg as RegExpMatchArray);
    recognized = true;
  }

  // 6. poll 状态行（running 无 exit code，只取末次）
  const statuses = [...text.matchAll(STATUS_MARKER)];
  if (statuses.length > 0) {
    const last = statuses[statuses.length - 1];
    info.processStatus = last[1];
    info.backgrounded = last[1] === "running";
    if (last[2] !== undefined) info.exitCode = Number(last[2]);
    if (last[3]) info.uptimeText = last[3];
    text = removeLastMatch(text, last);
    recognized = true;
  }

  // 7. exit 标记（completed；只取末次。不锚定末行以兼容历史会话中
  //    截断/提权提示排在 exit 标记之后的旧布局）
  const exits = [...text.matchAll(EXIT_MARKER)];
  if (exits.length > 0) {
    const last = exits[exits.length - 1];
    info.exitCode = Number(last[1]);
    if (last[2]) info.uptimeText = last[2];
    text = removeLastMatch(text, last);
    recognized = true;
  }

  if (!recognized) return null;

  info.recognized = true;
  info.body = text.trim() === "(no output)" ? "" : text.replace(/\n+$/, "");
  return info;
}

/**
 * 格式化毫秒为人类可读时长（与后端 shell.plugin formatDuration 输出一致）：
 * "5s" / "3m 5s" / "1h 3s"。
 */
export function formatUptime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
