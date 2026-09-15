import { Injectable } from "@nestjs/common";
import { KbMetaStore } from "../../modules/knowledge-base/kb-meta.store";

/**
 * 知识库仓储（每库一个目录的文件实现）
 *
 * 配置权威来源 = `<KB根>/<kbId>/kb.json`（见 KbMetaStore）。
 * 保留原 Prisma 版本的方法签名，调用方零改动。
 * 条目/分块/向量不走这里——它们在 `<kbId>/kb.db`（见 KBFileRepository / KBChunkRepository）。
 */
@Injectable()
export class KnowledgeBaseRepository {
  constructor(private store: KbMetaStore) {}

  async findById(id: string) {
    return this.store.getKb(id);
  }

  /**
   * 批量查询知识库（按 id 精确取，跳过不存在的）
   */
  async findByIds(ids: string[]) {
    if (!ids || ids.length === 0) return [];
    const out: Record<string, any>[] = [];
    for (const id of ids) {
      const row = await this.store.getKb(id);
      if (row) out.push(row);
    }
    return out;
  }

  async findAll(skip: number = 0, limit: number = 20) {
    const all = await this.store.listKbs();
    return { items: all.slice(skip, skip + limit), total: all.length };
  }

  async create(data: any) {
    return this.store.createKb(data);
  }

  async update(id: string, data: any) {
    return this.store.updateKb(id, data);
  }

  /**
   * 删除知识库配置（kb.json）。
   *
   * 注意：整目录删除由 KnowledgeBaseService.remove 负责（含 kb.db 与 raw/）。
   * 这里只用于迁移/测试等明确只需要配置的场景。
   */
  async delete(id: string) {
    // 目录整体删除由上层负责；此处仅让缓存失效并返回是否存在过
    const existed = (await this.store.getKb(id)) != null;
    this.store.forget(id);
    return existed;
  }
}
