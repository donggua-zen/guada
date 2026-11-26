import type { ApiContext } from "./api-context";
import type { PaginatedResponse } from "@/types/common";
import type { Skill, SkillCommand, SkillOrigin } from "@/types/skills";

/** 技能列表查询参数（都是可选、互斥的作用域） */
export interface FetchSkillsParams {
  /** 智能体配置页口径：全局 + 该智能体专属技能 */
  agentId?: string;
  /** 项目口径：全局 + 该项目 `.guada/skills`（同名覆盖） */
  projectGroupId?: string;
}

/** 技能开关配置（全局与项目统一格式：`skills.yaml` 的 `disabled` 列表） */
export interface SkillToggleConfig {
  /** 配置文件绝对路径 */
  file: string;
  /** 在该作用域内被禁用的技能 id（已排序） */
  disabled: string[];
  /** 读取时发现的问题（前端提示用，不影响 disabled 生效） */
  warnings: string[];
}

export interface SkillsApi {
  fetchSkills(params?: FetchSkillsParams): Promise<PaginatedResponse<Skill>>;
  fetchCommands(trigger: string, agentId?: string): Promise<{ items: SkillCommand[]; total: number }>;
  fetchSkillDetail(skillId: string, projectGroupId?: string): Promise<Skill | null>;
  fetchSkillDocumentation(skillId: string, projectGroupId?: string): Promise<{ content: string }>;
  scanSkills(projectGroupId?: string): Promise<{ success: boolean; message: string }>;
  reloadSkill(skillId: string, projectGroupId?: string): Promise<Skill>;
  getAutoScanStatus(): Promise<{ enabled: boolean }>;
  toggleAutoScan(enabled: boolean): Promise<{ enabled: boolean }>;
  installSkill(file: File, force?: boolean): Promise<{ success: boolean; skillIds?: string[]; message: string }>;
  installSkillFromUrl(
    url: string,
    force?: boolean,
    origin?: SkillOrigin,
  ): Promise<{ success: boolean; skillIds?: string[]; message: string }>;
  uninstallSkill(skillId: string, projectGroupId?: string): Promise<{ success: boolean; message: string }>;
  enableSkill(skillId: string): Promise<{ success: boolean; message: string }>;
  disableSkill(skillId: string): Promise<{ success: boolean; message: string }>;
  batchToggleSkills(ids: string[], enabled: boolean): Promise<{ success: boolean; message: string }>;
  fetchSkillsEnabledStatus(): Promise<Array<{ id: string; enabled: boolean }>>;
  /** 读取技能开关配置（不带 projectGroupId 时为全局配置） */
  fetchSkillToggleConfig(projectGroupId?: string): Promise<SkillToggleConfig>;
  /**
   * 设置某技能在指定作用域是否禁用。
   *
   * `enabled=false` → 该作用域禁用；`enabled=true` → 从禁用列表移除
   * （全局=默认启用；项目=恢复继承全局）。
   * 没有「在项目内强制启用」——全局已禁用时无法通过项目配置打开。
   */
  setSkillEnabled(
    skillId: string,
    enabled: boolean,
    projectGroupId?: string,
  ): Promise<SkillToggleConfig>;
}

/** 拼 `?projectGroupId=` 片段（空值不拼，保持历史 URL 不变） */
function projectQuery(projectGroupId?: string): string {
  const id = typeof projectGroupId === "string" ? projectGroupId.trim() : "";
  return id ? `projectGroupId=${encodeURIComponent(id)}` : "";
}

export const skillsApi: SkillsApi = {
  /**
   * 技能列表。
   *
   * - 无参数：全局共享技能（技能管理页默认视图）
   * - agentId：全局 + 该智能体专属技能（智能体配置页，专属技能以锁定态展示）
   * - projectGroupId：全局 + 该项目 `.guada/skills`（同名覆盖，覆盖项带 overridden）
   *
   * 两者互斥，同时传入时后端以 projectGroupId 为准。
   */
  async fetchSkills(this: ApiContext, params?: FetchSkillsParams) {
    const search = new URLSearchParams();
    if (params?.agentId) search.set("agentId", params.agentId);
    const projectGroupId = params?.projectGroupId?.trim();
    if (projectGroupId) search.set("projectGroupId", projectGroupId);
    const qs = search.toString();
    return await this._request<PaginatedResponse<Skill>>(qs ? `/skills?${qs}` : "/skills");
  },

  async fetchCommands(this: ApiContext, trigger: string, agentId?: string) {
    const query = agentId
      ? `/commands?trigger=${trigger}&agentId=${agentId}`
      : `/commands?trigger=${trigger}`;
    return await this._request<{ items: SkillCommand[]; total: number }>(query);
  },

  async fetchSkillDetail(this: ApiContext, skillId: string, projectGroupId?: string) {
    const project = projectQuery(projectGroupId);
    return await this._request<Skill | null>(
      project ? `/skills/${skillId}?${project}` : `/skills/${skillId}`,
    );
  },

  async fetchSkillDocumentation(this: ApiContext, skillId: string, projectGroupId?: string) {
    const project = projectQuery(projectGroupId);
    return await this._request<{ content: string }>(
      project
        ? `/skills/${skillId}/documentation?${project}`
        : `/skills/${skillId}/documentation`,
    );
  },

  async scanSkills(this: ApiContext, projectGroupId?: string) {
    const project = projectQuery(projectGroupId);
    return await this._request<{ success: boolean; message: string }>(
      project ? `/skills/scan?${project}` : "/skills/scan",
      { method: "POST" },
    );
  },

  async reloadSkill(this: ApiContext, skillId: string, projectGroupId?: string) {
    const project = projectQuery(projectGroupId);
    return await this._request<Skill>(
      project ? `/skills/${skillId}/reload?${project}` : `/skills/${skillId}/reload`,
      { method: "POST" },
    );
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
      return await this._request<{ success: boolean; skillIds?: string[]; message: string }>("/skills/install", {
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

  async installSkillFromUrl(
    this: ApiContext,
    url: string,
    force: boolean = false,
    origin?: SkillOrigin,
  ) {
    return await this._request<{ success: boolean; skillIds?: string[]; message: string }>(
      "/skills/install-from-url",
      {
        method: "POST",
        data: { url, force, ...(origin ? { origin } : {}) },
      },
    );
  },

  async uninstallSkill(this: ApiContext, skillId: string, projectGroupId?: string) {
    const project = projectQuery(projectGroupId);
    return await this._request<{ success: boolean; message: string }>(
      project ? `/skills/${skillId}/uninstall?${project}` : `/skills/${skillId}/uninstall`,
      { method: "POST" },
    );
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

  async fetchSkillToggleConfig(this: ApiContext, projectGroupId?: string) {
    const project = projectQuery(projectGroupId);
    return await this._request<SkillToggleConfig>(
      project ? `/skills/project-config?${project}` : "/skills/project-config",
    );
  },

  async setSkillEnabled(
    this: ApiContext,
    skillId: string,
    enabled: boolean,
    projectGroupId?: string,
  ) {
    return await this._request<SkillToggleConfig>("/skills/project-config", {
      method: "PUT",
      data: {
        ...(projectGroupId ? { projectGroupId } : {}),
        skillId,
        // 接口用 disabled 表达：enabled=false → 禁用
        disabled: !enabled,
      },
    });
  },
};
