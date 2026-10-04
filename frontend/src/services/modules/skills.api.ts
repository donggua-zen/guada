import type { ApiContext } from "./api-context";
import type { PaginatedResponse } from "@/types/common";
import type { Skill, SkillCommand } from "@/types/skills";

export interface SkillsApi {
  fetchSkills(): Promise<PaginatedResponse<Skill>>;
  fetchCommands(trigger: string, agentId?: string): Promise<{ items: SkillCommand[]; total: number }>;
  fetchSkillDetail(skillId: string): Promise<Skill | null>;
  fetchSkillDocumentation(skillId: string): Promise<{ content: string }>;
  scanSkills(): Promise<{ success: boolean; message: string }>;
  reloadSkill(skillId: string): Promise<Skill>;
  getAutoScanStatus(): Promise<{ enabled: boolean }>;
  toggleAutoScan(enabled: boolean): Promise<{ enabled: boolean }>;
  installSkill(file: File, force?: boolean): Promise<{ success: boolean; skillId?: string; message: string }>;
  installSkillFromUrl(url: string, force?: boolean): Promise<{ success: boolean; skillId?: string; message: string }>;
  uninstallSkill(skillId: string): Promise<{ success: boolean; message: string }>;
  enableSkill(skillId: string): Promise<{ success: boolean; message: string }>;
  disableSkill(skillId: string): Promise<{ success: boolean; message: string }>;
  batchToggleSkills(ids: string[], enabled: boolean): Promise<{ success: boolean; message: string }>;
  fetchSkillsEnabledStatus(): Promise<Array<{ id: string; enabled: boolean }>>;
}

export const skillsApi: SkillsApi = {
  async fetchSkills(this: ApiContext) {
    return await this._request<PaginatedResponse<Skill>>("/skills");
  },

  async fetchCommands(this: ApiContext, trigger: string, agentId?: string) {
    const query = agentId
      ? `/commands?trigger=${trigger}&agentId=${agentId}`
      : `/commands?trigger=${trigger}`;
    return await this._request<{ items: SkillCommand[]; total: number }>(query);
  },

  async fetchSkillDetail(this: ApiContext, skillId: string) {
    return await this._request<Skill | null>(`/skills/${skillId}`);
  },

  async fetchSkillDocumentation(this: ApiContext, skillId: string) {
    return await this._request<{ content: string }>(`/skills/${skillId}/documentation`);
  },

  async scanSkills(this: ApiContext) {
    return await this._request<{ success: boolean; message: string }>("/skills/scan", {
      method: "POST",
    });
  },

  async reloadSkill(this: ApiContext, skillId: string) {
    return await this._request<Skill>(`/skills/${skillId}/reload`, { method: "POST" });
  },

  async getAutoScanStatus(this: ApiContext) {
    return await this._request<{ enabled: boolean }>("/skills/watcher/status");
  },

  async toggleAutoScan(this: ApiContext, enabled: boolean) {
    return await this._request<{ enabled: boolean }>("/skills/watcher/toggle", {
      method: "POST",
      data: { enabled },
    });
  },

  async installSkill(this: ApiContext, file: File, force: boolean = false) {
    const formData = new FormData();
    formData.append("file", file);
    if (force) {
      formData.append("force", "true");
    }

    try {
      return await this._request<{ success: boolean; skillId?: string; message: string }>("/skills/install", {
        method: "POST",
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("安装 Skill 失败:", error);
      throw error;
    }
  },

  async installSkillFromUrl(this: ApiContext, url: string, force: boolean = false) {
    return await this._request<{ success: boolean; skillId?: string; message: string }>("/skills/install-from-url", {
      method: "POST",
      data: { url, force },
    });
  },

  async uninstallSkill(this: ApiContext, skillId: string) {
    return await this._request<{ success: boolean; message: string }>(`/skills/${skillId}/uninstall`, {
      method: "POST",
    });
  },

  async enableSkill(this: ApiContext, skillId: string) {
    return await this._request<{ success: boolean; message: string }>(`/skills/${skillId}/enable`, {
      method: "POST",
    });
  },

  async disableSkill(this: ApiContext, skillId: string) {
    return await this._request<{ success: boolean; message: string }>(`/skills/${skillId}/disable`, {
      method: "POST",
    });
  },

  async batchToggleSkills(this: ApiContext, ids: string[], enabled: boolean) {
    return await this._request<{ success: boolean; message: string }>("/skills/batch-toggle", {
      method: "POST",
      data: { ids, enabled },
    });
  },

  async fetchSkillsEnabledStatus(this: ApiContext) {
    return await this._request<Array<{ id: string; enabled: boolean }>>("/skills/enabled-status");
  },
};
