import { BadRequestException, Injectable } from "@nestjs/common";
import * as crypto from "crypto";
import sharp from "sharp";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { assertResolvableModelRef } from "../llm-core/utils/model-reference.util";
import { AgentFileStore } from "./agent-file.store";
import {
  DEFAULT_AGENT_ID,
  isValidAgentId,
  parseAgentMarkdown,
} from "./agent-file.mapper";
import { isPluginAgentId, PLUGIN_AGENT_ID_PREFIX } from "../plugins/registry/plugin-agent.registry";

/**
 * 智能体/智能体服务（文件权威）
 *
 * 定义存于 `<AGENTS_DATA_DIR>/<id>/AGENT.md`，头像存于同目录内，
 * 删除时整目录进回收站，因此不存在孤儿头像。
 */
@Injectable()
export class AgentService {
  private readonly ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  constructor(
    private agentStore: AgentFileStore,
    private urlService: UrlService,
    private settingsStorage: SettingsStorage,
    private modelStore: ProviderFileStore,
  ) {}

  // --- Agent Management ---

  async getAgents(
    skip: number = 0,
    limit: number = 20,
  ): Promise<PaginatedResponse<any>> {
    const allAgents = await this.agentStore.listAgents();
    const items = allAgents.slice(skip, skip + limit);
    const total = allAgents.length;
    return createPaginatedResponse(
      items.map((item) => this.withAbsoluteAvatar(item)),
      total,
      { skip, limit },
    );
  }

  async getAgentById(agentId: string) {
    const agent = await this.agentStore.findById(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    return this.withAbsoluteAvatar(agent);
  }

  async createAgent(data: any) {
    const name = this.readName(data);
    assertResolvableModelRef(this.modelStore, data.modelId, "modelId");

    // 显式 id（前端「标识符」字段）在 HTTP 边界先校验并抛 400：
    // store 层虽会再校验一次，但它抛的是普通 Error → 会被 Nest 兜成 500，
    // 前端只能看到「未知错误」，丢失「id 不合法」这个可操作信息。
    const explicitId = typeof data.id === "string" ? data.id.trim() : "";
    if (explicitId && !isValidAgentId(explicitId)) {
      throw new BadRequestException(
        `非法智能体 id「${explicitId}」：只允许小写字母、数字与连字符，且以字母或数字开头（^[a-z0-9][a-z0-9-]*$）`,
      );
    }
    // v4：保留前缀 plugin- 归插件注册的智能体，用户创建的智能体不落其上
    if (explicitId && isPluginAgentId(explicitId)) {
      throw new BadRequestException(
        `智能体 id 前缀「${PLUGIN_AGENT_ID_PREFIX}」为插件注册智能体保留，不能使用`,
      );
    }

    const agent = await this.agentStore.create({
      // 留空则由 store 生成 `agent-<uuid v4>`；不传 undefined 以免覆盖该兜底
      id: explicitId || undefined,
      name,
      description: data.description ?? null,
      modelId: data.modelId ?? null,
      settings: data.settings ?? null,
    });

    return this.withAbsoluteAvatar(agent);
  }

  async updateAgent(agentId: string, data: any) {
    // v4.1：插件注册的智能体走用户覆盖层——提示词/工具绑定由插件代码权威
    // （settings 中的 systemPrompt/__pluginAgent 剔除，运行时另有常开豁免兜底），
    // 名称/描述/模型及其余 settings 正常编辑，落 agent-overrides 而非 AGENT.md
    if (isPluginAgentId(agentId)) {
      return this.updatePluginAgentOverride(agentId, data);
    }
    const existing = await this.agentStore.findById(agentId);
    if (!existing) {
      throw new Error("Agent not found");
    }
    // id 创建后不可修改：id 即目录名，改名会断 session/bot/task 的全部引用。
    // 请求体携带 id 时，与路径 id 不一致即拒绝；一致则视为冗余字段忽略。
    if (data.id !== undefined && data.id !== agentId) {
      throw new BadRequestException("智能体 id 创建后不可修改");
    }
    assertResolvableModelRef(this.modelStore, data.modelId, "modelId");

    const patch: Record<string, any> = {};
    const name = data.name ?? data.title;
    if (name !== undefined) patch.name = this.readName({ name });
    if (data.description !== undefined) patch.description = data.description;
    if (data.modelId !== undefined) patch.modelId = data.modelId;
    if (data.settings !== undefined) patch.settings = data.settings;

    const updated = await this.agentStore.update(agentId, patch);
    if (!updated) {
      throw new Error("Agent not found");
    }
    return this.withAbsoluteAvatar(updated);
  }

  async deleteAgent(agentId: string) {
    // 内置默认智能体不可删除：保证任何环境始终有可用的默认助手
    // （store.delete 另有防御性拦截，此处先行抛 400 让前端可提示）
    if (agentId === DEFAULT_AGENT_ID) {
      throw new BadRequestException("内置默认智能体不可删除");
    }
    // v4：插件注册的智能体随插件卸载/禁用消失，不走删除流程
    if (isPluginAgentId(agentId)) {
      throw new BadRequestException(
        `插件注册的智能体「${agentId}」不可删除（禁用或卸载来源插件即可移除）`,
      );
    }
    const agent = await this.agentStore.findById(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    return this.agentStore.delete(agentId);
  }

  /**
   * v4.1：插件智能体的用户覆盖更新（PUT /agents/:id 的分流目标）。
   *
   * 字段白名单：name/description/modelId + settings（剔除锁定键）。
   * 锁定键（systemPrompt/__pluginAgent）静默丢弃而非报错——前端锁定 UI 下
   * 正常保存路径不会携带它们，携带即视为绕过尝试，丢弃即可。
   */
  private async updatePluginAgentOverride(agentId: string, data: any) {
    if (!this.agentStore.findById(agentId)) {
      // 虚拟智能体可能被插件禁用/卸载：覆盖层仍允许写入（重装恢复），
      // 但完全不存在的 id（从未注册过的插件）拒绝，防拼写错误静默积存
      const { PluginAgentRegistry } = await import(
        "../plugins/registry/plugin-agent.registry"
      );
      if (!PluginAgentRegistry.hasAny(agentId)) {
        throw new BadRequestException(`智能体不存在`);
      }
    }
    const overrideSettings: Record<string, any> | undefined =
      data.settings !== undefined && data.settings !== null
        ? Object.fromEntries(
            Object.entries(data.settings).filter(
              ([k]) =>
                k !== "systemPrompt" &&
                k !== "__pluginAgent",
            ),
          )
        : undefined;

    if (data.modelId) {
      assertResolvableModelRef(this.modelStore, data.modelId, "modelId");
    }

    await this.agentStore.updateOverride(agentId, {
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        data.description !== undefined ? data.description : undefined,
      modelId: data.modelId !== undefined ? data.modelId : undefined,
      settings: overrideSettings,
    });

    const agent = await this.agentStore.findById(agentId);
    if (!agent) {
      // 插件当前禁用：写入成功但暂不可见，返回占位避免前端报错
      return { id: agentId, pluginId: agentId.split("-")[1] ?? null, hidden: true };
    }
    return this.withAbsoluteAvatar(agent);
  }

  /**
   * 上传并处理智能体头像（写入智能体目录内的 `avatar.png`）
   *
   * 头像随智能体目录存亡：删除智能体即随目录进回收站，不产生孤儿文件。
   */
  async uploadAvatar(agentId: string, file: any) {
    // v4：插件智能体头像由插件资源提供，不可上传覆盖
    if (isPluginAgentId(agentId)) {
      throw new BadRequestException(
        `插件注册的智能体「${agentId}」不可上传头像（由来源插件管理）`,
      );
    }
    const agent = await this.agentStore.findById(agentId);
    if (!agent) {
      throw new Error("智能体不存在");
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

    const storagePath = await this.agentStore.saveAvatar(
      agentId,
      buffer,
      "png",
    );
    if (!storagePath) {
      throw new Error("头像写入失败");
    }

    return { url: this.urlService.toResourceAbsoluteUrl(storagePath) };
  }

  /**
   * 从 .md 文件导入智能体
   * 文件格式: YAML frontmatter (name, description, settings) + Markdown body (systemPrompt)
   */
  async importAgents(files: { content: string; filename: string }[]) {
    const results: {
      filename: string;
      status: "ok" | "invalid";
      agentId?: string;
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

        const agent = await this.agentStore.create({
          name: parsed.name,
          description: parsed.description ?? null,
          modelId: parsed.model ?? null,
          settings: parsed.settings,
        });

        results.push({
          filename: file.filename,
          status: "ok",
          agentId: agent.id,
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
      throw new Error("智能体名称不能为空");
    }
    return name.trim();
  }

  private withAbsoluteAvatar(agent: any) {
    return {
      ...agent,
      avatarUrl: agent.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(agent.avatarUrl)
        : null,
    };
  }
}
