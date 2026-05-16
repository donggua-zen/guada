import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * DeepSeek 专用 OpenAI 适配器
 * 继承基础 OpenAI 适配器，注入 DeepSeek 特有逻辑
 */
export class DeepSeekOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，将 thinkingEffort 转换为 DeepSeek 的 reasoning_effort 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // DeepSeek 特有：将 thinkingEffort 转换为 reasoning_effort（根级别）
    if (params.thinkingEffort !== undefined) {
      const effort = params.thinkingEffort;
      
      if (effort === 'off') {
        // off: 禁用思考
        requestParams.reasoning_effort = undefined;
        requestParams.thinking = { type: 'disabled' };
      } else if (effort === 'on') {
        // on: 启用思考，但不传递强度值
        requestParams.reasoning_effort = undefined;
        requestParams.thinking = { type: 'enabled' };
      } else {
        // 强度值：high, max
        // 设置 reasoning_effort 即隐含启用思考
        requestParams.reasoning_effort = effort;
      }
    }

    return requestParams;
  }
}
