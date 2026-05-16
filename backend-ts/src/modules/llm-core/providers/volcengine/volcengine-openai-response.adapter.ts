import { OpenAIResponseAdapter } from '../../adapters/openai-response.adapter';
import { LLMCompletionParams, LLMResponseChunk } from '../../types/llm.types';

/**
 * 火山引擎专用 OpenAI Response 适配器
 * 继承基础 OpenAI Response 适配器，注入火山引擎特有逻辑
 * 
 * 火山引擎特性：
 * - 支持标准的 reasoning.effort 参数（minimal, low, medium, high）
 * - 额外支持 thinking.type 参数（'enabled'/'disabled'）用于开关控制
 */
export class VolcEngineOpenAIResponseAdapter extends OpenAIResponseAdapter {
  // 继承父类的 protocol = 'openai-response'

  /**
   * 覆盖 buildRequestParam，添加火山引擎特有的 thinking.type 支持
   */
  protected buildRequestParam(params: any, formattedInput: any[]): any {
    const requestParams = super.buildRequestParam(params, formattedInput);

    // 火山引擎特有：根据 thinkingEffort 设置 thinking.type
    if (params.thinkingEffort !== undefined) {
      const effort = params.thinkingEffort;
      
      if (effort === 'off') {
        // off: 禁用思考
        requestParams.thinking = { type: 'disabled' };
      } else if (effort === 'on') {
        // on: 启用思考，但不传递强度值
        requestParams.thinking = { type: 'enabled' };
      }
      // 其他情况（minimal, low, medium, high）已由父类处理，添加了 reasoning.effort
    }

    return requestParams;
  }
}
