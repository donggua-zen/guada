import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { SessionMetaStore } from "./session-meta.store";
import { SessionStreamManager } from "./session-stream.manager";

/**
 * 会话分组服务（单账户）
 *
 * 分组无归属维度：全局一份，不再按用户过滤。
 * 权威来源 = `sessions/_meta.db` 的 session_groups 表（见 SessionMetaStore）。
 */
@Injectable()
export class SessionGroupService {
  private readonly logger = new Logger(SessionGroupService.name);

  constructor(
    private sessionStore: SessionMetaStore,
    private streamManager: SessionStreamManager,
  ) {}

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

  /** 分组统计（仅 web 会话；归档确认弹窗用） */
  async getStats(groupId: string) {
    const group = await this.requireGroup(groupId);
    const count = (extra: { archived?: boolean; pinned?: boolean }) =>
      this.sessionStore.queryPaged(
        { groupId: group.id, sessionType: "web", ...extra },
        "lastActiveDesc",
        { skip: 0, limit: 0 },
      ).total;

    const total = count({});
    const active = count({ archived: false });
    const pinned = count({ archived: false, pinned: true });
    return { total, active, archived: total - active, pinned };
  }

  /**
   * 归档本分组：归档组内全部对话（置顶也归档，流式输出中的跳过）。
   * 分组行保留——手工分组是用户显式创建的组织结构，不因归档而删除。
   * 返回成功归档的 id，供前端精确清理本地会话缓存。
   */
  async archiveGroup(groupId: string) {
    const group = await this.requireGroup(groupId);
    const metas = this.sessionStore.query(
      { groupId: group.id, sessionType: "web", archived: false },
      "createdAsc",
    );

    const skipped: string[] = [];
    const sessionIds: string[] = [];
    for (const meta of metas) {
      if (this.streamManager.hasActiveStream(meta.id)) {
        skipped.push(meta.id);
        continue;
      }
      await this.sessionStore.update(meta.id, { archived: true });
      sessionIds.push(meta.id);
    }

    return {
      success: true,
      archived: sessionIds.length,
      skipped: skipped.length,
      sessionIds,
    };
  }

  private async requireGroup(groupId: string) {
    const group = await this.sessionStore.findGroupById(groupId);
    if (!group) {
      throw new HttpException("分组不存在", HttpStatus.NOT_FOUND);
    }
    return group;
  }
}
