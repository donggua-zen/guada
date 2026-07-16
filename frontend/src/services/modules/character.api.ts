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
  fetchAgents(): Promise<{ agents: any[]; groups: any[]; agentsDir?: string }>;
  fetchAgentDetail(id: string): Promise<any>;
  updateAgentVisibility(id: string, visible: boolean, collapsed?: boolean): Promise<any>;
  deleteAgent(id: string): Promise<any>;
  createAgent(data: any): Promise<any>;
  updateAgent(id: string, data: any): Promise<any>;
  importAgents(data: { files: { content: string; filename: string }[]; folder?: string; overwrite?: boolean }): Promise<any>;
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

  async fetchAgents(this: ApiContext) {
    return await this._request("/agents");
  },

  async fetchAgentDetail(this: ApiContext, id: string) {
    return await this._request(`/agents/${encodeURIComponent(id)}`);
  },

  async updateAgentVisibility(this: ApiContext, id: string, visible: boolean, collapsed?: boolean) {
    return await this._request(`/agents/${encodeURIComponent(id)}/visibility`, {
      method: "PUT",
      data: collapsed !== undefined ? { visible, collapsed } : { visible },
    });
  },

  async deleteAgent(this: ApiContext, id: string) {
    return await this._request(`/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async createAgent(this: ApiContext, data: any) {
    return await this._request("/agents", { method: "POST", data });
  },

  async updateAgent(this: ApiContext, id: string, data: any) {
    return await this._request(`/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      data,
    });
  },

  async importAgents(this: ApiContext, data: { files: { content: string; filename: string }[]; folder?: string; overwrite?: boolean }) {
    return await this._request("/agents/import", { method: "POST", data });
  },
};
