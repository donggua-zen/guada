import { parse as partialParse } from "partial-json";
import { getToolArgs, type ToolCall } from "./toolDisplay";

/**
 * 工具调用的远程工作区标识。
 *
 * 只依赖 `workspace` 参数约定（后端 workspace-router 的统一入参）：
 * - 缺省 / "" / "main" / "local" → 主（本地）工作目录；
 * - 其他字符串 → 远程连接名。
 *
 * 不在前端维护工具名白名单：任何遵守该约定的工具都会自动获得标识，
 * 参数随 JSONL 持久化，因此流式、刷新与历史回放都能直接读取。
 *
 * 与 backend-ts/src/modules/remote-workspace/workspace-router.ts 的
 * MAIN_WORKSPACE_VALUES 保持一致。
 */
export const MAIN_WORKSPACE_VALUES = new Set(["", "main", "local"]);

/** 读取工具参数中的字符串字段（兼容流式半截 JSON 与 tool_use 嵌套参数） */
function readStringArg(tool: ToolCall, key: string): string | undefined {
  const params = getToolArgs(tool);
  if (!params) return undefined;

  let parsed = params;
  if (typeof params === "string") {
    try {
      parsed = partialParse(params);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;

  const value = (parsed as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** 远程连接名；本地调用或未声明 workspace 时返回 undefined */
export function getRemoteWorkspaceName(tool: ToolCall): string | undefined {
  const workspace = readStringArg(tool, "workspace");
  if (!workspace || MAIN_WORKSPACE_VALUES.has(workspace)) return undefined;
  return workspace;
}

/**
 * 单行参数摘要加「远程·」前缀（remoteLabel 由调用方按当前语言传入）。
 * 无远程时原样返回；参数摘要为空时只显示远程标识。
 */
export function formatArgsTextWithRemote(
  argsText: string | undefined,
  remoteWorkspace: string | undefined,
  remoteLabel: string,
): string | undefined {
  if (!remoteWorkspace) return argsText;
  return argsText ? `${remoteLabel}·${argsText}` : remoteLabel;
}
