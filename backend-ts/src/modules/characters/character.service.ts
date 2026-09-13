import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";
import sharp from "sharp";
import { CharacterRepository } from "../../common/database/character.repository";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { assertResolvableModelRef } from "../llm-core/utils/model-reference.util";
import { CharacterFileStore } from "./character-file.store";
import { parseAgentMarkdown } from "./character-file.mapper";

/**
 * 角色/智能体服务（文件权威）
 *
 * 定义存于 `<AGENTS_DATA_DIR>/<id>/AGENT.md`，头像存于同目录内，
 * 删除时整目录进回收站，因此不存在孤儿头像。
 */
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
    private characterStore: CharacterFileStore,
    private urlService: UrlService,
    private settingsStorage: SettingsStorage,
    private modelStore: ProviderFileStore,
  ) {}

  // --- Character Management ---

  async getCharacters(
    skip: number = 0,
    limit: number = 20,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.characterRepo.findAll(skip, limit);
    return createPaginatedResponse(
      items.map((item) => this.withAbsoluteAvatar(item)),
      total,
      { skip, limit },
    );
  }

  async getCharacterById(characterId: string) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }
    return this.withAbsoluteAvatar(character);
  }

  async createCharacter(data: any) {
    const name = this.readName(data);
    assertResolvableModelRef(this.modelStore, data.modelId, "modelId");

    const character = await this.characterRepo.create({
      name,
      description: data.description ?? null,
      modelId: data.modelId ?? null,
      settings: data.settings ?? null,
    });

    return this.withAbsoluteAvatar(character);
  }

  async updateCharacter(characterId: string, data: any) {
    const existing = await this.characterRepo.findById(characterId);
    if (!existing) {
      throw new Error("Character not found");
    }
    assertResolvableModelRef(this.modelStore, data.modelId, "modelId");

    const patch: Record<string, any> = {};
    const name = data.name ?? data.title;
    if (name !== undefined) patch.name = this.readName({ name });
    if (data.description !== undefined) patch.description = data.description;
    if (data.modelId !== undefined) patch.modelId = data.modelId;
    if (data.settings !== undefined) patch.settings = data.settings;

    const updated = await this.characterRepo.update(characterId, patch);
    if (!updated) {
      throw new Error("Character not found");
    }
    return this.withAbsoluteAvatar(updated);
  }

  async deleteCharacter(characterId: string) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }
    return this.characterRepo.delete(characterId);
  }

  /**
   * 上传并处理角色头像（写入角色目录内的 `avatar.png`）
   *
   * 头像随角色目录存亡：删除角色即随目录进回收站，不产生孤儿文件。
   */
  async uploadAvatar(characterId: string, file: any) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("角色不存在");
    }

    if (!file || !this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new Error(
        `不支持的文件类型。允许的类型: ${this.ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }

    const buffer = await sharp(file.buffer)
      .resize(128, 128, { fit: "cover" })
      .png()
      .toBuffer();

    const storagePath = await this.characterStore.saveAvatar(
      characterId,
      buffer,
      "png",
    );
    if (!storagePath) {
      throw new Error("头像写入失败");
    }

    return { url: this.urlService.toResourceAbsoluteUrl(storagePath) };
  }

  /**
   * 从 .md 文件导入角色
   * 文件格式: YAML frontmatter (name, description, settings) + Markdown body (systemPrompt)
   */
  async importCharacters(files: { content: string; filename: string }[]) {
    const results: {
      filename: string;
      status: "ok" | "invalid";
      characterId?: string;
      error?: string;
    }[] = [];

    for (const file of files) {
      try {
        const fallbackName = file.filename.replace(/\.(md|markdown)$/i, "");
        const parsed = parseAgentMarkdown(file.content, fallbackName);
        if (!parsed.name) {
          results.push({
            filename: file.filename,
            status: "invalid",
            error: "缺少 name 字段",
          });
          continue;
        }

        const character = await this.characterRepo.create({
          name: parsed.name,
          description: parsed.description ?? null,
          modelId: parsed.model ?? null,
          settings: parsed.settings,
        });

        results.push({
          filename: file.filename,
          status: "ok",
          characterId: character.id,
        });
      } catch (error: any) {
        results.push({
          filename: file.filename,
          status: "invalid",
          error: error.message,
        });
      }
    }

    return results;
  }

  // --- 内部 ---

  private readName(data: any): string {
    const name = data?.name ?? data?.title;
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("角色名称不能为空");
    }
    return name.trim();
  }

  private withAbsoluteAvatar(character: any) {
    return {
      ...character,
      avatarUrl: character.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(character.avatarUrl)
        : null,
    };
  }
}
