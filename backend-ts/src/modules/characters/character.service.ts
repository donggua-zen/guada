import { Injectable } from "@nestjs/common";
import { CharacterRepository } from "../../common/database/character.repository";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";

@Injectable()
export class CharacterService {
  constructor(private characterRepo: CharacterRepository) {}

  async getCharactersByUser(
    userId: string,
    skip: number = 0,
    limit: number = 20,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findByUserId(
      userId,
      skip,
      limit,
    );

    return createPaginatedResponse(items, total, { skip, limit });
  }

  async getSharedCharacters(
    skip: number = 0,
    limit: number = 20,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findPublic(skip, limit);

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
