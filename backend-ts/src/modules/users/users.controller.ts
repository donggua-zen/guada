import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserService } from "./user.service";
import { FileInterceptor } from "@nestjs/platform-express";

@Controller()
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly userService: UserService) {}

  @Get("user/profile")
  async getProfile() {
    return this.userService.getProfile();
  }

  @Put("user/profile")
  async updateProfile(@Body() data: any) {
    return this.userService.updateProfile(data);
  }

  /** 设置密码（已设密码时需提供旧密码；未设密码时为首次设置） */
  @Put("user/password")
  async updatePassword(
    @Body() body: { old_password?: string; new_password: string },
  ) {
    return this.userService.setPassword(body.old_password, body.new_password);
  }

  @Post("user/password/change")
  async changePassword(
    @Body() body: { oldPassword?: string; newPassword: string },
  ) {
    return this.userService.setPassword(body.oldPassword, body.newPassword);
  }

  /** 清除密码 → 回到免登录模式 */
  @Delete("user/password")
  async clearPassword() {
    return this.userService.clearPassword();
  }

  @Post("user/avatars")
  @UseInterceptors(FileInterceptor("avatar"))
  async uploadAvatar(@UploadedFile() file: any) {
    return this.userService.uploadAvatar(file);
  }

  @Post("user/wallpaper")
  @UseInterceptors(FileInterceptor("wallpaper"))
  async uploadWallpaper(@UploadedFile() file: any) {
    return this.userService.uploadWallpaper(file);
  }

  @Delete("user/wallpaper")
  async deleteWallpaper() {
    await this.userService.deleteWallpaper();
    return { success: true };
  }
}
