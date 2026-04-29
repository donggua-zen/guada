import { Injectable, Logger } from "@nestjs/common";
import { ModelRepository } from "../../common/database/model.repository";
import { OpenAI } from "openai";
import { createPaginatedResponse } from "../../common/types/pagination";
import { PROVIDER_TEMPLATES, transformProviderTemplateUrls } from "../../constants/provider-templates";
import { UrlService } from "../../common/services/url.service";

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(
    private modelRepo: ModelRepository,
    private urlService: UrlService,
  ) { }

  /**
   * 获取所有模型提供商及其关联的模型（全局共享）
   */
  async getModelsAndProviders() {
    const providers = await this.modelRepo.getProvidersWithModels();

    // 动态合并模板 attributes
    const mergedProviders = providers.map((provider) => {
      if (provider.provider && provider.provider !== "custom") {
        const template = PROVIDER_TEMPLATES.find(
          (t) => t.id === provider.provider,
        );
        if (template) {
          return {
            ...provider,
            attributes: template.attributes, // 实时从文件获取
            name: template.name, // 确保名称同步
            avatarUrl: this.urlService.toResourceAbsoluteUrl(template.avatarUrl || provider.avatarUrl),
            protocol: template.protocol,
            description: template.description,
          };
        }
      }
      // 对于自定义 provider，转换 URL（avatarUrl 是静态资源）
      return {
        ...provider,
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
   * 获取可用的供应商模板列表
   */
  getProviderTemplates() {
    // 使用 UrlService 转换所有模板的 avatarUrl
    return PROVIDER_TEMPLATES.map((template) => ({
      ...template,
      avatarUrl: this.urlService.toResourceAbsoluteUrl(template.avatarUrl),
    }));
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

    const template = provider
      ? PROVIDER_TEMPLATES.find((t) => t.id === provider)
      : undefined;

    if (template) {
      finalName = template.name;
      finalApiUrl = template.defaultApiUrl;
      finalProtocol = template.protocol;
      finalAvatarUrl = template.avatarUrl;
      finalDescription = template.description;
      finalAttributes = undefined; // 预定义供应商不存储 attributes，运行时动态查询
      finalProviderType = provider;
      templateModels = template.models; // 保存模板中的模型定义
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
        const modelsData = templateModels.map((templateModel) => ({
          providerId: createdProvider.id,
          modelName: templateModel.modelName,
          modelType:
            templateModel.modeType || templateModel.modelType || "text",
          config: templateModel.config || {},
        }));

        await this.modelRepo.createModelsInTransaction(tx, modelsData);
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

      // 查找对应的供应商模板
      const template = PROVIDER_TEMPLATES.find(
        (t) => t.id === provider.provider,
      );

      const models = response.data.map((model: any) => {
        // 尝试从模板中匹配模型配置
        const templateModel = template?.models?.find(
          (m) => m.modelName === model.id,
        );

        // 如果找到匹配的模板模型，使用其配置；否则使用默认值
        return {
          modelName: model.id,
          modelType:
            templateModel?.modeType || templateModel?.modelType || "text",
          config: templateModel?.config || {
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
}
