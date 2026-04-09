import { Injectable, Logger } from '@nestjs/common';
import { ModelRepository } from '../../common/database/model.repository';
import { UserRepository } from '../../common/database/user.repository';
import { OpenAI } from 'openai';
import { createPaginatedResponse } from '../../common/types/pagination';
import { PROVIDER_TEMPLATES } from '../../constants/provider-templates';

@Injectable()
export class ModelService {
    private readonly logger = new Logger(ModelService.name);

    constructor(
        private modelRepo: ModelRepository,
        private userRepo: UserRepository,
    ) { }

    /**
     * 获取当前用户的所有模型提供商及其关联的模型
     * 支持子账户：子账户使用父账户的模型
     */
    async getModelsAndProviders(userId: string) {
        // 获取用户信息，判断是否是子账户
        const user = await this.userRepo.findById(userId);

        // 如果是子账户（role != "primary"），使用父账户 ID
        const effectiveUserId = user?.role === 'primary' ? userId : (user?.parentId || userId);

        const providers = await this.modelRepo.getProvidersWithModels(effectiveUserId);

        // 动态合并模板 attributes
        const mergedProviders = providers.map(provider => {
            if (provider.provider && provider.provider !== 'custom') {
                const template = PROVIDER_TEMPLATES.find(t => t.id === provider.provider);
                if (template) {
                    return {
                        ...provider,
                        attributes: template.attributes, // 实时从文件获取
                        name: template.name, // 确保名称同步
                        avatarUrl: template.avatarUrl,
                        protocol: template.protocol,
                    };
                }
            }
            return provider;
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
        return PROVIDER_TEMPLATES;
    }

    /**
     * 添加新的模型提供商
     */
    async addProvider(userId: string, name: string, apiKey: string, apiUrl: string, provider?: string, protocol?: string, avatarUrl?: string, attributes?: any) {
        let finalName = name;
        let finalApiUrl = apiUrl;
        let finalProtocol = protocol;
        let finalAvatarUrl = avatarUrl;
        let finalAttributes = attributes;
        let finalProviderType = provider;

        const template = provider ? PROVIDER_TEMPLATES.find(t => t.id === provider) : undefined;

        if (template) {
            finalName = template.name;
            finalApiUrl = template.defaultApiUrl;
            finalProtocol = template.protocol;
            finalAvatarUrl = template.avatarUrl;
            finalAttributes = undefined; // 预定义供应商不存储 attributes，运行时动态查询
            finalProviderType = provider;
        } else {
            // 自定义供应商，providerType 为 'custom'
            finalProviderType = 'custom';
        }

        return this.modelRepo.createProvider({
            userId,
            name: finalName,
            provider: finalProviderType,  // 使用 providerType 作为供应商标识符
            protocol: finalProtocol,
            apiKey,
            apiUrl: finalApiUrl,
            avatarUrl: finalAvatarUrl,
            attributes: finalAttributes,
        });
    }

    /**
     * 添加新模型
     */
    async addModel(data: any, userId: string) {
        // 验证 provider 是否属于当前用户
        const provider = await this.modelRepo.getProviderById(data.providerId);
        if (!provider || provider.userId !== userId) {
            throw new Error('Provider not found or unauthorized');
        }

        return this.modelRepo.createModel(data);
    }

    /**
     * 更新模型信息
     */
    async updateModel(modelId: string, data: any, userId: string) {
        // 验证模型是否属于当前用户
        const model = await this.modelRepo.findById(modelId);
        if (!model) {
            throw new Error('Model not found');
        }

        const provider = await this.modelRepo.getProviderById(model.providerId);
        if (!provider || provider.userId !== userId) {
            throw new Error('Unauthorized');
        }

        return this.modelRepo.updateModel(modelId, data);
    }

    /**
     * 删除模型
     */
    async deleteModel(modelId: string, userId: string) {
        // 验证模型是否属于当前用户
        const model = await this.modelRepo.findById(modelId);
        if (!model) {
            throw new Error('Model not found');
        }

        const provider = await this.modelRepo.getProviderById(model.providerId);
        if (!provider || provider.userId !== userId) {
            throw new Error('Unauthorized');
        }

        return this.modelRepo.deleteModel(modelId);
    }

    /**
     * 删除提供商（级联删除其下所有模型）
     */
    async deleteProvider(providerId: string, userId: string) {
        // 验证提供商是否属于当前用户
        const provider = await this.modelRepo.getProviderById(providerId);
        if (!provider || provider.userId !== userId) {
            throw new Error('Provider not found or unauthorized');
        }

        return this.modelRepo.deleteProvider(providerId);
    }

    /**
     * 更新提供商
     */
    async updateProvider(providerId: string, data: any, userId: string) {
        // 验证提供商是否属于当前用户
        const provider = await this.modelRepo.getProviderById(providerId);
        if (!provider || provider.userId !== userId) {
            throw new Error('Provider not found or unauthorized');
        }

        // 如果不是 custom 类型，禁止修改 name、apiUrl、protocol
        if (provider.provider !== 'custom') {
            const { name, apiUrl, protocol, ...allowedData } = data;
            // 只允许更新 apiKey 等其他字段
            return this.modelRepo.updateProvider(providerId, allowedData);
        }

        // custom 类型可以更新所有字段
        return this.modelRepo.updateProvider(providerId, data);
    }

    /**
     * 从远程 API 获取可用模型列表
     */
    async getRemoteModels(userId: string, providerId: string) {
        const provider = await this.modelRepo.getProviderById(providerId);

        if (!provider || provider.userId !== userId) {
            throw new Error('Provider not found or unauthorized');
        }

        try {
            // 直接使用数据库中的 apiUrl，不做任何修改
            // OpenAI SDK 会在 baseURL 后面拼接 /models 等路径
            const client = new OpenAI({
                apiKey: provider.apiKey,
                baseURL: provider.apiUrl,
            });

            const response = await client.models.list();

            const models = response.data.map((model: any) => ({
                modelName: model.id,
                modelType: 'text',
                features: [],
            }));

            // 返回分页格式，与其他列表接口保持一致
            return createPaginatedResponse(models, models.length);
        } catch (error) {
            this.logger.error(`Failed to fetch remote models for provider ${providerId}`, error);
            throw new Error('Failed to fetch remote models');
        }
    }
}
