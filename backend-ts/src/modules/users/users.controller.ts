import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { UserService } from "./user.service";
import { FileInterceptor } from "@nestjs/platform-express";

@Controller()
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly userService: UserService) {}

  @Get("user/profile")
  async getProfile(@CurrentUser() user: any) {
    // 直接传递完整的用户对象，避免重复查询数据库
    return this.userService.getProfile(user.id, user);
  }

  @Put("user/profile")
  async updateProfile(@Body() data: any, @CurrentUser() user: any) {
    return this.userService.updateProfile(user.id, data);
  }

  @Put("user/password")
  async updatePassword(
    @Body() body: { old_password: string; new_password: string },
    @CurrentUser() user: any,
  ) {
    return this.userService.changePassword(
      user.id,
      body.old_password,
      body.new_password,
    );
  }

  @Post("user/password/change")
  async changePassword(
    @Body() body: { oldPassword: string; newPassword: string },
    @CurrentUser() user: any,
  ) {
    return this.userService.changePassword(
      user.id,
      body.oldPassword,
      body.newPassword,
    );
  }

  @Post("subaccounts")
  async createSubAccount(@Body() data: any, @CurrentUser() user: any) {
    return this.userService.createSubAccount(user.id, data);
  }

  @Get("subaccounts")
  async getSubAccounts(@CurrentUser() user: any) {
    return this.userService.getSubAccounts(user.id);
  }

  @Delete("subaccounts/:id")
  async deleteSubAccount(@Param("id") id: string, @CurrentUser() user: any) {
    await this.userService.deleteSubAccount(id, user.id);
    return { success: true };
  }

  @Put("subaccounts/:id")
  async updateSubAccount(
    @Param("id") id: string,
    @Body() data: any,
    @CurrentUser() user: any,
  ) {
    // 验证：仅主账户或本人可更新
    const targetUser = await this.userService.getProfile(id);
    if (!targetUser) {
      throw new Error("用户不存在");
    }

    // 检查权限：必须是主账户或者账户本人
    // user已经是完整用户对象，直接使用id字段
    if (targetUser.parentId !== user.id && targetUser.id !== user.id) {
      throw new Error("无权更新该账户");
    }

    return this.userService.updateProfile(id, data);
  }

  @Post("user/avatars")
  @UseInterceptors(FileInterceptor("avatar"))
  async uploadAvatar(@UploadedFile() file: any, @CurrentUser() user: any) {
    return this.userService.uploadAvatar(user.id, file);
  }

  @Get("user/reset-password")
  checkResetPassword() {
    if (!this.userService.isPasswordResetAllowed()) {
      throw new Error("密码已设置，无法重置");
    }
  }

  @Post("user/reset-password")
  async resetPassword(
    @Body()
    body: {
      username?: string;
      password: string;
    },
  ) {
    if (!this.userService.isPasswordResetAllowed()) {
      throw new Error("密码已设置，无法重置");
    }

    await this.userService.resetPrimaryPassword(
      body.password,
      body.username,
    );
    this.userService.markPasswordAsSet();
    return { success: true };
  }
}
