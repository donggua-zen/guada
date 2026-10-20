import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { SessionMetaStore } from "./session-meta.store";
import { SessionService } from "./session.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { qualifiesForProjectGroup } from "../../common/utils/workspace-key.util";

/**
 * 目录分组服务（按工作目录分组，单账户）。
 *
 * 权威来源 = `sessions/_meta.db` 的 `project_groups` 表（见 SessionMetaStore）。
 * 成员关系是派生的（`sessions.workspace_key = path_key`），所以「归档/删除项目」
 * 是按目录键批量操作会话，再由本服务删除分组行；会话生命周期（流式护栏、
 * 子会话级联、JSONL 清理、watcher 停止）全部委托给 SessionService。
 *
 * 不提供「新建分组」：分组只由启动期一次性注册与新建会话写时注册产生，
 * 避免用户手动造出没有成员的空目录分组。
 */
@Injectable()
export class ProjectGroupService {
  private readonly logger = new Logger(ProjectGroupService.name);

  constructor(
    private sessionStore: SessionMetaStore,
    private sessionService: SessionService,
    private workspaceService: WorkspaceService,
  ) {}

  /** 获取所有目录分组（按 position 升序） */
  async getGroups() {
    return this.sessionStore.listProjectGroups();
  }

  /**
   * 手动注册一个项目目录（侧栏快捷入口）。
   *
   * 只接受已存在的绝对目录；公共目录、自动生成目录不允许注册。
   * 同路径已注册时幂等返回既有分组（不会覆盖用户改过的名字）。
   */
  async createGroup(data: { path?: string }) {
    const raw = data.path?.trim();
    if (!raw || !path.isAbsolute(raw)) {
      throw new HttpException("请选择有效的绝对路径", HttpStatus.BAD_REQUEST);
    }
    const resolved = path.resolve(raw);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new HttpException("目录不存在", HttpStatus.BAD_REQUEST);
    }
    if (!stat.isDirectory()) {
      throw new HttpException("路径不是目录", HttpStatus.BAD_REQUEST);
    }

    const baseDir = await this.workspaceService.getEffectiveBaseDir();
    if (!qualifiesForProjectGroup(resolved, baseDir)) {
      throw new HttpException(
        "公共目录或自动生成目录不能注册为项目",
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.sessionStore.ensureProjectGroup({
      path: resolved,
      prepend: true,
    });
  }

  /** 重命名（只改显示名，不动磁盘目录） */
  async renameGroup(id: string, data: { name?: string }) {
    const name = data.name?.trim();
    if (!name) {
      throw new HttpException("分组名称不能为空", HttpStatus.BAD_REQUEST);
    }
    const group = await this.requireGroup(id);
    return this.sessionStore.renameProjectGroup(group.id, name);
  }

  /** 批量更新排序（要求完整 id 集合） */
  async reorderGroups(groupIds: string[]) {
    const groups = await this.sessionStore.listProjectGroups();
    const knownIds = new Set(groups.map((g) => g.id));
    if (
      groupIds.length !== knownIds.size ||
      new Set(groupIds).size !== groupIds.length ||
      groupIds.some((id) => !knownIds.has(id))
    ) {
      throw new HttpException(
        "目录分组排序：id 集合不完整或包含未知 id",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.sessionStore.reorderProjectGroups(groupIds);
  }

  /** 统计该目录下的会话数量（删除/归档确认弹窗用） */
  async getStats(id: string) {
    const group = await this.requireGroup(id);
    return this.sessionService.getProjectGroupStats(group.pathKey);
  }

  /**
   * 归档项目：归档其下全部对话。
   * 流式输出中的会话跳过（在 skipped 中返回），分组行保留。
   */
  async archiveGroup(id: string) {
    const group = await this.requireGroup(id);
    const result = await this.sessionService.archiveProjectGroupSessions(
      group.pathKey,
    );
    return { success: true, ...result };
  }

  /**
   * 删除项目：删除其下全部对话（子会话级联），再删除分组行。
   * 任一会话或其子会话在流式输出时整体中止（409），不会部分删除。
   * 磁盘上的工作目录与文件不受影响。
   */
  async deleteGroup(id: string) {
    const group = await this.requireGroup(id);
    const result = await this.sessionService.deleteProjectGroupSessions(
      group.pathKey,
    );
    await this.sessionStore.deleteProjectGroup(group.id);
    return { success: true, ...result };
  }

  private async requireGroup(id: string) {
    const group = await this.sessionStore.findProjectGroup(id);
    if (!group) {
      throw new HttpException("目录分组不存在", HttpStatus.NOT_FOUND);
    }
    return group;
  }
}
