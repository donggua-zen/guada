import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * 百度智能云千帆专用 OpenAI 适配器
 * 继承基础 OpenAI 适配器，注入百度千帆特有逻辑
 */
export class BaiduQianfanOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，将 thinkingEffort 转换为百度千帆的 enable_thinking 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // 百度千帆特有：将 thinkingEffort 转换为 enable_thinking（根级别）
    if (params.thinkingEffort !== undefined) {
      requestParams.enable_thinking = params.thinkingEffort !== 'off';
    }

    return requestParams;
  }
}
