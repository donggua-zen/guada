import { Injectable } from "@nestjs/common";
import { CharacterRepository } from "../../common/database/character.repository";
import { CharacterGroupRepository } from "../../common/database/character-group.repository";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

@Injectable()
export class CharacterService {
  constructor(
    private characterRepo: CharacterRepository,
    private groupRepo: CharacterGroupRepository,
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

    // 转换所有 character 的 URL
    const transformedItems = this.urlService.transformArrayUrls(items);
    return createPaginatedResponse(transformedItems, total, { skip, limit });
  }

  async getCharacterById(characterId: string) {
    const character = await this.characterRepo.findById(characterId);

    if (!character) {
      throw new Error("Character not found");
    }

    // 转换 URL
    return this.urlService.transformUrls(character);
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

    // 转换 URL 后返回
    return this.urlService.transformUrls(character);
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

    // 转换 URL 后返回
    return this.urlService.transformUrls(updatedCharacter);
  }

  async deleteCharacter(characterId: string) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }
    return this.characterRepo.delete(characterId);
  }

  async uploadAvatar(characterId: string, fileUrl: string) {
    return this.updateCharacter(characterId, { avatarUrl: fileUrl });
  }

  /**
   * 获取全局工具设置
   */
  async getGlobalToolsSettings(): Promise<any> {
    return this.settingsStorage.getSettings('tools');
  }
}
