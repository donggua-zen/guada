import { Injectable } from "@nestjs/common";
import { KbFileStore } from "../../modules/knowledge-base/kb-file.store";

/**
 * 知识库仓储（文件实现）
 *
 * 配置权威来源 = `<KB根>/<kbId>/kb.json`（见 KbFileStore）。
 * 保留原 Prisma 版本的方法签名，调用方零改动。
 */
@Injectable()
export class KnowledgeBaseRepository {
  constructor(private store: KbFileStore) {}

  async findById(id: string) {
    return this.store.getKb(id);
  }

  /**
   * 批量查询知识库（使用 in 查询提升效率）
   */
  async findByIds(ids: string[]) {
    if (!ids || ids.length === 0) return [];
    const out: Record<string, any>[] = [];
    for (const id of ids) {
      const row = this.store.getKb(id);
      if (row) out.push(row);
    }
    return out;
  }

  async findAll(skip: number = 0, limit: number = 20) {
    const all = this.store.listKbs();
    return { items: all.slice(skip, skip + limit), total: all.length };
  }

  async create(data: any) {
    return this.store.createKb(data);
  }

  async update(id: string, data: any) {
    return this.store.updateKb(id, data);
  }

  async delete(id: string) {
    return this.store.deleteKb(id);
  }
}
