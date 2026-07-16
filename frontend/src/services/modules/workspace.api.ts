import type { ApiContext } from "./api-context";

export interface WorkspaceApi {
  getWorkspaceTree(sessionId: string): Promise<{ tree: any[] }>;
  getWorkspaceChildren(sessionId: string, dirPath: string): Promise<{ children: any[] }>;
  getWorkspaceFile(sessionId: string, filePath: string): Promise<{
    path: string;
    name: string;
    extension: string;
    size: number;
    content: string;
    mimeType: string;
  }>;
  getWorkspaceRawFileUrl(sessionId: string, filePath: string): string;
  getWorkspaceHtmlPreviewUrl(sessionId: string, filePath: string): string;
  deleteWorkspaceFile(sessionId: string, filePath: string): Promise<{ success: boolean; isDirectory?: boolean }>;
  renameWorkspaceFile(sessionId: string, filePath: string, newName: string): Promise<{ success: boolean; isDirectory?: boolean; newPath?: string }>;
  updateWorkspaceExpandedPaths(sessionId: string, expandedPaths: string[]): Promise<void>;
}

export const workspaceApi: WorkspaceApi = {
  async getWorkspaceTree(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/workspace/tree`);
  },

  async getWorkspaceChildren(this: ApiContext, sessionId: string, dirPath: string) {
    return await this._request(
      `/sessions/${sessionId}/workspace/children?path=${encodeURIComponent(dirPath)}`,
    );
  },

  async getWorkspaceFile(this: ApiContext, sessionId: string, filePath: string) {
    return await this._request(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
    );
  },

  getWorkspaceRawFileUrl(this: ApiContext, sessionId: string, filePath: string) {
    const baseUrl = this.baseURL.replace(/\/$/, '');
    const token = sessionStorage.getItem("token") || localStorage.getItem("token") || '';
    return `${baseUrl}/sessions/${sessionId}/workspace/raw-file?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  },

  getWorkspaceHtmlPreviewUrl(this: ApiContext, sessionId: string, filePath: string) {
    const baseUrl = this.baseURL.replace(/\/$/, '');
    const token = sessionStorage.getItem("token") || localStorage.getItem("token") || '';
    return `${baseUrl}/sessions/${sessionId}/workspace/html-preview/${encodeURIComponent(filePath)}?token=${encodeURIComponent(token)}`;
  },

  async deleteWorkspaceFile(this: ApiContext, sessionId: string, filePath: string) {
    return await this._request(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
      { method: "DELETE" },
    );
  },

  async renameWorkspaceFile(this: ApiContext, sessionId: string, filePath: string, newName: string) {
    return await this._request(`/sessions/${sessionId}/workspace/rename`, {
      method: "POST",
      data: { path: filePath, newName },
    });
  },

  async updateWorkspaceExpandedPaths(this: ApiContext, sessionId: string, expandedPaths: string[]) {
    await this._request(`/sessions/${sessionId}/workspace/expanded-paths`, {
      method: "POST",
      data: { expandedPaths },
    });
  },
};
