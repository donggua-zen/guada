import { parse as partialParse } from "partial-json";
import {
  getArgsDisplay,
  getToolArgs,
  resolveToolName,
  type ToolCall,
} from "./toolDisplay";

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

/** 文件类工具行可打开到侧边栏预览的目标 */
export interface ToolFileOpenTarget {
  /** 归一化后的路径（反斜杠统一为 /，去掉开头 ./） */
  path: string;
  /** basename，供调用方展示/调试 */
  fileName: string;
}

/**
 * 解析文件类工具的可预览目标。
 *
 * 返回 null 的情况：
 * - 非文件类工具（没有 `argsKey = file_path` 的展示配置）；
 * - 远程工作区（`workspace` 参数为连接名，或历史 `remote_*` 工具）；
 * - 工具仍在执行（流式 `file_path` 可能是半截路径，等结束再允许打开）；
 * - `file_path` 为空。
 *
 * 路径只做分隔符与 `./` 前缀归一化；绝对路径原样保留，由后端按工作目录解析。
 */
export function getToolFileOpenTarget(
  tool: ToolCall | undefined,
  options?: { executing?: boolean; remoteName?: string },
): ToolFileOpenTarget | null {
  if (!tool || options?.executing) return null;

  const remoteName = options?.remoteName ?? getRemoteWorkspaceName(tool);
  if (remoteName) return null;
  // 历史 remote_* 工具没有 workspace 参数，但 file_path 相对远端 basePath，
  // 不能当成本地工作区路径打开（可能误开同名本地文件）。
  if (resolveToolName(tool).startsWith("remote_")) return null;

  const file = getArgsDisplay(tool)?.file;
  if (!file?.fullPath) return null;

  const path = file.fullPath.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (!path) return null;
  return { path, fileName: file.fileName };
}
