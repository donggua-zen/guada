import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * Moonshot AI 专用 OpenAI 适配器
 * 继承基础 OpenAI 适配器，注入 Moonshot 特有逻辑
 */
export class MoonshotOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，将 thinkingEffort 转换为 Moonshot 的 enable_thinking 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // Moonshot 特有：将 thinkingEffort 转换为 enable_thinking（根级别）
    if (params.thinkingEffort !== undefined) {
      requestParams.enable_thinking = params.thinkingEffort !== 'off';
    }

    return requestParams;
  }
}
