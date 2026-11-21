import {
  buildOutputContinuationMessage,
  classifyOutputTokenContinuation,
  createOutputContinuationMessage,
  isOutputTokenLimitFinishReason,
  MAX_OUTPUT_TOKEN_CONTINUATIONS,
  OUTPUT_TOKEN_CONTINUE_PROMPT,
  OUTPUT_TOKEN_LIMIT_ERROR_MESSAGE,
} from '../../src/modules/chat/output-token-continuation';

describe('output-token-continuation', () => {
  it('length + 无工具 + 未达上限 → continue', () => {
    expect(
      classifyOutputTokenContinuation({
        finishReason: 'length',
        toolCallCount: 0,
        continuationCount: 0,
      }),
    ).toBe('continue');
    expect(
      classifyOutputTokenContinuation({
        finishReason: 'length',
        toolCallCount: 0,
        continuationCount: MAX_OUTPUT_TOKEN_CONTINUATIONS - 1,
      }),
    ).toBe('continue');
  });

  it('第 4 次 length → exhausted', () => {
    expect(
      classifyOutputTokenContinuation({
        finishReason: 'length',
        toolCallCount: 0,
        continuationCount: MAX_OUTPUT_TOKEN_CONTINUATIONS,
      }),
    ).toBe('exhausted');
  });

  it('有工具调用 / 正常 stop → none', () => {
    expect(
      classifyOutputTokenContinuation({
        finishReason: 'length',
        toolCallCount: 1,
        continuationCount: 0,
      }),
    ).toBe('none');
    expect(
      classifyOutputTokenContinuation({
        finishReason: 'stop',
        toolCallCount: 0,
        continuationCount: 0,
      }),
    ).toBe('none');
  });

  it('raw finish reason 也识别 max_tokens / context window', () => {
    expect(isOutputTokenLimitFinishReason('other', 'max_tokens')).toBe(true);
    expect(
      isOutputTokenLimitFinishReason('other', 'max_output_tokens'),
    ).toBe(true);
    expect(
      isOutputTokenLimitFinishReason('other', 'model_context_window_exceeded'),
    ).toBe(true);
    expect(isOutputTokenLimitFinishReason('stop', 'end_turn')).toBe(false);
  });

  it('隐藏续写消息：user/model/hidden/queryScope', () => {
    const message = createOutputContinuationMessage('m-cont');
    expect(message.role).toBe('user');
    expect(message.kind).toBe('model');
    expect(message.metadata).toMatchObject({
      hidden: true,
      synthetic: true,
      queryScope: 'output_token_continuation',
    });
    expect(message.content).toEqual([
      { type: 'text', text: OUTPUT_TOKEN_CONTINUE_PROMPT },
    ]);
  });

  it('续写提示文案与错误文案稳定', () => {
    expect(buildOutputContinuationMessage(1, 3)).toContain('1/3');
    expect(OUTPUT_TOKEN_LIMIT_ERROR_MESSAGE).toContain('output token maximum');
  });
});
