import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createTextModel, createMultimodalModel, ConfigFragments } from '../../utils/model-config.helper';
import { VolcEngineOpenAIAdapter } from './volcengine-openai.adapter';
import { VolcEngineOpenAIResponseAdapter } from './volcengine-openai-response.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * 火山引擎供应商实现
 * 字节跳动旗下云平台，提供豆包大模型及企业级 AI 解决方案
 */
@Injectable()
export class VolcEngineProvider implements IModelProvider {
	readonly id = 'volcengine';
	readonly name = '火山引擎';
	readonly protocols = ['openai-response', 'openai'];
	readonly defaultApiUrl = 'https://ark.cn-beijing.volces.com/api/v3/';

	// 内部持有火山引擎专用的适配器实例
	private openaiAdapter: VolcEngineOpenAIAdapter;
	private responseAdapter: VolcEngineOpenAIResponseAdapter;

	constructor() {
		this.openaiAdapter = new VolcEngineOpenAIAdapter();
		this.responseAdapter = new VolcEngineOpenAIResponseAdapter();
	}

	/**
	 * 获取指定协议的适配器
	 */
	getAdapter(protocol: string): IProtocolAdapter | null {
		if (protocol === 'openai') {
			return this.openaiAdapter;
		}
		if (protocol === 'openai-response') {
			// 火山引擎的 openai-response 使用专用的 Response 适配器（包含 thinking 处理）
			return this.responseAdapter;
		}
		return null;
	}

	// 豆包 Seed 系列模型支持多级强度（包含 'off'）
	private seedThinkingEfforts: string[] = ['off', 'minimal', 'low', 'medium', 'high'];

	// 其他豆包模型只支持开关模式
	private simpleThinkingEfforts: string[] = ['off', 'on'];

	private models: ModelDefinition[] = [
		createMultimodalModel(
			'doubao-seed-1.8',
			ConfigFragments.ContextWindow._256K
		),
		createMultimodalModel(
			'doubao-seed-1.6-flash',
			ConfigFragments.ContextWindow._256K
		),
		createMultimodalModel(
			'doubao-seed-1.6',
			ConfigFragments.ContextWindow._256K
		),
		createTextModel(
			'doubao-pro-250820',
			ConfigFragments.ContextWindow._128K
		),
	];

	/**
	 * 获取供应商元数据
	 */
	getMetadata(): ProviderMetadata {
		return {
			id: this.id,
			name: this.name,
			description: '字节跳动旗下云平台，提供豆包大模型及企业级 AI 解决方案。',
			avatarUrl: 'static/images/providers/volcengine.svg',
			apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
			protocols: this.protocols,
			defaultApiUrl: this.defaultApiUrl,
		};
	}

	/**
	 * 获取该供应商支持的模型列表
	 */
	getModels(options?: ModelFilterOptions): ModelDefinition[] {
		if (!options) return this.models;

		return this.models.filter(model => {
			if (options.modeType && model.modeType !== options.modeType) {
				return false;
			}
			if (options.feature && !model.config.features.includes(options.feature)) {
				return false;
			}
			return true;
		});
	}

	/**
	 * 获取指定模型的思考强度选项
	 * 豆包 Seed 系列模型支持多级强度，其他模型只支持开关模式
	 */
	getModelThinkingEfforts(modelName: string): string[] {
		const lowerName = modelName.toLowerCase();

		// Embedding 模型不支持思考
		if (lowerName.includes('embedding') || lowerName.includes('embed')) {
			return [];
		}

		// doubao-seed 开头的模型支持多级强度
		if (lowerName.startsWith('doubao-seed')) {
			return this.seedThinkingEfforts;
		}

		// 其他豆包模型只支持开关模式
		return this.simpleThinkingEfforts;
	}
}
