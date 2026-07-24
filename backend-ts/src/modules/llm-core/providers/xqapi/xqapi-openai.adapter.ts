import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * XQAPI 专用 OpenAI 适配器
 * 继承基础 OpenAI 适配器，注入 XQAPI 特有逻辑
 */
export class XQApiOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，将 thinkingEffort 转换为 reasoning_effort 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // XQAPI 特有：将 thinkingEffort 转换为 reasoning_effort（根级别）
    if (params.thinkingEffort !== undefined) {
      const effort = params.thinkingEffort;

      if (effort === 'none') {
        // none: 不设置 reasoning_effort，让模型使用默认行为（不推理）
      } else if (['low', 'medium', 'high'].includes(effort)) {
        requestParams.reasoning_effort = effort;
      }
    }

    return requestParams;
  }
}
