import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { SessionGroupService } from "./session-group.service";

@Controller("session-groups")
@UseGuards(AuthGuard)
export class SessionGroupController {
  constructor(private readonly sessionGroupService: SessionGroupService) { }

  /** 获取所有会话分组 */
  @Get()
  async getGroups() {
    return this.sessionGroupService.getGroups();
  }

  /**
   * 创建新分组
   */
  @Post()
  async createGroup(@Body() data: { name: string }) {
    return this.sessionGroupService.createGroup(data);
  }

  /**
   * 更新分组名称
   */
  @Put(":id")
  async updateGroup(@Param("id") id: string, @Body() data: { name: string }) {
    return this.sessionGroupService.updateGroup(id, data);
  }

  /**
   * 删除分组
   */
  @Delete(":id")
  async deleteGroup(@Param("id") id: string) {
    await this.sessionGroupService.deleteGroup(id);
    return { success: true };
  }

  /**
   * 批量更新分组排序
   * @param data.groupIds 按新顺序排列的分组ID数组
   */
  @Post("reorder")
  async reorderGroups(@Body() data: { groupIds: string[] }) {
    await this.sessionGroupService.reorderGroups(data.groupIds);
    return { success: true };
  }
}
