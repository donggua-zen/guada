import type { ApiContext } from "./api-context";
import type {
  Character,
  CharacterListResponse,
  CharacterGroup,
} from "@/types/character";

export interface CharacterApi {
  fetchCharacters(groupId?: string): Promise<CharacterListResponse>;
  fetchCharacterGroups(): Promise<CharacterGroup[]>;
  createCharacterGroup(data: { name: string }): Promise<CharacterGroup>;
  updateCharacterGroup(groupId: string, data: { name: string }): Promise<CharacterGroup>;
  deleteCharacterGroup(groupId: string): Promise<{ success: boolean }>;
  fetchCharacter(characterId: string): Promise<Character>;
  createCharacter(characterData: any): Promise<Character>;
  updateCharacter(characterId: string, characterData: any): Promise<Character>;
  deleteCharacter(characterId: string): Promise<{ success: boolean }>;
  importCharacters(files: { content: string; filename: string }[]): Promise<{ filename: string; status: string; characterId?: string; error?: string }[]>;
}

export const characterApi: CharacterApi = {
  async fetchCharacters(this: ApiContext, groupId?: string) {
    const params = groupId ? `?groupId=${groupId}` : "";
    return await this._request(`/characters${params}`);
  },

  async fetchCharacterGroups(this: ApiContext) {
    return await this._request("/character-groups");
  },

  async createCharacterGroup(this: ApiContext, data: { name: string }) {
    return await this._request("/character-groups", { method: "POST", data });
  },

  async updateCharacterGroup(this: ApiContext, groupId: string, data: { name: string }) {
    return await this._request(`/character-groups/${groupId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteCharacterGroup(this: ApiContext, groupId: string) {
    return await this._request(`/character-groups/${groupId}`, {
      method: "DELETE",
    });
  },

  async fetchCharacter(this: ApiContext, characterId: string) {
    return await this._request(`/characters/${characterId}`);
  },

  async createCharacter(this: ApiContext, characterData: any) {
    return await this._request("/characters", {
      method: "POST",
      data: characterData,
    });
  },

  async updateCharacter(this: ApiContext, characterId: string, characterData: any) {
    return await this._request(`/characters/${characterId}`, {
      method: "PUT",
      data: characterData,
    });
  },

  async deleteCharacter(this: ApiContext, characterId: string) {
    return await this._request(`/characters/${characterId}`, {
      method: "DELETE",
    });
  },

  async importCharacters(this: ApiContext, files: { content: string; filename: string }[]) {
    return await this._request("/characters/import", {
      method: "POST",
      data: { files },
    });
  },
};
