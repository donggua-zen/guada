import { Injectable } from "@nestjs/common";
import {
  SessionFileStore,
  SessionGroupMeta,
} from "../../modules/chat/session-file.store";

/**
 * 会话分组仓储（文件实现）
 *
 * 分组表体积很小（个人场景通常个位数），整表存 `<sessions根>/_groups.json`，
 * 每次变更整文件原子重写——取代原先唯一的 `$transaction` 排序批量更新。
 * 保留原 Prisma 版本的方法签名，调用方零改动。
 */
@Injectable()
export class SessionGroupRepository {
  constructor(private sessionStore: SessionFileStore) {}

  /**
   * 根据用户ID获取所有分组，按 sortOrder 升序排列
   */
  async findAll(): Promise<SessionGroupMeta[]> {
    const groups = await this.sessionStore.readGroups();
    return groups.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * 根据ID获取分组详情
   */
  async findById(id: string): Promise<SessionGroupMeta | undefined> {
    const groups = await this.sessionStore.readGroups();
    return groups.find((g) => g.id === id);
  }

  /**
   * 创建新分组
   */
  async create(data: {
    name: string;
    sortOrder?: number;
  }): Promise<SessionGroupMeta> {
    const groups = await this.sessionStore.readGroups();
    const now = new Date().toISOString();
    const group: SessionGroupMeta = {
      id: this.generateId(),
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    groups.push(group);
    await this.sessionStore.writeGroups(groups);
    return group;
  }

  /**
   * 更新分组信息
   */
  async update(
    id: string,
    data: { name?: string; sortOrder?: number },
  ): Promise<SessionGroupMeta | undefined> {
    const groups = await this.sessionStore.readGroups();
    const target = groups.find((g) => g.id === id);
    if (!target) return undefined;
    if (data.name !== undefined) target.name = data.name;
    if (data.sortOrder !== undefined) target.sortOrder = data.sortOrder;
    target.updatedAt = new Date().toISOString();
    await this.sessionStore.writeGroups(groups);
    return target;
  }

  /**
   * 删除分组
   * 关联会话的 groupId 置为 null（等价原 onDelete: SetNull）
   */
  async deleteById(id: string) {
    const groups = await this.sessionStore.readGroups();
    const next = groups.filter((g) => g.id !== id);
    await this.sessionStore.writeGroups(next);
    // 会话侧解绑（原 DB 外键的 SetNull 语义）
    await this.sessionStore.clearGroup(id);
    return { id };
  }

  /**
   * 获取用户最大的 sortOrder 值
   */
  async getMaxSortOrder(): Promise<number> {
    const groups = await this.sessionStore.readGroups();
    return groups.reduce((max, g) => Math.max(max, g.sortOrder ?? 0), 0);
  }

  /**
   * 批量更新分组排序（整表一次重写，替代原 $transaction）
   */
  async batchUpdateSortOrder(updates: { id: string; sortOrder: number }[]) {
    const groups = await this.sessionStore.readGroups();
    const map = new Map(updates.map((u) => [u.id, u.sortOrder]));
    const now = new Date().toISOString();
    for (const g of groups) {
      const next = map.get(g.id);
      if (next !== undefined) {
        g.sortOrder = next;
        g.updatedAt = now;
      }
    }
    await this.sessionStore.writeGroups(groups);
    return groups.filter((g) => map.has(g.id));
  }

  /** cuid 风格 id（与原 Prisma @default(cuid()) 形态一致，便于混用） */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `c${timestamp}${random}`;
  }
}
