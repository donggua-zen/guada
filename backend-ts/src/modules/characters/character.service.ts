import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import sharp from "sharp";
import { CharacterRepository } from "../../common/database/character.repository";
import { CharacterGroupRepository } from "../../common/database/character-group.repository";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { UploadPathService } from "../../common/services/upload-path.service";
import { UrlService } from "../../common/services/url.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

@Injectable()
export class CharacterService {
  private readonly ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  constructor(
    private characterRepo: CharacterRepository,
    private groupRepo: CharacterGroupRepository,
    private uploadPathService: UploadPathService,
    private urlService: UrlService,
    private settingsStorage: SettingsStorage,
  ) { }

  // --- Group Management ---
  async getGroups() {
    return this.groupRepo.findAll();
  }

  async createGroup(userId: string, data: any) {
    return this.groupRepo.create({ ...data, userId });
  }

  async updateGroup(groupId: string, data: any) {
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new Error("Group not found");
    }
    return this.groupRepo.update(groupId, data);
  }

  async deleteGroup(groupId: string) {
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new Error("Group not found");
    }
    // 自动将该分组下的所有助手 groupId 置为 null
    await this.characterRepo.updateManyByGroupId(groupId, null);
    return this.groupRepo.delete(groupId);
  }

  // --- Character Management ---
  async getCharacters(
    skip: number = 0,
    limit: number = 20,
    groupId?: string,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findAll(
      skip,
      limit,
      groupId,
    );

    // 转换所有 character 的 URL（avatarUrl 是上传文件）
    const transformedItems = items.map((item) => ({
      ...item,
      avatarUrl: item.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(item.avatarUrl)
        : null,
    }));
    return createPaginatedResponse(transformedItems, total, { skip, limit });
  }

  async getCharacterById(characterId: string) {
    const character = await this.characterRepo.findById(characterId);

    if (!character) {
      throw new Error("Character not found");
    }

    // 转换 URL（avatarUrl 是上传文件）
    return {
      ...character,
      avatarUrl: character.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(character.avatarUrl)
        : null,
    };
  }

  async createCharacter(userId: string, data: any) {
    // 过滤掉嵌套的 model 对象，只保留 modelId
    const { model, ...restData } = data;
    const cleanData = {
      ...restData,
      userId,
      // 如果前端传了 modelId，使用它
      ...(data.modelId && { modelId: data.modelId }),
    };

    const character = await this.characterRepo.create(cleanData);

    // 转换 URL 后返回（avatarUrl 是上传文件）
    return {
      ...character,
      avatarUrl: character.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(character.avatarUrl)
        : null,
    };
  }

  async updateCharacter(characterId: string, data: any) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }

    // 过滤掉嵌套的 model 对象，只保留 modelId
    const { model, ...restData } = data;
    const cleanData = {
      ...restData,
      // 如果前端传了 modelId，使用它；否则保持原值
      ...(data.modelId && { modelId: data.modelId }),
    };

    const updatedCharacter = await this.characterRepo.update(
      characterId,
      cleanData,
    );

    // 转换 URL 后返回（avatarUrl 是上传文件）
    return {
      ...updatedCharacter,
      avatarUrl: updatedCharacter.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(updatedCharacter.avatarUrl)
        : null,
    };
  }

  async deleteCharacter(characterId: string) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }
    return this.characterRepo.delete(characterId);
  }

  /**
   * 上传并处理角色头像
   */
  async uploadAvatar(characterId: string, file: any) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("角色不存在");
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
      if (character.avatarUrl) {
        const oldFilePath = this.uploadPathService.toPhysicalPath(character.avatarUrl);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      // 6. 更新数据库（存储相对路径）
      const relativePath = this.uploadPathService.getStoragePath(
        "avatars",
        uniqueFilename,
      );
      await this.characterRepo.update(characterId, { avatarUrl: relativePath });

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

  /**
   * 获取全局工具设置
   */
  async getGlobalToolsSettings(): Promise<any> {
    return this.settingsStorage.getSettings('tools');
  }
}
