import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { SessionGroupRepository } from "../../common/database/session-group.repository";

@Injectable()
export class SessionGroupService {
  private readonly logger = new Logger(SessionGroupService.name);

  constructor(
    private sessionGroupRepo: SessionGroupRepository,
  ) { }

  /**
   * 获取用户的所有会话分组
   */
  async getGroupsByUser(userId: string) {
    return this.sessionGroupRepo.findByUserId(userId);
  }

  /**
   * 创建新分组
   * 自动将sortOrder设为当前最大值+1，确保新分组排在最后
   */
  async createGroup(userId: string, data: { name: string }) {
    const maxOrder = await this.sessionGroupRepo.getMaxSortOrder(userId);
    return this.sessionGroupRepo.create({
      name: data.name,
      userId,
      sortOrder: maxOrder + 1,
    });
  }

  /**
   * 更新分组名称
   */
  async updateGroup(groupId: string, userId: string, data: { name?: string }) {
    const group = await this.sessionGroupRepo.findById(groupId);
    if (!group || group.userId !== userId) {
      throw new HttpException("分组不存在", HttpStatus.NOT_FOUND);
    }
    return this.sessionGroupRepo.update(groupId, { name: data.name });
  }

  /**
   * 删除分组
   * 删除后，该分组下的会话会自动变为未分组（groupId设为null）
   */
  async deleteGroup(groupId: string, userId: string) {
    const group = await this.sessionGroupRepo.findById(groupId);
    if (!group || group.userId !== userId) {
      throw new HttpException("分组不存在", HttpStatus.NOT_FOUND);
    }
    return this.sessionGroupRepo.deleteById(groupId);
  }

  /**
   * 批量更新分组排序
   * @param groupIds 按新顺序排列的分组ID数组
   */
  async reorderGroups(userId: string, groupIds: string[]) {
    // 验证所有分组都属于当前用户
    const userGroups = await this.sessionGroupRepo.findByUserId(userId);
    const userGroupIds = new Set(userGroups.map((g) => g.id));

    for (const id of groupIds) {
      if (!userGroupIds.has(id)) {
        throw new HttpException(
          `分组 ${id} 不存在或不属于当前用户`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const updates = groupIds.map((id, index) => ({
      id,
      sortOrder: index,
    }));

    return this.sessionGroupRepo.batchUpdateSortOrder(updates);
  }
}
