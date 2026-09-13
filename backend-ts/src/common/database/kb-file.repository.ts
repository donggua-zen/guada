import { Injectable } from "@nestjs/common";
import { KbFileStore, KbFileMeta } from "../../modules/knowledge-base/kb-file.store";

/**
 * KB 文件/文件夹仓储（文件实现）
 *
 * 元信息权威来源 = `<KB根>/<kbId>/<itemId>/file.json`（见 KbFileStore）。
 * 保留原 Prisma 版本的方法签名与排序语义，调用方零改动：
 * - `findByParentFolderId` / `findChildren` / `findRootItems`：文件夹优先 + 名称升序
 * - `findByKnowledgeBaseId`：uploadedAt 降序
 */
@Injectable()
export class KBFileRepository {
  constructor(private store: KbFileStore) {}

  private toRow(meta: KbFileMeta): Record<string, any> {
    return this.store.getFile(meta.id)!;
  }

  private toRows(metas: KbFileMeta[]): Record<string, any>[] {
    return metas.map((m) => this.toRow(m));
  }

  /** 目录优先 + 名称升序（对齐原 orderBy [isDirectory desc, displayName asc]） */
  private sortTree(items: KbFileMeta[]): KbFileMeta[] {
    return [...items].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const byName = (a.displayName ?? "").localeCompare(b.displayName ?? "");
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
  }

  async findById(id: string) {
    return this.store.getFile(id);
  }

  async findByKnowledgeBaseId(
    kbId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const rows = this.store
      .queryFiles((m) => m.knowledgeBaseId === kbId)
      .sort((a, b) =>
        a.uploadedAt === b.uploadedAt
          ? a.id.localeCompare(b.id)
          : b.uploadedAt.localeCompare(a.uploadedAt),
      );
    return {
      items: this.toRows(rows.slice(skip, skip + limit)),
      total: rows.length,
    };
  }

  /**
   * 按父文件夹ID查询文件列表(支持懒加载)
   */
  async findByParentFolderId(
    kbId: string,
    parentFolderId: string | null,
    skip: number = 0,
    limit: number = 50,
  ) {
    const rows = this.sortTree(
      this.store.queryFiles(
        (m) => m.knowledgeBaseId === kbId && m.parentFolderId === parentFolderId,
      ),
    );
    return {
      items: this.toRows(rows.slice(skip, skip + limit)),
      total: rows.length,
    };
  }

  async create(data: any) {
    return this.store.createFile(data);
  }

  async update(id: string, data: any) {
    return this.store.updateFile(id, data);
  }

  async updateProcessingStatus(
    id: string,
    status: string,
    progress?: number,
    currentStep?: string,
    errorMessage?: string | null,
    totalChunks?: number,
    totalTokens?: number,
  ) {
    const updateData: any = { processingStatus: status };

    if (progress !== undefined) updateData.progressPercentage = progress;
    if (currentStep !== undefined) updateData.currentStep = currentStep;
    if (errorMessage !== undefined) updateData.errorMessage = errorMessage;
    if (totalChunks !== undefined) updateData.totalChunks = totalChunks;
    if (totalTokens !== undefined) updateData.totalTokens = totalTokens;

    if (status === "completed") {
      updateData.processedAt = new Date().toISOString();
    }

    return this.store.updateFile(id, updateData);
  }

  async delete(id: string) {
    return this.store.deleteFile(id);
  }

  /**
   * 前缀级联重写子项 relativePath（文件夹改名/移动用）。
   * 只改路径、不动 parentFolderId —— 子项与父文件夹的指向关系不变。
   */
  async rewriteRelativePathPrefix(
    kbId: string,
    prefix: string,
    nextPrefix: string,
  ) {
    return this.store.rewriteRelativePathPrefix(kbId, prefix, nextPrefix);
  }

  async findByIds(ids: string[]) {
    const out: Record<string, any>[] = [];
    for (const id of ids) {
      const row = this.store.getFile(id);
      if (row) out.push(row);
    }
    return out;
  }

  async countByKnowledgeBaseId(kbId: string) {
    return this.store.queryFiles((m) => m.knowledgeBaseId === kbId).length;
  }

  async findByStatus(statuses: string[]) {
    return this.toRows(
      this.store.queryFiles((m) => statuses.includes(m.processingStatus)),
    );
  }

  /**
   * 列出条目元信息。
   * @param kbId 限定知识库；省略则跨全部知识库（孤儿扫描用）
   * @param isDirectory true=只查文件夹, false=只查文件, undefined=都查（默认）
   */
  listFileMetas(kbId?: string, isDirectory?: boolean) {
    return this.store.queryFiles(
      (m) =>
        (kbId === undefined || m.knowledgeBaseId === kbId) &&
        (isDirectory === undefined || m.isDirectory === isDirectory),
    );
  }

  /**
   * 根据路径和父ID查找文件或文件夹
   * @param isDirectory true=只查文件夹, false=只查文件, undefined=都查（默认）
   */
  async findByPathAndParent(
    kbId: string,
    name: string,
    parentFolderId: string | null,
    isDirectory?: boolean,
  ) {
    const meta = this.store.queryFiles(
      (m) =>
        m.knowledgeBaseId === kbId &&
        m.displayName === name &&
        m.parentFolderId === parentFolderId &&
        (isDirectory === undefined ? true : m.isDirectory === isDirectory),
    )[0];
    return meta ? this.toRow(meta) : null;
  }

  /**
   * 查找指定父文件夹下的所有子项
   */
  async findChildren(
    parentFolderId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const rows = this.sortTree(
      this.store.queryFiles((m) => m.parentFolderId === parentFolderId),
    );
    return {
      items: this.toRows(rows.slice(skip, skip + limit)),
      total: rows.length,
    };
  }

  /**
   * 获取根级别文件/文件夹(parentFolderId 为 NULL)
   */
  async findRootItems(
    kbId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    const rows = this.sortTree(
      this.store.queryFiles(
        (m) => m.knowledgeBaseId === kbId && m.parentFolderId === null,
      ),
    );
    return {
      items: this.toRows(rows.slice(skip, skip + limit)),
      total: rows.length,
    };
  }

  /**
   * 通过相对路径查找文件或文件夹
   */
  async findByRelativePath(
    kbId: string,
    relativePath: string,
    isDirectory: boolean = false,
  ) {
    const meta = this.store.queryFiles(
      (m) =>
        m.knowledgeBaseId === kbId &&
        m.relativePath === relativePath &&
        (isDirectory ? m.isDirectory : true),
    )[0];
    return meta ? this.toRow(meta) : null;
  }

  /**
   * 根据内容哈希查找文件（用于重复检测）
   */
  async findByContentHash(
    knowledgeBaseId: string,
    contentHash: string,
  ): Promise<any | null> {
    const meta = this.store.queryFiles(
      (m) =>
        m.knowledgeBaseId === knowledgeBaseId && m.contentHash === contentHash,
    )[0];
    return meta ? this.toRow(meta) : null;
  }
}
