import { Inject, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { parseGroupIcon } from "../../common/utils/group-icon.util";
import { SESSION_STORE_TOKEN } from './session-store.facade';
import type { SessionStoreFacade } from './session-store.facade';
import { SessionStreamManager } from "./session-stream.manager";

/**
 * 会话分组服务（单账户）
 *
 * 分组无归属维度：全局一份，不再按用户过滤。
 * 权威来源 = `sessions/_meta.db` 的 session_groups 表（见 SessionStoreFacade）。
 */
@Injectable()
export class SessionGroupService {
  private readonly logger = new Logger(SessionGroupService.name);

  constructor(
    @Inject(SESSION_STORE_TOKEN) private sessionStore: SessionStoreFacade,
    private streamManager: SessionStreamManager,
  ) {}

  /** 获取所有会话分组（按 sortOrder 升序） */
  async getGroups() {
    return await this.sessionStore.listGroups();
  }

  /**
   * 创建新分组
   * 自动将 sortOrder 设为当前最大值+1，确保新分组排在最后
   */
  async createGroup(data: { name: string; icon?: string | null }) {
    const icon = parseGroupIcon(data.icon);
    if (icon.invalid) {
      throw new HttpException("无效的分组图标", HttpStatus.BAD_REQUEST);
    }
    const maxOrder = await this.sessionStore.getMaxGroupSortOrder();
    return await this.sessionStore.createGroup({
      name: data.name,
      sortOrder: maxOrder + 1,
      ...(icon.value !== undefined ? { icon: icon.value } : {}),
    });
  }

  /** 更新分组名称和/或图标 */
  async updateGroup(
    groupId: string,
    data: { name?: string; icon?: string | null },
  ) {
    const group = await this.sessionStore.findGroupById(groupId);
    if (!group) {
      throw new HttpException("分组不存在", HttpStatus.NOT_FOUND);
    }
    const updateData: { name?: string; icon?: string | null } = {};
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new HttpException("分组名称不能为空", HttpStatus.BAD_REQUEST);
      }
      updateData.name = name;
    }
    const icon = parseGroupIcon(data.icon);
    if (icon.invalid) {
      throw new HttpException("无效的分组图标", HttpStatus.BAD_REQUEST);
    }
    if (icon.value !== undefined) updateData.icon = icon.value;
    if (Object.keys(updateData).length === 0) {
      throw new HttpException("没有可更新的字段", HttpStatus.BAD_REQUEST);
    }
    return await this.sessionStore.updateGroup(groupId, updateData);
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
    return await this.sessionStore.deleteGroup(groupId);
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

    return await this.sessionStore.batchUpdateGroupSortOrder(
      groupIds.map((id, index) => ({ id, sortOrder: index })),
    );
  }

  /** 分组统计（仅 web 会话；归档确认弹窗用） */
  async getStats(groupId: string) {
    const group = await this.requireGroup(groupId);
    const count = async (extra: { archived?: boolean; pinned?: boolean }) =>
      (
        await this.sessionStore.queryPaged(
          { groupId: group.id, sessionType: "web", ...extra },
          "lastActiveDesc",
          { skip: 0, limit: 0 },
        )
      ).total;

    const total = await count({});
    const active = await count({ archived: false });
    const pinned = await count({ archived: false, pinned: true });
    return { total, active, archived: total - active, pinned };
  }

  /**
   * 归档本分组：归档组内全部对话（置顶也归档，流式输出中的跳过）。
   * 分组行保留——手工分组是用户显式创建的组织结构，不因归档而删除。
   * 返回成功归档的 id，供前端精确清理本地会话缓存。
   */
  async archiveGroup(groupId: string) {
    const group = await this.requireGroup(groupId);
    const metas = await this.sessionStore.query(
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
