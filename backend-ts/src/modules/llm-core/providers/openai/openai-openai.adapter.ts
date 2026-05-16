import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * OpenAI 专用 OpenAI 适配器（标准 Chat Completions API）
 * 继承基础 OpenAI 适配器，注入 OpenAI 特有逻辑
 */
export class OpenAIOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，将 thinkingEffort 转换为 OpenAI 的 reasoning_effort 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // OpenAI 特有：将 thinkingEffort 转换为 reasoning_effort（根级别）
    if (params.thinkingEffort !== undefined) {
      const effort = params.thinkingEffort;
      
      // OpenAI o 系列和 GPT-5 只支持强度值，不支持 'off' 或 'on'
      // 如果传入无效值，使用默认值 medium
      if (['low', 'medium', 'high'].includes(effort)) {
        requestParams.reasoning_effort = effort;
      } else {
        requestParams.reasoning_effort = 'medium';
      }
    }

    return requestParams;
  }
}
