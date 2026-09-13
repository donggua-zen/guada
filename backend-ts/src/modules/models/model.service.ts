import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { ProviderFileStore, ProviderFileConfig, ProviderFileModel } from "../llm-core/provider-file.store";
import { AdapterRegistry } from "../llm-core/adapter-registry.service";
import { BundledCatalogService } from "../llm-core/bundled-catalog.service";
import { findModelPreset, getAllPresets } from "../llm-core/model-preset-library";
import { createPaginatedResponse } from "../../common/types/pagination";
import type { ProviderConfig } from "../llm-core/types/provider.types";
import { parseProviderCompatPatch, parseThinkingPatch } from "./model-thinking.util";
import { suggestThinkingFormat } from "./thinking-format-suggestion";

/**
 * 供应商/模型管理面（providers/*.yaml 的 REST 视图）
 *
 * 权威数据在 ProviderFileStore（本地 YAML 文件，AI 可直接编辑）；
 * 类型静态事实（metadata/模型目录兜底）在 ProviderTypeCatalogService。
 * 运行时调用面（chat/kb）只经 store，不经本服务。
 */
@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(
    private store: ProviderFileStore,
    private adapterRegistry: AdapterRegistry,
    private bundledCatalog: BundledCatalogService,
  ) {}

  // ==================== 查询视图 ====================

  /**
   * 全部供应商实例及其模型（含 disabled 实例；isActive=false 的模型按参过滤）
   * 返回形状与原 DB 版对齐（id/provider/protocol/attributes...），前端零迁移
   */
  async getModelsAndProviders(includeInactive: boolean = false) {
    // 默认视图（模型选择器）只含启用实例；设置页传 true 看全部（含禁用）
    const providers = includeInactive
      ? this.store.listProviders()
      : this.store.listEnabledProviders();

    const items = providers.map((provider) => {
      const card = this.bundledCatalog.getType(provider.type);
      const isKnownType = this.bundledCatalog.hasType(provider.type);

      const models = this.resolveProviderModels(provider, includeInactive);

      return {
        id: provider.id,
        // custom 类型用实例名（用户自定义网关各有名字，不能被目录名覆盖）；
        // 其他已知类型沿用类型卡展示名（与原 DB 版行为一致）
        name:
          provider.type === "custom" || !isKnownType || !card
            ? provider.name
            : card.name,
        provider: provider.type,
        protocol: provider.protocol,
        apiUrl: provider.apiUrl,
        apiKey: provider.apiKey,
        avatarUrl: card?.avatarUrl,
        attributes: provider.headers ? { headers: provider.headers } : {},
        enabled: provider.enabled,
        description: card?.description,
        apiKeyUrl: card?.apiKeyUrl,
        // 实例级 compat 覆盖（原始声明；编辑弹窗回填/清除用）
        compat: provider.compat,
        models,
      };
    });

    return { items, size: items.length };
  }

  /** 模型列表：store 已完成「目录继承 + 实例覆盖 + 档位解析」合并，这里只做视图过滤 */
  private resolveProviderModels(provider: ProviderFileConfig, includeInactive: boolean) {
    const ownEntries = new Map(
      (provider.models || []).map((e) => [e.modelName, e]),
    );
    return this.store
      .resolveMergedModels(provider)
      .filter((m) => includeInactive || m.isActive !== false)
      .map((m) => {
        // 复用 store 的运行时视图（含解析后的档位菜单），不另起解析链
        const view = this.store.resolveModelView(provider, m);
        // 条目级自有声明（仅实例覆盖条目带有的字段），供编辑表单区分
        // "当前生效值来自继承"与"条目显式覆盖"——后者切回继承时需发 null 清除
        const own = ownEntries.get(m.modelName);
        return {
          id: view.id,
          providerId: provider.id,
          modelName: view.modelName,
          name: view.name,
          modelType: view.modelType,
          config: view.config,
          isFavorite: view.isFavorite,
          isActive: view.isActive,
          deleted: m.deleted === true,
          thinkingEfforts: view.thinkingEfforts,
          ...(view.thinkingEffortMap
            ? { thinkingEffortsMap: view.thinkingEffortMap }
            : {}),
          // 生效的 wire 兼容开关（format/supportsEffort 必有值）
          thinkingFormat: view.thinkingCompat.thinkingFormat,
          supportsReasoningEffort: view.thinkingCompat.supportsReasoningEffort,
          // 生效的思考能力（supportsThinking 解析值；菜单空 = 不能思考）
          supportsThinking: m.supportsThinking ?? false,
          ...(own?.thinkingEfforts !== undefined
            ? { thinkingEffortsOverride: own.thinkingEfforts }
            : {}),
          ...(own?.supportsThinking !== undefined
            ? { supportsThinkingOverride: own.supportsThinking }
            : {}),
          // 条目级 compat 覆盖（无 = 生效值来自继承链，切回继承时发 null 清除）
          ...(own?.compat ? { compatOverride: own.compat } : {}),
        };
      });
  }

  /** 供应商模板列表（bundled 类型卡全量，不过滤已添加类型——同类型可多实例） */
  getProviderTemplates() {
    return this.bundledCatalog.listTypes().map((card) => ({
      id: card.type,
      name: card.name,
      protocol: card.protocol,
      defaultApiUrl: card.defaultApiUrl,
      description: card.description,
      apiKeyUrl: card.apiKeyUrl,
      avatarUrl: card.avatarUrl,
    }));
  }

  /**
   * 按 apiUrl 推荐思考格式（仅供前端提示，用户确认后才写入 compat）。
   * 对齐 DSH detectCompat 的 URL 识别面，但不做运行时隐式探测。
   */
  getThinkingFormatSuggestion(apiUrl?: string) {
    return { suggestion: suggestThinkingFormat(apiUrl) };
  }

  /** 测试供应商连接（不落盘） */
  async testProviderConnection(data: any) {
    const { apiKey, apiUrl, attributes, protocol } = data;

    const config: ProviderConfig = {
      apiUrl: apiUrl || "",
      apiKey: apiKey,
      protocol: protocol || "openai",
      headers: attributes?.headers,
    };

    try {
      const adapter = this.adapterRegistry.getAdapter(config.protocol!);
      if (!adapter) {
        throw new Error(`Unsupported protocol: ${config.protocol}`);
      }
      return await adapter.testConnection(config);
    } catch (error: any) {
      if (error?.success !== undefined) throw error;
      this.logger.error(`Provider connection test failed: ${error.message}`);
      return {
        success: false,
        message: error.message?.includes("401") ? "API Key 无效" : `连接失败: ${error.message}`,
      };
    }
  }

  // ==================== 实例写操作（文件） ====================

  /**
   * 新建供应商实例文件
   * 内置类型：id 用 type（首个实例，兼容存量 modelId 引用），被占用时追加 -N
   * 自定义类型：短随机 id；模型从类型目录（bundled YAML 派生）种子
   */
  async addProvider(
    name: string,
    apiKey: string,
    apiUrl: string,
    provider?: string,
    protocol?: string,
    _avatarUrl?: string,
    attributes?: any,
    compat?: any,
  ) {
    const isKnownType = provider && this.bundledCatalog.hasType(provider) && provider !== "custom";
    const type = isKnownType ? provider! : "custom";

    let id: string;
    if (isKnownType) {
      id = type!;
      let suffix = 2;
      while (this.store.getProvider(id)) {
        id = `${type}-${suffix++}`;
      }
    } else {
      id = randomBytes(6).toString("hex");
    }

    const card = this.bundledCatalog.getType(type);
    const compatConfig = parseProviderCompatPatch({ compat });

    // 实例文件不复制目录模型（继承 + 覆盖语义）：models 缺省 = 完整继承类型目录，
    // 目录随应用升级自动流到该实例。用户后续的禁用/收藏/改参数写入覆盖条目。
    const config: ProviderFileConfig = {
      id,
      type,
      name: isKnownType && card ? card.name : name || id,
      enabled: true,
      protocol: protocol || card?.protocol || "openai",
      apiUrl: apiUrl || (isKnownType ? card?.defaultApiUrl : undefined),
      apiKey,
      ...(attributes?.headers && typeof attributes.headers === "object"
        ? { headers: attributes.headers }
        : {}),
      ...(compatConfig ? { compat: compatConfig } : {}),
    };

    await this.store.saveProvider(config);
    this.logger.log(`Provider instance created from file: ${id} (type=${type})`);
    return { ...(await this.viewOf(config)) };
  }

  /** 更新实例（非 custom 类型也允许改 apiUrl 等——内置实例就是普通文件） */
  async updateProvider(providerId: string, data: any) {
    const existing = this.store.getProvider(providerId);
    if (!existing) throw new Error("Provider not found");

    const patch: Partial<ProviderFileConfig> = {};
    if (typeof data.name === "string" && data.name) patch.name = data.name;
    if (typeof data.apiUrl === "string") patch.apiUrl = data.apiUrl;
    if (typeof data.apiKey === "string") patch.apiKey = data.apiKey;
    if (data.protocol && this.adapterRegistry.hasAdapter(data.protocol)) patch.protocol = data.protocol;
    if (data.compat === null) {
      // 清除实例级 compat 覆盖 → 回退类型卡声明
      patch.compat = undefined;
    } else {
      const compatPatch = parseProviderCompatPatch(data);
      if (compatPatch) patch.compat = compatPatch;
    }
    if (data.attributes && typeof data.attributes === "object") {
      patch.headers = typeof data.attributes.headers === "object" && data.attributes.headers !== null
        ? data.attributes.headers
        : undefined;
    }
    if (typeof data.enabled === "boolean") patch.enabled = data.enabled;

    await this.store.updateProvider(providerId, patch);
    return { ...(await this.viewOf(this.store.getProvider(providerId)!)) };
  }

  /** 启用/禁用供应商（替代"删除内置供应商"的语义） */
  async setProviderEnabled(providerId: string, enabled: boolean) {
    await this.store.setEnabled(providerId, enabled);
    return { id: providerId, enabled };
  }

  /**
   * 删除实例文件。
   * bundled 预置实例删除后会在下次启动补种回来——内置供应商的正确"移除"方式是禁用；
   * 自定义实例删除即消失（悬空引用语义与原设计一致）。
   */
  async deleteProvider(providerId: string) {
    const deleted = await this.store.deleteProvider(providerId);
    if (!deleted) throw new Error("Provider not found");
    return { id: providerId, deleted: true };
  }

  // ==================== 模型级操作（文件内条目） ====================

  /** 添加模型；config 为空时用 preset 库匹配填充 */
  async addModel(data: any) {
    if (!data.providerId || !data.modelName) {
      throw new Error("providerId and modelName are required");
    }

    let config = data.config;
    const isEmptyConfig =
      !config ||
      (!config.inputCapabilities?.length &&
        !config.outputCapabilities?.length &&
        !config.features?.length &&
        !config.contextWindow &&
        !config.maxOutputTokens &&
        !config.vectorDimensions);

    let modelType: string | undefined = data.modelType;
    if (isEmptyConfig && data.modelName) {
      const preset = findModelPreset(data.modelName);
      if (preset) {
        config = preset.config;
        modelType = modelType || preset.modeType;
      }
    }

    const { patch: thinkingPatch } = parseThinkingPatch(data);
    const model: ProviderFileModel = {
      modelName: data.modelName,
      modelType: modelType || "text",
      name: data.name || undefined,
      config: config || undefined,
      isFavorite: data.isFavorite === true,
      isActive: data.isActive !== false,
      ...thinkingPatch,
    };
    await this.store.addModel(data.providerId, model);
    return { id: `${data.providerId}:${data.modelName}`, ...model };
  }

  async updateModel(modelId: string, data: any) {
    const { providerId, modelName } = this.splitModelId(modelId);
    await this.store.updateModel(providerId, modelName, this.buildModelPatch(data));
    return { id: modelId };
  }

  /**
   * 请求体 → 实例条目 patch。白名单透传管理面可编辑字段，
   * thinking 声明经 parseThinkingPatch 校验（fail-loud）；
   * thinkingEfforts/thinking 的 null 值原样下发，由 store 翻译为"清除覆盖"。
   */
  private buildModelPatch(data: any): Partial<ProviderFileModel> {
    const { patch: thinkingPatch, clears } = parseThinkingPatch(data);
    const patch: any = {
      ...(typeof data.modelType === "string" ? { modelType: data.modelType } : {}),
      ...(typeof data.name === "string" ? { name: data.name } : data.name === null ? { name: null } : {}),
      ...(data.config && typeof data.config === "object" ? { config: data.config } : data.config === null ? { config: null } : {}),
      ...(data.thinkingEffortsMap && typeof data.thinkingEffortsMap === "object"
        ? { thinkingEffortsMap: data.thinkingEffortsMap }
        : {}),
      ...(typeof data.isFavorite === "boolean" ? { isFavorite: data.isFavorite } : {}),
      ...(typeof data.isActive === "boolean" ? { isActive: data.isActive } : {}),
      ...(typeof data.deleted === "boolean" ? { deleted: data.deleted } : {}),
      ...thinkingPatch,
    };
    for (const key of clears) patch[key] = null;
    return patch;
  }

  /**
   * 删除模型（删除语义翻译，继承 + 覆盖模型下的两态）：
   * - 目录继承模型（bundled 目录里有）：写 `deleted: true` 覆盖条目，
   *   目录更新不会使其复活；选择器与管理视图均不显示
   * - 用户自建模型（目录没有）：直接移除条目
   */
  async deleteModel(modelId: string) {
    const { providerId, modelName } = this.splitModelId(modelId);
    const provider = this.store.getProvider(providerId);
    if (!provider) throw new Error("Provider not found");
    const inherited = this.bundledCatalog
      .getCatalogModels(provider.type)
      .some((m) => m.modelName === modelName);

    if (inherited) {
      const existing = (provider.models || []).find(
        (m) => m.modelName === modelName,
      );
      await this.store.updateModel(providerId, modelName, {
        ...existing,
        modelName,
        deleted: true,
      } as ProviderFileModel);
    } else {
      await this.store.deleteModel(providerId, modelName);
    }
    return { id: modelId, deleted: true };
  }

  async toggleModelFavorite(modelId: string) {
    const model = this.requireModel(modelId);
    await this.store.updateModel(model.provider.id, model.modelName, {
      isFavorite: !model.isFavorite,
    });
    return { id: modelId, isFavorite: !model.isFavorite };
  }

  async toggleModelActive(modelId: string) {
    const model = this.requireModel(modelId);
    await this.store.updateModel(model.provider.id, model.modelName, {
      isActive: !model.isActive,
    });
    return { id: modelId, isActive: !model.isActive };
  }

  // ==================== 远程同步与预设 ====================

  /** 从远程 API 拉取可用模型列表（enrichment：类型目录 → preset → 通用默认） */
  async getRemoteModels(providerId: string) {
    const provider = this.store.getProvider(providerId);
    if (!provider) throw new Error("Provider not found");

    const adapter = this.adapterRegistry.getAdapter(provider.protocol);
    if (!adapter) return createPaginatedResponse([], 0);

    const remoteModels = await adapter.syncRemoteModels({
      apiUrl: provider.apiUrl || "",
      apiKey: provider.apiKey || "",
      protocol: provider.protocol,
    });

    const catalogModels = this.bundledCatalog.getCatalogModels(provider.type);
    const models = remoteModels.map((m: any) => {
      const catalogModel = catalogModels.find((sm) => sm.modelName === m.id);
      if (catalogModel) {
        return {
          modelName: m.id,
          modelType: catalogModel.modelType || "text",
          config: catalogModel.config,
        };
      }
      const preset = findModelPreset(m.id, m.owned_by);
      if (preset) {
        return { modelName: m.id, modelType: preset.modeType, config: preset.config };
      }
      return {
        modelName: m.id,
        modelType: "text" as const,
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: [],
          contextWindow: 128000,
        },
      };
    });

    return createPaginatedResponse(models, models.length);
  }

  getModelPresets() {
    return getAllPresets();
  }

  /** 解析失败的配置文件列表（AI/用户手改 YAML 出错时的可见告警面） */
  getProviderLoadErrors() {
    return this.store.listLoadErrors();
  }

  // ==================== 内部工具 ====================

  private async viewOf(provider: ProviderFileConfig) {
    const result = await this.getModelsAndProviders(true);
    return result.items.find((p: any) => p.id === provider.id);
  }

  private requireModel(modelId: string) {
    const model = this.store.findModel(modelId);
    if (!model) throw new Error("Model not found");
    return model;
  }

  private splitModelId(modelId: string): { providerId: string; modelName: string } {
    const sep = modelId.indexOf(":");
    if (sep <= 0) throw new Error(`Invalid model id: ${modelId}`);
    return { providerId: modelId.slice(0, sep), modelName: modelId.slice(sep + 1) };
  }
}

