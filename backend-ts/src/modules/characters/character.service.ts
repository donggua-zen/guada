import { Injectable } from "@nestjs/common";
import { CharacterRepository } from "../../common/database/character.repository";
import { CharacterGroupRepository } from "../../common/database/character-group.repository";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";

@Injectable()
export class CharacterService {
  constructor(
    private characterRepo: CharacterRepository,
    private groupRepo: CharacterGroupRepository,
  ) { }

  // --- Group Management ---
  async getGroupsByUser(userId: string) {
    return this.groupRepo.findByUserId(userId);
  }

  async createGroup(userId: string, data: any) {
    return this.groupRepo.create({ ...data, userId });
  }

  async updateGroup(groupId: string, userId: string, data: any) {
    const group = await this.groupRepo.findById(groupId);
    if (!group || group.userId !== userId) {
      throw new Error("Group not found or unauthorized");
    }
    return this.groupRepo.update(groupId, data);
  }

  async deleteGroup(groupId: string, userId: string) {
    const group = await this.groupRepo.findById(groupId);
    if (!group || group.userId !== userId) {
      throw new Error("Group not found or unauthorized");
    }
    // 自动将该分组下的所有助手 groupId 置为 null
    await this.characterRepo.updateManyByGroupId(groupId, null);
    return this.groupRepo.delete(groupId);
  }

  // --- Character Management ---
  async getCharactersByUser(
    userId: string,
    skip: number = 0,
    limit: number = 20,
    groupId?: string,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findByUserId(
      userId,
      skip,
      limit,
      groupId,
    );

    return createPaginatedResponse(items, total, { skip, limit });
  }

  async getCharacterById(characterId: string, userId: string) {
    const character = await this.characterRepo.findById(characterId);

    if (!character) {
      throw new Error("Character not found");
    }

    // 验证权限：只有所有者或公开角色可以访问
    if (character.userId !== userId && !character.isPublic) {
      throw new Error("Character not found or unauthorized");
    }

    return character;
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

    return character;
  }

  async updateCharacter(characterId: string, userId: string, data: any) {
    const character = await this.characterRepo.findById(characterId);
    if (!character || character.userId !== userId) {
      throw new Error("Character not found or unauthorized");
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

    return updatedCharacter;
  }

  async deleteCharacter(characterId: string, userId: string) {
    const character = await this.characterRepo.findById(characterId);
    if (!character || character.userId !== userId) {
      throw new Error("Character not found or unauthorized");
    }
    return this.characterRepo.delete(characterId);
  }

  async uploadAvatar(characterId: string, userId: string, fileUrl: string) {
    return this.updateCharacter(characterId, userId, { avatarUrl: fileUrl });
  }
}
