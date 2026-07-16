import type { ApiContext } from "./api-context";
import type { PaginatedResponse } from "@/types/common";
import type { KnowledgeBase, KBFile } from "@/stores/knowledgeBase";

export interface KnowledgeBaseApi {
  fetchKnowledgeBases(): Promise<PaginatedResponse<KnowledgeBase>>;
  createKnowledgeBase(data: {
    name: string;
    description?: string;
    embeddingModelId: string;
    chunkMaxSize?: number;
    chunkOverlapSize?: number;
    chunkMinSize?: number;
    isPublic?: boolean;
  }): Promise<KnowledgeBase>;
  updateKnowledgeBase(kbId: string, data: Partial<KnowledgeBase>): Promise<KnowledgeBase>;
  deleteKnowledgeBase(kbId: string): Promise<{ success: boolean }>;
  getKnowledgeBase(kbId: string): Promise<KnowledgeBase>;
  fetchKBFiles(kbId: string, skip?: number, limit?: number): Promise<PaginatedResponse<KBFile>>;
  fetchKBFilesByParent(kbId: string, parentFolderId: string | null, skip?: number, limit?: number): Promise<PaginatedResponse<KBFile>>;
  fetchKBFilesByPath(kbId: string, relativePath: string | null, skip?: number, limit?: number): Promise<PaginatedResponse<KBFile>>;
  uploadKBFile(kbId: string, file: File): Promise<KBFile>;
  getKBFile(kbId: string, fileId: string): Promise<KBFile>;
  deleteKBFile(kbId: string, fileId: string): Promise<{ success: boolean }>;
  renameKBFile(kbId: string, fileId: string, newName: string): Promise<{ success: boolean; message: string; data: any }>;
  moveKBFile(kbId: string, fileId: string, targetParentFolderId: string | null): Promise<{ success: boolean; message: string; data: any }>;
  createKBFolder(kbId: string, folderName: string, parentFolderId?: string | null): Promise<any>;
  getFileProcessingStatus(kbId: string, fileId: string): Promise<KBFile>;
  batchGetFileProcessingStatus(kbId: string, fileIds: string[]): Promise<KBFile[]>;
  retryKBFile(kbId: string, fileId: string): Promise<{ success: boolean; message: string }>;
  getKBFileChunks(kbId: string, fileId: string, skip?: number, limit?: number): Promise<any[]>;
  searchKnowledgeBase(kbId: string, query: string, topK?: number, filterFileId?: string): Promise<any>;
}

export const knowledgeBaseApi: KnowledgeBaseApi = {
  async fetchKnowledgeBases(this: ApiContext) {
    return await this._request("/knowledge-bases");
  },

  async createKnowledgeBase(this: ApiContext, data: {
    name: string;
    description?: string;
    embeddingModelId: string;
    chunkMaxSize?: number;
    chunkOverlapSize?: number;
    chunkMinSize?: number;
    isPublic?: boolean;
  }) {
    return await this._request("/knowledge-bases", {
      method: "POST",
      data: data,
    });
  },

  async updateKnowledgeBase(this: ApiContext, kbId: string, data: Partial<KnowledgeBase>) {
    return await this._request(`/knowledge-bases/${kbId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteKnowledgeBase(this: ApiContext, kbId: string) {
    return await this._request(`/knowledge-bases/${kbId}`, {
      method: "DELETE",
    });
  },

  async getKnowledgeBase(this: ApiContext, kbId: string) {
    return await this._request(`/knowledge-bases/${kbId}`);
  },

  async fetchKBFiles(this: ApiContext, kbId: string, skip?: number, limit?: number) {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/knowledge-bases/${kbId}/files?${queryString}`
      : `/knowledge-bases/${kbId}/files`;

    return await this._request(url);
  },

  async fetchKBFilesByParent(this: ApiContext, kbId: string, parentFolderId: string | null, skip?: number, limit?: number) {
    const params = new URLSearchParams();
    if (parentFolderId !== null && parentFolderId !== undefined) {
      params.append("parentFolderId", parentFolderId);
    }
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/knowledge-bases/${kbId}/files/by-parent?${queryString}`
      : `/knowledge-bases/${kbId}/files/by-parent`;

    return await this._request(url);
  },

  async fetchKBFilesByPath(this: ApiContext, kbId: string, relativePath: string | null, skip?: number, limit?: number) {
    const params = new URLSearchParams();
    if (relativePath !== null && relativePath !== undefined && relativePath !== "") {
      params.append("path", relativePath);
    }
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/knowledge-bases/${kbId}/files/by-path?${queryString}`
      : `/knowledge-bases/${kbId}/files/by-path`;

    return await this._request(url);
  },

  async uploadKBFile(this: ApiContext, kbId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      return await this._request(`/knowledge-bases/${kbId}/files/upload`, {
        method: "POST",
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("上传文件失败:", error);
      throw error;
    }
  },

  async getKBFile(this: ApiContext, kbId: string, fileId: string) {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}`);
  },

  async deleteKBFile(this: ApiContext, kbId: string, fileId: string) {
    return await this._request(`/knowledge-bases/${kbId}/files/${fileId}`, {
      method: "DELETE",
    });
  },

  async renameKBFile(this: ApiContext, kbId: string, fileId: string, newName: string) {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/rename`,
      {
        method: "POST",
        data: { newName },
      },
    );
  },

  async moveKBFile(this: ApiContext, kbId: string, fileId: string, targetParentFolderId: string | null) {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/move`,
      {
        method: "POST",
        data: { targetParentFolderId },
      },
    );
  },

  async createKBFolder(this: ApiContext, kbId: string, folderName: string, parentFolderId: string | null = null) {
    return await this._request(`/knowledge-bases/${kbId}/files/folder`, {
      method: "POST",
      data: { folderName, parentFolderId },
    });
  },

  async getFileProcessingStatus(this: ApiContext, kbId: string, fileId: string) {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/status`,
    );
  },

  async batchGetFileProcessingStatus(this: ApiContext, kbId: string, fileIds: string[]) {
    return await this._request(`/knowledge-bases/${kbId}/files/status/batch`, {
      method: "POST",
      data: { fileIds: fileIds },
    });
  },

  async retryKBFile(this: ApiContext, kbId: string, fileId: string) {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/retry`,
      {
        method: "POST",
      },
    );
  },

  async getKBFileChunks(this: ApiContext, kbId: string, fileId: string, skip: number = 0, limit: number = 10) {
    return await this._request(
      `/knowledge-bases/${kbId}/files/${fileId}/chunks?skip=${skip}&limit=${limit}`,
    );
  },

  async searchKnowledgeBase(this: ApiContext, kbId: string, query: string, topK: number = 5, filterFileId?: string) {
    return await this._request(`/knowledge-bases/${kbId}/search`, {
      method: "POST",
      data: {
        query,
        topK: topK,
        filterFileId: filterFileId,
      },
    });
  },
};
