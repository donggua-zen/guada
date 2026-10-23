import type { ApiContext } from "./api-context";
import { getClientId } from "@/utils/clientId";

export interface GitFileChange {
  /** 相对工作目录的路径（正斜杠分隔） */
  path: string;
  /** 暂存区状态：A/M/D/R/U，"" 表示无暂存变更，"?" 表示未跟踪 */
  index: string;
  /** 工作区状态：A/M/D/R/U，"" 表示无变更，"?" 表示未跟踪 */
  workingDir: string;
  /** 新增行数（顶部聚合统计用） */
  additions: number;
  /** 删除行数 */
  deletions: number;
}

export interface GitStatus {
  isGitRepo: boolean;
  /** 系统未安装 git：true 时 git 功能整体不可用（非仓库的另一种降级） */
  gitUnavailable?: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  /** 仅暂存区的增删行数（提交弹窗未勾选「包含未暂存」时的提交量） */
  stagedAdditions: number;
  stagedDeletions: number;
  /** 变更条目总数（files 被上限截断时仍为真实数量） */
  totalFiles?: number;
  /** true 表示 files 不是完整列表（超大仓库降级） */
  truncated?: boolean;
  /** 未跟踪目录过大、未逐文件展开的目录（path 带尾斜杠） */
  collapsedUntrackedDirs?: string[];
  /** 降级原因：timeout / too_many_changes */
  statusError?: string;
  /** 聚合增删行数：顶部统计直接使用，避免遍历全部 files */
  totalAdditions?: number;
  totalDeletions?: number;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitDiff {
  type: "diff" | "new-file";
  path: string;
  diff?: string;
  content?: string;
  /** 完整旧侧内容（staged=HEAD 版本；unstaged=暂存区版本）。超体积上限时省略 → 前端降级高亮 */
  oldContent?: string;
  /** 完整新侧内容（staged=暂存区版本；unstaged=工作区版本；已删除为 ""） */
  newContent?: string;
  /** 该文件为二进制（图片/压缩包/媒体等），不支持文本预览 */
  binary?: boolean;
  /** 文件体积超限（总体积 > 2MB 或含超长行 > 4KB），拒绝预览 */
  tooLarge?: boolean;
}

export interface GitCommitResult {
  success: boolean;
  commit: string;
  summary: {
    changes: number;
    insertions: number;
    deletions: number;
  };
  branch: string;
}

export interface GitCommitMessageStreamEvent {
  /** 事件类型：text=增量 / done=完成 / skipped=跳过或失败 */
  type: "text" | "done" | "skipped";
  /** type=text 时的文本增量 */
  content?: string;
  /** type=done 时的完整提交信息 */
  message?: string;
  modelId?: string;
  modelName?: string;
  /** 模型来源：title=标题总结模型；chat=当前对话模型 */
  modelSource?: "title" | "chat";
  /** type=skipped 时的跳过原因 */
  reason?: string;
}

export interface GitFileLinesResult {
  content: string;
  count: number;
}

export interface GitApi {
  getGitStatus(sessionId: string): Promise<GitStatus>;
  getGitBranches(sessionId: string): Promise<{ branches: GitBranch[] }>;
  gitCheckout(sessionId: string, branch: string): Promise<{ success: boolean; branch: string }>;
  gitCommit(
    sessionId: string,
    message: string,
    files?: string[],
  ): Promise<GitCommitResult>;
  gitStage(sessionId: string, files?: string[]): Promise<{ success: boolean }>;
  gitUnstage(sessionId: string, files?: string[]): Promise<{ success: boolean }>;
  gitPush(sessionId: string): Promise<{ success: boolean }>;
  getGitDiff(
    sessionId: string,
    file: string,
    cached?: boolean,
  ): Promise<GitDiff>;
  getGitFileLines(
    sessionId: string,
    file: string,
    cached: boolean,
    fromLine: number,
    toLine: number,
  ): Promise<GitFileLinesResult>;
  /** 根据 git 变更流式生成提交信息（SSE）；includeUnstaged 是否包含未暂存变更，默认 true */
  generateCommitMessage(
    sessionId: string,
    includeUnstaged: boolean,
    onText: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<{ message: string; modelId?: string; modelName?: string; modelSource?: "title" | "chat" }>;
  /** 读取项目提交约束（.guada/git/commit_constraint.md），不存在时返回空串 */
  getCommitConstraint(sessionId: string): Promise<{ content: string }>;
  /** 保存项目提交约束 */
  saveCommitConstraint(
    sessionId: string,
    content: string,
  ): Promise<{ success: boolean }>;
}

export const gitApi: GitApi = {
  async getGitStatus(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/git/status`);
  },

  async getGitBranches(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/git/branches`);
  },

  async gitCheckout(this: ApiContext, sessionId: string, branch: string) {
    return await this._request(`/sessions/${sessionId}/git/checkout`, {
      method: "POST",
      data: { branch },
    });
  },

  async gitCommit(
    this: ApiContext,
    sessionId: string,
    message: string,
    files?: string[],
  ) {
    return await this._request(`/sessions/${sessionId}/git/commit`, {
      method: "POST",
      data: { message, files },
    });
  },

  async gitStage(this: ApiContext, sessionId: string, files?: string[]) {
    return await this._request(`/sessions/${sessionId}/git/stage`, {
      method: "POST",
      data: { files },
    });
  },

  async gitUnstage(this: ApiContext, sessionId: string, files?: string[]) {
    return await this._request(`/sessions/${sessionId}/git/unstage`, {
      method: "POST",
      data: { files },
    });
  },

  async gitPush(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/git/push`, {
      method: "POST",
    });
  },

  async getGitDiff(
    this: ApiContext,
    sessionId: string,
    file: string,
    cached?: boolean,
  ) {
    return await this._request(
      `/sessions/${sessionId}/git/diff?file=${encodeURIComponent(file)}${cached ? "&cached=true" : ""}`,
    );
  },

  async getGitFileLines(
    this: ApiContext,
    sessionId: string,
    file: string,
    cached: boolean,
    fromLine: number,
    toLine: number,
  ) {
    return await this._request(
      `/sessions/${sessionId}/git/file-lines?file=${encodeURIComponent(file)}&cached=${cached}&from=${fromLine}&to=${toLine}`,
    );
  },

  /**
   * SSE 流式生成提交信息：
   * - 逐块回调 onText 累积文本
   * - 正常结束 resolve { message, modelId, modelName, modelSource }
   * - skipped 事件/网络错误 → reject Error（message 为 reason 键，如 "no_model_configured"）
   * - 取消：外部 abort signal
   */
  async generateCommitMessage(
    this: ApiContext,
    sessionId: string,
    includeUnstaged: boolean,
    onText: (text: string) => void,
    signal?: AbortSignal,
  ) {
    const accessToken =
      sessionStorage.getItem("token") || localStorage.getItem("token");
    const response = await fetch(
      `${this.baseURL}/sessions/${sessionId}/git/generate-commit-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({ includeUnstaged }),
        signal,
      },
    );

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = data?.message || data?.error || message;
      } catch {
        /* 忽略 JSON 解析失败 */
      }
      throw new Error(message);
    }
    if (!response.body) {
      throw new Error("no_response_body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let resultMessage = "";
    let modelId: string | undefined;
    let modelName: string | undefined;
    let modelSource: "title" | "chat" | undefined;
    let skippedReason: string | null = null;
    let streamEnded = false;

    try {
      while (!streamEnded) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n")) !== -1) {
          const line = buffer.substring(0, boundary).trim();
          buffer = buffer.substring(boundary + 1);

          if (line === "data: [DONE]") {
            streamEnded = true;
            break;
          }
          if (!line.startsWith("data: ")) continue;

          let event: GitCommitMessageStreamEvent;
          try {
            event = JSON.parse(line.substring(6));
          } catch (e) {
            console.error("提交信息流 JSON 解析失败:", e, line);
            continue;
          }

          if (event.type === "text" && event.content) {
            onText(event.content);
          } else if (event.type === "done") {
            resultMessage = event.message || "";
            modelId = event.modelId;
            modelName = event.modelName;
            modelSource = event.modelSource;
          } else if (event.type === "skipped") {
            skippedReason = event.reason || "skipped";
            streamEnded = true;
            break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (skippedReason) throw new Error(skippedReason);
    if (!resultMessage) throw new Error("empty_result");
    return { message: resultMessage, modelId, modelName, modelSource };
  },

  async getCommitConstraint(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/git/commit-constraint`);
  },

  async saveCommitConstraint(
    this: ApiContext,
    sessionId: string,
    content: string,
  ) {
    return await this._request(`/sessions/${sessionId}/git/commit-constraint`, {
      method: "PUT",
      data: { content },
    });
  },
};
