import { Injectable, Logger } from "@nestjs/common";
import { ModelRepository } from "../../common/database/model.repository";
import { OpenAI } from "openai";
import { createPaginatedResponse } from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { ProviderHub } from "../llm-core/provider-hub.service";

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
            return {
              ...model,
              thinkingEfforts, // 在模型级别添加 thinkingEfforts
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
            avatarUrl: this.urlService.toResourceAbsoluteUrl(metadata.avatarUrl || provider.avatarUrl),
            protocol: metadata.protocols[0], // 使用第一个协议
            description: metadata.description,
            apiKeyUrl: metadata.apiKeyUrl,
          };
        } catch (error) {
          this.logger.warn(`Failed to get metadata for provider ${provider.provider}:`, error);
          // 降级：使用数据库中的信息
        }
      }

      // 对于没有模板的供应商（如自定义），转换 URL（avatarUrl 是静态资源）
      return {
        ...provider,
        models: modelsWithThinkingEfforts,
        avatarUrl: provider.avatarUrl
          ? this.urlService.toResourceAbsoluteUrl(provider.avatarUrl)
          : null,
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
        avatarUrl: this.urlService.toResourceAbsoluteUrl(metadata.avatarUrl),
        description: metadata.description,
        apiKeyUrl: metadata.apiKeyUrl,
      };
    });
  }

  /**
   * 测试供应商连接（不保存到数据库）
   */
  async testProviderConnection(data: any) {
    const { provider, apiKey, apiUrl } = data;
    // const template = PROVIDER_TEMPLATES.find((t) => t.id === provider);

    // if (!template) {
    //   throw new Error("未知的供应商类型");
    // }

    const baseUrl = apiUrl || "";

    try {
      // 尝试创建一个临时的 OpenAI 客户端进行测试
      const client = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl,
      });

      // 尝试获取模型列表，如果能成功则说明 Key 和 URL 有效
      await client.models.list();

      return { success: true, message: "连接成功" };
    } catch (error: any) {
      this.logger.error(`Provider connection test failed: ${error.message}`);
      return {
        success: false,
        message: error.message?.includes('401') ? 'API Key 无效' : `连接失败: ${error.message}`
      };
    }
  }

  /**
   * 生成标准化的模型 ID
   * 格式: {provider}/{modelName}
   * @param providerType 供应商类型（如 deepseek, openai）
   * @param modelName 模型名称
   * @returns 标准化的模型 ID
   */
  private generateModelId(providerType: string, modelName: string): string {
    // 确保 providerType 只包含安全字符（字母、数字、下划线、连字符）
    const safeProvider = providerType.replace(/[^a-zA-Z0-9_-]/g, "-");
    // 确保 modelName 只包含安全字符（字母、数字、下划线、连字符、点号）
    const safeModel = modelName.replace(/[^a-zA-Z0-9._-]/g, "-");
    return `${safeProvider}/${safeModel}`;
  }

  /**
   * 添加新的模型提供商
   * 如果模板中定义了 models，则自动创建对应的模型记录
   * 非 custom 供应商的模型使用确定性 ID: {provider}/{modelName}
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
    if (provider && this.providerHub.hasProvider(provider)) {
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
      const createdProvider = await tx.modelProvider.create({
        data: {
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
          // 为非 custom 供应商生成确定性 ID: {provider}/{modelName}
          const modelId =
            finalProviderType !== "custom"
              ? this.generateModelId(finalProviderType, templateModel.modelName)
              : undefined; // custom 类型让 Prisma 自动生成 cuid()

          return {
            id: modelId, // 显式指定 ID（仅非 custom 类型）
            providerId: createdProvider.id,
            modelName: templateModel.modelName,
            modelType:
              templateModel.modeType || templateModel.modelType || "text",
            config: templateModel.config || {},
          };
        });

        // 使用 upsert 避免重复创建冲突
        for (const modelData of modelsData) {
          await tx.model.upsert({
            where: { id: modelData.id! },
            update: {
              // 如果已存在，更新配置信息
              modelType: modelData.modelType,
              config: modelData.config,
            },
            create: modelData,
          });
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

      // 转换 URL 后返回（avatarUrl 是静态资源）
      const result = finalDescription
        ? { ...provider, description: finalDescription }
        : provider;
      return {
        ...result,
        avatarUrl: result.avatarUrl
          ? this.urlService.toResourceAbsoluteUrl(result.avatarUrl)
          : null,
      };
    });
  }

  /**
   * 添加新模型
   */
  async addModel(data: any) {
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
      // 转换 URL 后返回（avatarUrl 是静态资源）
      return {
        ...updatedProvider,
        avatarUrl: updatedProvider.avatarUrl
          ? this.urlService.toResourceAbsoluteUrl(updatedProvider.avatarUrl)
          : null,
      };
    }

    // custom 类型可以更新所有字段
    const updatedProvider = await this.modelRepo.updateProvider(providerId, data);
    // 转换 URL 后返回（avatarUrl 是静态资源）
    return {
      ...updatedProvider,
      avatarUrl: updatedProvider.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(updatedProvider.avatarUrl)
        : null,
    };
  }

  /**
   * 从远程 API 获取可用模型列表
   */
  async getRemoteModels(providerId: string) {
    const provider = await this.modelRepo.getProviderById(providerId);

    if (!provider) {
      throw new Error("Provider not found");
    }

    try {
      // 直接使用数据库中的 apiUrl，不做任何修改
      // OpenAI SDK 会在 baseURL 后面拼接 /models 等路径

      const client = new OpenAI({
        baseURL: provider.apiUrl,
        apiKey: provider.apiKey,
      });

      this.logger.log(
        `Fetching remote models for provider ${provider.apiKey} url ${provider.apiUrl}`,
      );

      const response = await client.models.list();

      // 从供应商实例获取模型配置
      let supplierModels: any[] = [];
      try {
        if (this.providerHub.hasProvider(provider.provider)) {
          const supplier = this.providerHub.getProvider(provider.provider);
          supplierModels = supplier.getModels();
        }
      } catch (error) {
        this.logger.warn(`Failed to get models for provider ${provider.provider}:`, error);
      }

      const models = response.data.map((model: any) => {
        // 尝试从供应商模型中匹配配置
        const supplierModel = supplierModels.find(
          (m) => m.modelName === model.id,
        );

        // 如果找到匹配的模型，使用其配置；否则使用默认值
        return {
          modelName: model.id,
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

      // 返回分页格式，与其他列表接口保持一致
      return createPaginatedResponse(models, models.length);
    } catch (error) {
      this.logger.error(
        `Failed to fetch remote models for provider ${providerId}`,
        error,
      );
      throw new Error("Failed to fetch remote models");
    }
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
