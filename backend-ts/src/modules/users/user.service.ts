import { BadRequestException, Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import * as crypto from "crypto";
import { UploadPathService } from "../../common/services/upload-path.service";
import { UrlService } from "../../common/services/url.service";
import { AccountFileStore } from "../auth/account-file.store";
import { MobileAccessService } from "../mobile-access/mobile-access.service";
import {
  PASSWORD_VALIDATION_MESSAGES,
  validatePasswordStrength,
} from "../../common/utils/password-strength.util";

/**
 * 账户服务（单账户）
 *
 * 账户权威来源是 account.json（见 AccountFileStore）。
 * 头像/壁纸仍走既有 uploads 上传管线与静态挂载，只把引用路径写回账户文件。
 */
@Injectable()
export class UserService {
  private readonly ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  constructor(
    private uploadPathService: UploadPathService,
    private accountStore: AccountFileStore,
    private urlService: UrlService,
    private mobileAccess: MobileAccessService,
  ) {}

  getProfile() {
    const view = this.accountStore.getView();
    return {
      ...view,
      avatarUrl: view.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(view.avatarUrl)
        : null,
      wallpaperUrl: view.wallpaperUrl
        ? this.urlService.toResourceAbsoluteUrl(view.wallpaperUrl)
        : null,
    };
  }

  /** 更新展示性资料（用户名/昵称） */
  async updateProfile(data: {
    username?: string;
    nickname?: string;
    avatarUrl?: string;
    wallpaperUrl?: string | null;
  }) {
    const patch: Record<string, any> = {};
    if (data.username !== undefined) {
      if (!data.username.trim()) throw new Error("用户名不能为空");
      patch.username = data.username.trim();
    }
    if (data.nickname !== undefined) patch.nickname = data.nickname;
    if (data.avatarUrl !== undefined) patch.avatarUrl = data.avatarUrl;
    if (data.wallpaperUrl !== undefined) patch.wallpaperUrl = data.wallpaperUrl;

    const updated = await this.accountStore.updateProfile(patch);
    const { passwordHash, ...safe } = updated;
    return { ...safe, passwordSet: !!passwordHash };
  }

  /**
   * 设置/修改密码。
   * 已设密码时需提供正确的旧密码；未设密码时（免登录模式）可直接设置。
   * 强度要求：基础策略始终生效；公网访问开启时要求高强度密码。
   */
  /** 设定密码（调用方负责在已设密码时先校验旧密码） */
  async setPassword(oldPassword: string | undefined, newPassword: string) {
    const requireStrong = await this.mobileAccess.isPublicAccessEnabled();
    const username = this.accountStore.get()?.username ?? "guada";
    const errorCode = validatePasswordStrength(newPassword, {
      requireStrong,
      username,
    });
    if (errorCode) {
      throw new BadRequestException(PASSWORD_VALIDATION_MESSAGES[errorCode]);
    }
    if (this.accountStore.isPasswordSet()) {
      if (!oldPassword) throw new Error("请输入当前密码");
      const ok = await this.accountStore.verifyPassword(oldPassword);
      if (!ok) throw new Error("当前密码不正确");
    }
    await this.accountStore.setPassword(newPassword);
    return { success: true, passwordSet: true };
  }

  /** 清除密码 → 回到免登录模式（移动访问开启时禁止，避免外部入口失去唯一门禁） */
  async clearPassword() {
    if (await this.mobileAccess.isAnyAccessEnabled()) {
      throw new BadRequestException("请先关闭局域网/公网访问，再取消访问密码");
    }
    await this.accountStore.clearPassword();
    return { success: true, passwordSet: false };
  }

  /**
   * 上传并处理账户头像
   */
  async uploadAvatar(file: any) {
    this.assertImage(file);

    const avatarDir = this.uploadPathService.getPhysicalPath("avatars");
    const uniqueFilename = `${crypto.randomUUID()}.jpg`;
    const filePath = path.join(avatarDir, uniqueFilename);

    try {
      await sharp(file.buffer)
        .resize(128, 128, { fit: "cover" })
        .jpeg({ quality: 95 })
        .toFile(filePath);

      await this.removeOldUpload(this.accountStore.get()?.avatarUrl);

      const relativePath = this.uploadPathService.getStoragePath(
        "avatars",
        uniqueFilename,
      );
      await this.accountStore.updateProfile({ avatarUrl: relativePath });

      return { url: this.urlService.toResourceAbsoluteUrl(relativePath) };
    } catch (error: any) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw new Error(`头像上传失败: ${error.message}`);
    }
  }

  /**
   * 上传并处理账户壁纸
   */
  async uploadWallpaper(file: any) {
    this.assertImage(file);

    const wallpaperDir = this.uploadPathService.getPhysicalPath("wallpapers");
    const uniqueFilename = `${crypto.randomUUID()}.jpg`;
    const filePath = path.join(wallpaperDir, uniqueFilename);

    try {
      await sharp(file.buffer)
        .resize(1920, null, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toFile(filePath);

      await this.removeOldUpload(this.accountStore.get()?.wallpaperUrl);

      const relativePath = this.uploadPathService.getStoragePath(
        "wallpapers",
        uniqueFilename,
      );
      await this.accountStore.updateProfile({ wallpaperUrl: relativePath });

      return { url: this.urlService.toResourceAbsoluteUrl(relativePath) };
    } catch (error: any) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw new Error(`壁纸上传失败: ${error.message}`);
    }
  }

  /** 删除账户壁纸 */
  async deleteWallpaper() {
    const url = this.accountStore.get()?.wallpaperUrl;
    if (!url) return;
    await this.removeOldUpload(url);
    await this.accountStore.updateProfile({ wallpaperUrl: null });
  }

  private assertImage(file: any): void {
    if (!file || !this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new Error(
        `不支持的文件类型。允许的类型: ${this.ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }
  }

  /** 清理被替换掉的旧上传文件（物理删除，失败不阻断主流程） */
  private async removeOldUpload(storedPath: string | null | undefined) {
    if (!storedPath) return;
    try {
      const oldFilePath = this.uploadPathService.toPhysicalPath(storedPath);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
    } catch {
      /* 旧文件清理失败不影响新文件写入 */
    }
  }
}
