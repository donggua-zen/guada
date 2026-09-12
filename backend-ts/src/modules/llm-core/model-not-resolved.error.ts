/**
 * 会话模型无法解析（fail-loud）
 *
 * 模型是文件（providers/*.yaml）里的数据，引用的解析失败只有两种成因：
 * - 会话自选的 modelId 解析不到：模型文件被删除或改名（或引用了旧格式 id）
 * - 会话未配置模型，且系统默认对话模型也没配
 *
 * 不再回退到全局默认模型——静默换模型会让成本与行为在用户不知情时改变。
 */
export class ModelNotResolvedError extends Error {
  readonly code = 'MODEL_NOT_RESOLVED';

  constructor(sessionId: string, modelId: string | null | undefined) {
    super(
      modelId
        ? `MODEL_NOT_RESOLVED: session "${sessionId}" selected model "${modelId}", ` +
          `but it cannot be resolved from providers/*.yaml (deleted or renamed). ` +
          `Re-select a model for this session.`
        : `MODEL_NOT_RESOLVED: session "${sessionId}" has no model configured, ` +
          `and no system default chat model is set. Configure one in model settings.`,
    );
    this.name = 'ModelNotResolvedError';
  }
}
