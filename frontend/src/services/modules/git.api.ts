import type { ApiContext } from "./api-context";

export interface GitFileChange {
  /** 相对工作目录的路径（正斜杠分隔） */
  path: string;
  /** 暂存区状态：A/M/D/R/U，"" 表示无暂存变更，"?" 表示未跟踪 */
  index: string;
  /** 工作区状态：A/M/D/R/U，"" 表示无变更，"?" 表示未跟踪 */
  workingDir: string;
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
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
};
