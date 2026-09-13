import type { ApiContext } from "./api-context";
import type {
  Character,
  CharacterListResponse,
} from "@/types/character";

export interface CharacterApi {
  fetchCharacters(): Promise<CharacterListResponse>;
  fetchCharacter(characterId: string): Promise<Character>;
  createCharacter(characterData: any): Promise<Character>;
  updateCharacter(characterId: string, characterData: any): Promise<Character>;
  deleteCharacter(characterId: string): Promise<{ success: boolean }>;
  importCharacters(files: { content: string; filename: string }[]): Promise<{ filename: string; status: string; characterId?: string; error?: string }[]>;
}

export const characterApi: CharacterApi = {
  async fetchCharacters(this: ApiContext) {
    return await this._request(`/characters`);
  },

  async fetchCharacter(this: ApiContext, characterId: string) {
    return await this._request(`/characters/${encodeURIComponent(characterId)}`);
  },

  async createCharacter(this: ApiContext, characterData: any) {
    return await this._request("/characters", {
      method: "POST",
      data: characterData,
    });
  },

  async updateCharacter(this: ApiContext, characterId: string, characterData: any) {
    return await this._request(`/characters/${encodeURIComponent(characterId)}`, {
      method: "PUT",
      data: characterData,
    });
  },

  async deleteCharacter(this: ApiContext, characterId: string) {
    return await this._request(`/characters/${encodeURIComponent(characterId)}`, {
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
