import { Injectable } from "@nestjs/common";
import {
  CharacterCreateInput,
  CharacterDefinition,
  CharacterFileStore,
} from "../../modules/characters/character-file.store";

/**
 * 角色仓储（文件实现）
 *
 * 角色定义的权威来源是 `<AGENTS_DATA_DIR>/<id>/AGENT.md`（见 CharacterFileStore）。
 * 本类保留原 Prisma 版本的方法签名，使调用方无需感知存储介质变化。
 */
@Injectable()
export class CharacterRepository {
  constructor(private readonly store: CharacterFileStore) {}

  async findById(id: string): Promise<CharacterDefinition | undefined> {
    return this.store.findById(id);
  }

  /** 批量查找（会话/搜索水合用） */
  async findManyByIds(
    ids: string[],
  ): Promise<Map<string, CharacterDefinition>> {
    return this.store.findManyByIds(ids);
  }

  /** 列表（按文件创建时间升序）+ 内存分页 */
  async findAll(
    skip: number = 0,
    limit: number = 20,
  ): Promise<{ items: CharacterDefinition[]; total: number }> {
    const items = await this.store.listCharacters();
    return {
      items: items.slice(skip, skip + limit),
      total: items.length,
    };
  }

  async create(data: CharacterCreateInput): Promise<CharacterDefinition> {
    return this.store.create(data);
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      modelId?: string | null;
      userId?: string | null;
      settings?: Record<string, any> | null;
    },
  ): Promise<CharacterDefinition | undefined> {
    return this.store.update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}
