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
    // 非 file:// 页面（Web / Electron Dev）覆盖为相对路径，走 Vite proxy（同源），
    // 使 Set-Cookie 作用在页面源上，后续 img 请求才能携带 cookie
    const isFileProto = typeof window !== 'undefined' && window.location.protocol === 'file:';
    return await this._request(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
      isFileProto ? undefined : { baseURL: '/api/v1' },
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
    // 按路径段编码，保留 / 作为路径分隔符，使浏览器能正确解析相对资源（CSS/JS 等）
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    return `${baseUrl}/sessions/${sessionId}/workspace/html-preview/${encodedPath}?token=${encodeURIComponent(token)}`;
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
};
