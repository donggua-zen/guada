import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import * as crypto from "crypto";
import { UserRepository } from "../../common/database/user.repository";
import { UploadPathService } from "../../common/services/upload-path.service";
import { UrlService } from "../../common/services/url.service";

@Injectable()
export class UserService {
  private resetPasswordFlagPath = path.join(
    process.cwd(),
    "password_is_set.txt",
  );
  private readonly ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  constructor(
    private uploadPathService: UploadPathService,
    private userRepo: UserRepository,
    private urlService: UrlService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error("用户不存在");
    }

    const { passwordHash, ...result } = user;
    // 转换 URL（avatarUrl 是上传文件）
    return {
      ...result,
      avatarUrl: result.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(result.avatarUrl)
        : null,
    };
  }

  async updateProfile(userId: string, data: any) {
    return this.userRepo.update(userId, data);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.userRepo.findById(userId);
    if (!user || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new Error("旧密码不正确");
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return this.userRepo.update(userId, { passwordHash: hashedPassword });
  }

  async createSubAccount(parentId: string, data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return this.userRepo.create({
      ...data,
      parentId,
      role: "subaccount",
      passwordHash: hashedPassword,
    });
  }

  async getSubAccounts(parentId: string) {
    return this.userRepo.findSubAccounts(parentId);
  }

  async deleteSubAccount(accountId: string, parentId: string) {
    const account = await this.userRepo.findById(accountId);
    if (!account || account.parentId !== parentId) {
      throw new Error("无权删除该子账户");
    }
    return this.userRepo.update(accountId, { deletedAt: new Date() }); // 软删除或根据需求物理删除
  }

  /**
   * 上传并处理用户头像
   */
  async uploadAvatar(userId: string, file: any) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error("用户不存在");
    }

    // 1. 验证文件类型
    if (!file || !this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new Error(
        `不支持的文件类型。允许的类型: ${this.ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }

    // 2. 获取物理路径（自动创建目录）
    const avatarDir = this.uploadPathService.getPhysicalPath("avatars");

    // 3. 生成唯一文件名
    const uniqueFilename = `${crypto.randomUUID()}.jpg`;
    const filePath = path.join(avatarDir, uniqueFilename);

    try {
      // 4. 使用 sharp 缩放并转换为 JPEG
      await sharp(file.buffer)
        .resize(128, 128, { fit: "cover" })
        .jpeg({ quality: 95 })
        .toFile(filePath);

      // 5. 清理旧头像
      if (user.avatarUrl) {
        const oldFilePath = this.uploadPathService.toPhysicalPath(user.avatarUrl);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      // 6. 更新数据库（存储相对路径）
      const relativePath = this.uploadPathService.getStoragePath(
        "avatars",
        uniqueFilename,
      );
      await this.userRepo.update(userId, { avatarUrl: relativePath });

      // 转换为绝对 URL 后返回
      return { url: this.urlService.toResourceAbsoluteUrl(relativePath) };
    } catch (error: any) {
      // 如果处理失败，删除可能已生成的临时文件
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw new Error(`头像上传失败: ${error.message}`);
    }
  }

  isPasswordResetAllowed(): boolean {
    return !fs.existsSync(this.resetPasswordFlagPath);
  }

  markPasswordAsSet() {
    fs.writeFileSync(this.resetPasswordFlagPath, "password has been set");
  }

  async resetPrimaryPassword(password: string, username?: string) {
    if (!username) {
      throw new Error("用户名不能为空");
    }

    const user = await this.userRepo.findByUsername(username);

    if (!user) {
      throw new Error("用户不存在");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    return this.userRepo.update(user.id, { passwordHash: hashedPassword });
  }
}
