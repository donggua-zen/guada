import type { ApiContext } from "./api-context";

/**
 * 历史会话导入 API（镜像后端 claude-import.controller.ts）。
 *
 * 来源（source）：
 * - claudeCode：扫描本机 ~/.claude/projects 的 jsonl（缺省，向后兼容）
 * - zcode：只读扫描本机 ~/.zcode/cli/db/db.sqlite
 * - dsh：只读扫描本机 ~/.dsh/sessions 的事件日志（多帧 zstd）
 * - codex：只读扫描本机 ~/.codex/sessions 的 rollout 分页
 * - workbuddy：只读扫描本机 ~/.workbuddy[-ai]/projects 的事件 JSONL
 *
 * import 幂等：同源已导入过返回 skipped already_imported。
 */

/** 导入来源 */
export type ImportSource = "claudeCode" | "zcode" | "dsh" | "codex" | "workbuddy";

export interface ClaudeImportCandidate {
  provider: "claudeCode" | "zcode" | "dsh" | "codex" | "workbuddy";
  sessionId: string;
  sourcePath: string;
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
  /** Unix ms（claude 源缺省回退文件 mtime；zcode 源为 time_updated） */
  updatedAt: number;
  /** 源 jsonl 字节数（仅 claudeCode 源返回） */
  sizeBytes?: number;
  /** 源会话消息行数（仅 zcode 源返回） */
  messageCount?: number;
  /** 本机已有同源导入会话（后端按幂等锚点反查，与重复导入的 skip 同一口径） */
  imported?: boolean;
  /** imported 为真时的本地会话 id，供「打开」直接跳转 */
  importedSessionId?: string;
}

export interface ClaudeImportScanResult {
  candidates: ClaudeImportCandidate[];
  /** 实际扫描的候选根目录（诊断用） */
  roots: string[];
}

export interface ClaudeImportResult {
  imported: Array<{ sessionId: string; importedSessionId: string; title?: string }>;
  skipped: Array<{ sessionId: string; reason: string }>;
  failed: Array<{ sessionId: string; reason: string }>;
}

export interface ClaudeImportApi {
  scanClaudeSessions(opts?: {
    source?: ImportSource;
    modifiedSince?: number;
    limit?: number;
  }): Promise<ClaudeImportScanResult>;
  importClaudeSessions(params: {
    source?: ImportSource;
    sessionIds: string[];
    agentId?: string;
    groupId?: string;
  }): Promise<ClaudeImportResult>;
}

export const claudeImportApi: ClaudeImportApi = {
  async scanClaudeSessions(
    this: ApiContext,
    opts?: { source?: ImportSource; modifiedSince?: number; limit?: number },
  ) {
    return await this._request<ClaudeImportScanResult>("/claude-import/scan", {
      method: "POST",
      data: opts ?? {},
    });
  },

  async importClaudeSessions(
    this: ApiContext,
    params: {
      source?: ImportSource;
      sessionIds: string[];
      agentId?: string;
      groupId?: string;
    },
  ) {
    return await this._request<ClaudeImportResult>("/claude-import/import", {
      method: "POST",
      data: params,
    });
  },
};
