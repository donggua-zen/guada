/**
 * MCP stdio spawn 失败的可读化分类。
 *
 * 背景：StdioClientTransport spawn 失败时错误经 SDK onerror → client.connect reject，
 * 在 McpConnectionManager.openConnection 包装为 "MCP connection failed: spawn node ENOENT"
 * 并把原始错误挂在 (error as any).originalError 上。原始错误来自 cross-spawn 的 enoent hook：
 * { code: "ENOENT", errno: "ENOENT"（字符串而非数字）, path: 原始命令 }。
 *
 * 只认 code === "ENOENT"：其它错误（超时、握手失败、服务器主动退出）不在此分类，
 * 维持原有 message 透传。分类结果用于两处：包装消息追加可读提示（对所有调用方生效），
 * 以及 test-connection / refresh-tools 透出结构化 reason 供前端弹「安装 Node.js」指引。
 *
 * npx/npm/pnpx/bunx 单独成类：项目不随包分发 npm，Electron 内置 Node 只能兜住 `node`，
 * npx 系命令只能引导用户自行安装 Node.js（含 npm）。
 */

export type McpSpawnErrorReason = "node_missing" | "npx_missing" | "command_missing";

export interface McpSpawnErrorInfo {
  reason: McpSpawnErrorReason;
  /** 触发 ENOENT 的原始命令 base 名（如 "node" / "npx"） */
  command: string;
}

/** 无兜底物、需要引导用户安装 Node.js 的 npx 系命令 */
const NPX_FAMILY = new Set(["npx", "npm", "pnpx", "bunx"]);

/** 解开 openConnection 的包装，拿到 cross-spawn 的原始错误；没有包装则原样返回 */
function unwrapOriginalError(error: unknown): unknown {
  if (error && typeof error === "object" && "originalError" in error) {
    const original = (error as { originalError?: unknown }).originalError;
    if (original) return original;
  }
  return error;
}

function commandBaseOf(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) return "";
  const normalized = path.trim().replace(/\\/g, "/");
  return (normalized.split("/").pop() ?? "").toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}

/**
 * 识别「命令不存在」类 spawn 失败。非 ENOENT 或拿不到命令名时返回 null。
 */
export function classifyMcpSpawnError(error: unknown): McpSpawnErrorInfo | null {
  const original = unwrapOriginalError(error) as { code?: unknown; path?: unknown };
  if (!original || typeof original !== "object") return null;
  if (original.code !== "ENOENT") return null;

  const command = commandBaseOf(original.path);
  if (!command) return null;

  if (command === "node") {
    return { reason: "node_missing", command };
  }
  if (NPX_FAMILY.has(command)) {
    return { reason: "npx_missing", command };
  }
  return { reason: "command_missing", command };
}

/**
 * 供包装消息 / BadRequestException 使用的英文可读提示。
 * 面向用户直接阅读，带安装指引；node_missing 说明内置 Node 已兜底、无需安装。
 */
export function describeMcpSpawnError(info: McpSpawnErrorInfo): string {
  switch (info.reason) {
    case "node_missing":
      return `the command "${info.command}" was not found on this machine. ` +
        `Install Node.js from https://nodejs.org so MCP servers can run`;
    case "npx_missing":
      return `the command "${info.command}" was not found on this machine. ` +
        `npx-based MCP servers require a full Node.js installation (with npm) — ` +
        `install it from https://nodejs.org`;
    case "command_missing":
      return `the command "${info.command}" was not found on this machine. ` +
        `Check the server command or install the runtime it depends on`;
  }
}
