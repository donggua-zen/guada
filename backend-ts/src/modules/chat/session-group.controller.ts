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
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionGroupService } from "./session-group.service";

@Controller("session-groups")
@UseGuards(AuthGuard)
export class SessionGroupController {
  constructor(private readonly sessionGroupService: SessionGroupService) { }

  /**
   * 获取当前用户的所有会话分组
   */
  @Get()
  async getGroups(@CurrentUser() user: any) {
    return this.sessionGroupService.getGroupsByUser(user.id);
  }

  /**
   * 创建新分组
   */
  @Post()
  async createGroup(
    @Body() data: { name: string },
    @CurrentUser() user: any,
  ) {
    return this.sessionGroupService.createGroup(user.id, data);
  }

  /**
   * 更新分组名称
   */
  @Put(":id")
  async updateGroup(
    @Param("id") id: string,
    @Body() data: { name: string },
    @CurrentUser() user: any,
  ) {
    return this.sessionGroupService.updateGroup(id, user.id, data);
  }

  /**
   * 删除分组
   */
  @Delete(":id")
  async deleteGroup(
    @Param("id") id: string,
    @CurrentUser() user: any,
  ) {
    await this.sessionGroupService.deleteGroup(id, user.id);
    return { success: true };
  }

  /**
   * 批量更新分组排序
   * @param data.groupIds 按新顺序排列的分组ID数组
   */
  @Post("reorder")
  async reorderGroups(
    @Body() data: { groupIds: string[] },
    @CurrentUser() user: any,
  ) {
    await this.sessionGroupService.reorderGroups(user.id, data.groupIds);
    return { success: true };
  }
}
