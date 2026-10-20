import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ProjectGroupService } from "./project-group.service";

/**
 * 目录分组（侧栏「目录」模式）。
 *
 * 只暴露「改显示名 / 排序 / 取消注册」——分组实体由启动期一次性注册与
 * 新建会话写时注册产生，不走手工创建，避免空分组与自动目录膨胀。
 */
@Controller("project-groups")
@UseGuards(AuthGuard)
export class ProjectGroupController {
  constructor(private readonly projectGroupService: ProjectGroupService) {}

  /** 获取所有目录分组 */
  @Get()
  async getGroups() {
    return this.projectGroupService.getGroups();
  }

  /** 手动注册项目目录（侧栏快捷入口） */
  @Post()
  async createGroup(@Body() data: { path?: string }) {
    return this.projectGroupService.createGroup(data);
  }

  /** 项目统计（删除/归档确认弹窗用） */
  @Get(":id/stats")
  async getStats(@Param("id") id: string) {
    return this.projectGroupService.getStats(id);
  }

  /** 重命名（仅显示名，不改磁盘目录） */
  @Put(":id")
  async renameGroup(@Param("id") id: string, @Body() data: { name?: string }) {
    return this.projectGroupService.renameGroup(id, data);
  }

  /** 批量更新排序（按新顺序排列的完整分组 id 数组） */
  @Post("reorder")
  async reorderGroups(@Body() data: { groupIds: string[] }) {
    await this.projectGroupService.reorderGroups(data.groupIds);
    return { success: true };
  }

  /** 归档项目：归档其下全部对话（流式输出中的会话跳过） */
  @Post(":id/archive")
  async archiveGroup(@Param("id") id: string) {
    return this.projectGroupService.archiveGroup(id);
  }

  /** 删除项目：永久删除其下全部对话并移除分组（工作目录与文件保留） */
  @Delete(":id")
  async deleteGroup(@Param("id") id: string) {
    return this.projectGroupService.deleteGroup(id);
  }
}
