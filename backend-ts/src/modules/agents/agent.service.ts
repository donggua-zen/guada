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
    const agent = await this.agentStore.findById(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    return this.agentStore.delete(agentId);
  }

  /**
   * 上传并处理智能体头像（写入智能体目录内的 `avatar.png`）
   *
   * 头像随智能体目录存亡：删除智能体即随目录进回收站，不产生孤儿文件。
   */
  async uploadAvatar(agentId: string, file: any) {
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
