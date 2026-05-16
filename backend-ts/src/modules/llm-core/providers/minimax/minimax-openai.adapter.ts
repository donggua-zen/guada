import { OpenAIAdapter } from '../../adapters/openai.adapter';

/**
 * MiniMax 专用 OpenAI 适配器
 * 继承基础 OpenAI 适配器，注入 MiniMax 特有逻辑
 */
export class MinimaxOpenAIAdapter extends OpenAIAdapter {
  // 继承父类的 protocol = 'openai'

  /**
   * 覆盖 buildRequestParams ，注入 MiniMax 特有的 reasoning_split 参数
   */
  protected buildRequestParam(params: any): any {
    const requestParams = super.buildRequestParam(params);

    // MiniMax 特有：M2 系列模型默认始终开启思考，只需设置 reasoning_split
    requestParams.reasoning_split = true;

    return requestParams;
  }
}
