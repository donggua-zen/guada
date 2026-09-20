import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { SessionMetaStore } from "./session-meta.store";

/**
 * 会话分组服务（单账户）
 *
 * 分组无归属维度：全局一份，不再按用户过滤。
 * 权威来源 = `sessions/_meta.db` 的 session_groups 表（见 SessionMetaStore）。
 */
@Injectable()
export class SessionGroupService {
  private readonly logger = new Logger(SessionGroupService.name);

  constructor(private sessionStore: SessionMetaStore) {}

  /** 获取所有会话分组（按 sortOrder 升序） */
  async getGroups() {
    return this.sessionStore.listGroups();
  }

  /**
   * 创建新分组
   * 自动将 sortOrder 设为当前最大值+1，确保新分组排在最后
   */
  async createGroup(data: { name: string }) {
    const maxOrder = await this.sessionStore.getMaxGroupSortOrder();
    return this.sessionStore.createGroup({
      name: data.name,
      sortOrder: maxOrder + 1,
    });
  }

  /** 更新分组名称 */
  async updateGroup(groupId: string, data: { name?: string }) {
    const group = await this.sessionStore.findGroupById(groupId);
    if (!group) {
      throw new HttpException("分组不存在", HttpStatus.NOT_FOUND);
    }
    const updateData: { name?: string } = {};
    if (data.name !== undefined) updateData.name = data.name;
    return this.sessionStore.updateGroup(groupId, updateData);
  }

  /**
   * 删除分组
   * 删除后，该分组下的会话自动变为未分组（groupId 置 null）
   */
  async deleteGroup(groupId: string) {
    const group = await this.sessionStore.findGroupById(groupId);
    if (!group) {
      throw new HttpException("分组不存在", HttpStatus.NOT_FOUND);
    }
    return this.sessionStore.deleteGroup(groupId);
  }

  /**
   * 批量更新分组排序
   * @param groupIds 按新顺序排列的分组ID数组
   */
  async reorderGroups(groupIds: string[]) {
    const groups = await this.sessionStore.listGroups();
    const knownIds = new Set(groups.map((g) => g.id));

    for (const id of groupIds) {
      if (!knownIds.has(id)) {
        throw new HttpException(`分组 ${id} 不存在`, HttpStatus.FORBIDDEN);
      }
    }

    return this.sessionStore.batchUpdateGroupSortOrder(
      groupIds.map((id, index) => ({ id, sortOrder: index })),
    );
  }
}
