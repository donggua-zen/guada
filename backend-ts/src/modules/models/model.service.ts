import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { ModelRepository } from "../../common/database/model.repository";
import { createPaginatedResponse } from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { ProviderHub } from "../llm-core/provider-hub.service";
import type { ProviderConfig } from "../llm-core/types/provider.types";

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(
    private modelRepo: ModelRepository,
    private urlService: UrlService,
    private providerHub: ProviderHub,
  ) { }

  /**
   * 获取所有模型提供商及其关联的模型（全局共享）
   * 默认只返回启用的模型（isActive = true）
   */
  async getModelsAndProviders(includeInactive: boolean = false) {
    const providers = await this.modelRepo.getProvidersWithModels();

    // 动态合并模板 attributes
    const mergedProviders = providers.map((provider) => {
      // 过滤模型：根据 includeInactive 参数决定是否包含禁用的模型
      const filteredModels = includeInactive
        ? provider.models
        : provider.models.filter(model => model.isActive !== false);

      // 为每个模型添加 thinkingEfforts（从供应商获取）
      const modelsWithThinkingEfforts = filteredModels.map((model: any) => {
        // 只有支持 thinking 功能的模型才需要获取 thinkingEfforts
        if (model.config?.features?.includes('thinking')) {
          try {
            // 通过 ProviderHub 获取供应商实例
            const supplier = this.providerHub.getProvider(provider.provider);
            // 调用供应商的 getModelThinkingEfforts 方法
            const thinkingEfforts = supplier.getModelThinkingEfforts(model.modelName);
            // Anthropic adaptive thinking 不支持 'none'，自动过滤
            const isAnthropic = provider.protocol === 'anthropic';
            const filtered = isAnthropic
              ? thinkingEfforts.filter((e: string) => e !== 'none')
              : thinkingEfforts;
            return {
              ...model,
              thinkingEfforts: filtered, // 在模型级别添加 thinkingEfforts
            };
          } catch (error) {
            this.logger.warn(`Failed to get thinking efforts for model ${model.modelName}:`, error);
            return {
              ...model,
              thinkingEfforts: [], // 失败时返回空数组
            };
          }
        }
        // 不支持 thinking 的模型，thinkingEfforts 为空
        return {
          ...model,
          thinkingEfforts: [],
        };
      });

      // 从供应商实例获取元数据
      if (provider.provider) {
        try {
          const supplier = this.providerHub.getProvider(provider.provider);
          const metadata = supplier.getMetadata();

          return {
            ...provider,
            models: modelsWithThinkingEfforts,
            name: provider.provider == 'custom' ? provider.name : metadata.name,
            // 非 custom 供应商使用协议的第一个协议，custom 供应商使用数据库中存储的实际协议
            protocol: provider.provider === 'custom' ? (provider.protocol || metadata.protocols[0]) : metadata.protocols[0],
            description: metadata.description,
            apiKeyUrl: metadata.apiKeyUrl,
          };
        } catch (error) {
          this.logger.warn(`Failed to get metadata for provider ${provider.provider}:`, error);
          // 降级：使用数据库中的信息
        }
      }

      // 对于没有模板的供应商（如自定义），直接返回
      return {
        ...provider,
        models: modelsWithThinkingEfforts,
      };
    });

    // 返回分页响应格式
    return {
      items: mergedProviders,
      size: mergedProviders.length,
    };
  }

  /**
   * 获取所有模型提供商及其关联的模型（包含禁用的模型）
   * 专用于模型设置页面
   */
  async getAllModelsAndProviders() {
    return this.getModelsAndProviders(true);
  }

  /**
   * 获取可用的供应商列表（从 ProviderHub 获取）
   */
  getProviderTemplates() {
    const providers = this.providerHub.getAllProviders();
    return providers.map((provider) => {
      const metadata = provider.getMetadata();
      return {
        id: metadata.id,
        name: metadata.name,
        protocol: metadata.protocols[0],
        defaultApiUrl: metadata.defaultApiUrl,
        description: metadata.description,
        apiKeyUrl: metadata.apiKeyUrl,
      };
    });
  }

  /**
   * 测试供应商连接（不保存到数据库）
   */
  async testProviderConnection(data: any) {
    const { provider, apiKey, apiUrl, attributes, protocol } = data;

    const baseUrl = apiUrl || "";
    const config: ProviderConfig = {
      apiUrl: baseUrl,
      apiKey: apiKey,
      protocol: protocol || 'openai',
      headers: attributes?.headers,
    };

    try {
      // 通过 ProviderHub 获取供应商 → 适配器 → 测试连接
      if (this.providerHub.hasProvider(config.protocol)) {
        const supplier = this.providerHub.getProvider(config.protocol);
        const adapter = supplier.getAdapter(config.protocol);
        if (adapter) {
          return await adapter.testConnection(config);
        }
      }

      // 对于 "custom" 类型，按协议找到适配器
      const suppliersByProtocol = this.providerHub.getProvidersByProtocol(config.protocol);
      for (const sup of suppliersByProtocol) {
        const adapter = sup.getAdapter(config.protocol);
        if (adapter) {
          return await adapter.testConnection(config);
        }
      }

      throw new Error(`Unsupported protocol: ${config.protocol}`);
    } catch (error: any) {
      // 适配器抛出的错误已处理为 ConnectionTestResult，直接抛出
      if (error.success !== undefined) throw error;
      this.logger.error(`Provider connection test failed: ${error.message}`);
      return {
        success: false,
        message: error.message?.includes('401') ? 'API Key 无效' : `连接失败: ${error.message}`
      };
    }
  }

  /**
   * 添加新的模型提供商
   * 如果模板中定义了 models，则自动创建对应的模型记录
   */
  async addProvider(
    name: string,
    apiKey: string,
    apiUrl: string,
    provider?: string,
    protocol?: string,
    avatarUrl?: string,
    attributes?: any,
  ) {
    let finalName = name;
    let finalApiUrl = apiUrl;
    let finalProtocol = protocol;
    let finalAvatarUrl = avatarUrl;
    let finalAttributes = attributes;
    let finalProviderType = provider;
    let templateModels: any[] | undefined;
    let finalDescription = undefined;

    // 从供应商实例获取元数据
    // 注意：custom 也是已注册的供应商，所以必须显式判断 provider !== 'custom'
    if (provider && provider !== 'custom' && this.providerHub.hasProvider(provider)) {
      try {
        const supplier = this.providerHub.getProvider(provider);
        const metadata = supplier.getMetadata();

        finalName = metadata.name;
        finalApiUrl = metadata.defaultApiUrl;
        finalProtocol = metadata.protocols[0];
        finalAvatarUrl = metadata.avatarUrl;
        finalDescription = metadata.description;
        finalAttributes = undefined; // 预定义供应商不存储 attributes，运行时动态查询
        finalProviderType = provider;
        templateModels = supplier.getModels(); // 从供应商获取模型定义
      } catch (error) {
        this.logger.warn(`Failed to get metadata for provider ${provider}:`, error);
      }
    } else {
      // 自定义供应商，providerType 为 'custom'
      finalProviderType = "custom";
    }

    // 使用事务确保供应商和模型的原子性创建
    return this.modelRepo.getPrismaClient().$transaction(async (tx) => {
      // 1. 创建供应商
      // 预置供应商使用 providerType 作为 ID（如 "openai"），自定义供应商使用短 ID
      const providerId =
        finalProviderType !== "custom"
          ? finalProviderType
          : randomBytes(6).toString("hex");

      const createdProvider = await tx.modelProvider.create({
        data: {
          id: providerId,
          userId: "global",
          name: finalName,
          provider: finalProviderType,
          protocol: finalProtocol,
          apiKey,
          apiUrl: finalApiUrl,
          avatarUrl: finalAvatarUrl,
          attributes: finalAttributes,
        },
      });

      // 2. 如果模板中有预定义模型，批量创建
      if (templateModels && templateModels.length > 0) {
        const modelsData = templateModels.map((templateModel) => {
          return {
            id: `${providerId}:${templateModel.modelName}`,
            providerId: createdProvider.id,
            modelName: templateModel.modelName,
            modelType:
              templateModel.modeType || templateModel.modelType || "text",
            config: templateModel.config || {},
          };
        });

        for (const modelData of modelsData) {
          await tx.model.create({ data: modelData });
        }

        this.logger.log(
          `Created ${modelsData.length} models for provider ${createdProvider.id}`,
        );
      }

      // 3. 返回创建的供应商（包含模型列表）
      let provider = await tx.modelProvider.findUnique({
        where: { id: createdProvider.id },
        include: { models: true },
      });

      const result = finalDescription
        ? { ...provider, description: finalDescription }
        : provider;
      return result;
    });
  }

  /**
   * 添加新模型
   */
  async addModel(data: any) {
    if (data.providerId && data.modelName) {
      data.id = `${data.providerId}:${data.modelName}`;
    }
    return this.modelRepo.createModel(data);
  }

  /**
   * 更新模型信息
   */
  async updateModel(modelId: string, data: any) {
    const model = await this.modelRepo.findById(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    return this.modelRepo.updateModel(modelId, data);
  }

  /**
   * 删除模型
   */
  async deleteModel(modelId: string) {
    const model = await this.modelRepo.findById(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    return this.modelRepo.deleteModel(modelId);
  }

  /**
   * 删除提供商（级联删除其下所有模型）
   */
  async deleteProvider(providerId: string) {
    const provider = await this.modelRepo.getProviderById(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    return this.modelRepo.deleteProvider(providerId);
  }

  /**
   * 更新提供商
   */
  async updateProvider(providerId: string, data: any) {
    const provider = await this.modelRepo.getProviderById(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    // 如果不是 custom 类型，禁止修改 name、apiUrl、protocol
    if (provider.provider !== "custom") {
      const { name, apiUrl, protocol, ...allowedData } = data;
      // 只允许更新 apiKey 等其他字段
      const updatedProvider = await this.modelRepo.updateProvider(providerId, allowedData);
      return { ...updatedProvider };
    }

    // custom 类型可以更新所有字段
    const updatedProvider = await this.modelRepo.updateProvider(providerId, data);
    return { ...updatedProvider };
  }

  /**
   * 从远程 API 获取可用模型列表
   */
  async getRemoteModels(providerId: string) {
    const provider = await this.modelRepo.getProviderById(providerId);

    if (!provider) {
      throw new Error("Provider not found");
    }

    const protocol = provider.protocol || 'openai';
    const config: ProviderConfig = {
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      protocol,
    };

    // 通过 ProviderHub 获取供应商 → 适配器 → 同步模型列表
    const supplier = this.providerHub.getProvider(provider.provider);
    const adapter = supplier.getAdapter(protocol);
    if (!adapter) {
      return createPaginatedResponse([], 0);
    }

    const remoteModels = await adapter.syncRemoteModels(config);

    // 获取供应商的默认模型配置用于 enrichment
    let supplierModels: any[] = [];
    try {
      supplierModels = supplier.getModels();
    } catch { /* ignore */ }

    const models = remoteModels.map((m: any) => {
      const supplierModel = supplierModels.find(
        (sm) => sm.modelName === m.id,
      );
      return {
        modelName: m.id,
        modelType:
          supplierModel?.modeType || supplierModel?.modelType || "text",
        config: supplierModel?.config || {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: [],
          contextWindow: 128000,
        },
      };
    });

    return createPaginatedResponse(models, models.length);
  }

  /**
   * 切换模型收藏状态
   */
  async toggleModelFavorite(modelId: string) {
    const model = await this.modelRepo.findById(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    const newFavoriteStatus = !model.isFavorite;
    return this.modelRepo.toggleFavorite(modelId, newFavoriteStatus);
  }

  /**
   * 切换模型启用状态
   */
  async toggleModelActive(modelId: string) {
    const model = await this.modelRepo.findById(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    const newActiveStatus = !model.isActive;
    return this.modelRepo.toggleActive(modelId, newActiveStatus);
  }
}
