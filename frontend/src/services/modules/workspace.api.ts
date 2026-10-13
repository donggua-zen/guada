import type { ApiContext } from "./api-context";
import type { WorkspaceNode } from "@/types/workspace";

export interface WorkspaceFileResponse {
  path: string;
  name: string;
  extension: string;
  size: number;
  content: string;
  mimeType: string;
  /** 是否为二进制（仅 sniff 请求会真正判定；普通请求恒为 false） */
  isBinary: boolean;
  /** 嗅探出的文本编码（iconv-lite 名称），未嗅探时为 'utf-8' */
  encoding?: string;
  /** 嗅探出的真实后缀（带点，如 '.png'）；未命中为 '' */
  detectedExtension?: string;
}

export interface WorkspaceApi {
  getWorkspaceTree(sessionId: string): Promise<{ tree: WorkspaceNode[] }>;
  getWorkspaceChildren(sessionId: string, dirPath: string): Promise<{ children: WorkspaceNode[] }>;
  getWorkspaceFile(
    sessionId: string,
    filePath: string,
    options?: { sniff?: boolean },
  ): Promise<WorkspaceFileResponse>;
  getWorkspaceRawFileUrl(sessionId: string, filePath: string): string;
  getWorkspaceHtmlPreviewUrl(sessionId: string, filePath: string): string;
  deleteWorkspaceFile(sessionId: string, filePath: string): Promise<{ success: boolean; isDirectory?: boolean }>;
  saveWorkspaceFile(sessionId: string, filePath: string, content: string): Promise<{ success: boolean; path: string }>;
  disposeTerminal(terminalId: string): Promise<{ success: boolean; terminalId: string }>;
  renameWorkspaceFile(sessionId: string, filePath: string, newName: string): Promise<{ success: boolean; isDirectory?: boolean; newPath?: string }>;
}

export const workspaceApi: WorkspaceApi = {
  async getWorkspaceTree(this: ApiContext, sessionId: string) {
    return await this._request<{ tree: WorkspaceNode[] }>(`/sessions/${sessionId}/workspace/tree`);
  },

  async getWorkspaceChildren(this: ApiContext, sessionId: string, dirPath: string) {
    return await this._request<{ children: WorkspaceNode[] }>(
      `/sessions/${sessionId}/workspace/children?path=${encodeURIComponent(dirPath)}`,
    );
  },

  async getWorkspaceFile(
    this: ApiContext,
    sessionId: string,
    filePath: string,
    options?: { sniff?: boolean },
  ) {
    // 非 file:// 页面（Web / Electron Dev）覆盖为相对路径，走 Vite proxy（同源），
    // 使 Set-Cookie 作用在页面源上，后续 img 请求才能携带 cookie
    const isFileProto = typeof window !== 'undefined' && window.location.protocol === 'file:';
    // sniff=1：后缀不可信时让后端读文件头判定文本/二进制与真实格式（见 file-sniff.util）
    const sniffQuery = options?.sniff ? '&sniff=1' : '';
    return await this._request<WorkspaceFileResponse>(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}${sniffQuery}`,
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
    return await this._request<{ success: boolean; isDirectory?: boolean }>(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
      { method: "DELETE" },
    );
  },

  async renameWorkspaceFile(this: ApiContext, sessionId: string, filePath: string, newName: string) {
    return await this._request<{ success: boolean; isDirectory?: boolean; newPath?: string }>(
      `/sessions/${sessionId}/workspace/rename`,
      {
        method: "POST",
        data: { path: filePath, newName },
      },
    );
  },
  async saveWorkspaceFile(this: ApiContext, sessionId: string, filePath: string, content: string) {
    return await this._request<{ success: boolean; path: string }>(
      `/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        data: { content },
      },
    );
  },

  async disposeTerminal(this: ApiContext, terminalId: string) {
    return await this._request<{ success: boolean; terminalId: string }>(`/terminal/${encodeURIComponent(terminalId)}`, {
      method: "DELETE",
    });
  },
};
