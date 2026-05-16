import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * 火山引擎专用 OpenAI 适配器
 * 继承基础 OpenAI 适配器，注入火山引擎特有逻辑
 */
export class VolcEngineOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，将 thinkingEffort 转换为火山引擎的 reasoning_effort 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // 火山引擎特有：将 thinkingEffort 转换为 reasoning_effort（根级别）
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
        // 强度值：minimal, low, medium, high
        // 设置 reasoning_effort 即隐含启用思考
        requestParams.reasoning_effort = effort;
      }
    }

    return requestParams;
  }
}
