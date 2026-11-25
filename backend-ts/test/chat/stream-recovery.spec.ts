import type { Message } from '../../src/common/types/conversation.types';
import {
  UpstreamNetworkError,
  UpstreamRateLimitError,
  UpstreamRequestError,
  UpstreamResponseFailedError,
  UpstreamStreamTruncatedError,
  UpstreamTimeoutError,
} from '../../src/modules/llm-core/utils/upstream-errors';
import { createAbortError } from '../../src/modules/llm-core/utils/abort-error.util';
import {
  beginStreamRecoveryAttempt,
  classifyStreamRecoveryFailure,
  createPreviousMessageAnchorId,
  createStreamRecoveryState,
  createToolResultAnchorId,
  extractFailedRequestId,
  hasStreamRecoveryBudget,
  isRetryableStreamRecoveryFailure,
  summarizeAssistantPartial,
} from '../../src/modules/chat/stream-recovery';

function assistant(content: Message['content']): Message {
  return {
    id: 'm1',
    role: 'assistant',
    kind: 'model',
    source: { kind: 'model', provider: 'p', model: 'm' },
    metadata: {},
    content,
  };
}

describe('stream-recovery', () => {
  describe('预算', () => {
    it('retry = 10 次，error = 0 次', () => {
      expect(createStreamRecoveryState('retry').maxRetries).toBe(10);
      expect(createStreamRecoveryState('error').maxRetries).toBe(0);
    });

    it('beginStreamRecoveryAttempt 递增并给出 1-based 序号', () => {
      const state = createStreamRecoveryState('retry');
      expect(hasStreamRecoveryBudget(state)).toBe(true);
      expect(beginStreamRecoveryAttempt(state)).toEqual({
        retryNumber: 1,
        maxRetries: 10,
      });
      expect(beginStreamRecoveryAttempt(state)).toEqual({
        retryNumber: 2,
        maxRetries: 10,
      });
    });

    it('error 模式预算一开始就耗尽', () => {
      const state = createStreamRecoveryState('error');
      expect(hasStreamRecoveryBudget(state)).toBe(false);
    });
  });

  describe('半截消息统计', () => {
    it('区分完整工具、残缺工具与可见字符', () => {
      const summary = summarizeAssistantPartial(
        assistant([
          { type: 'reasoning', summary: '思考' },
          { type: 'text', text: '正文' },
          {
            type: 'tool-call',
            toolCallId: 'ok',
            name: 'read',
            arguments: '{"a":1}',
            argumentsComplete: true,
          },
          {
            type: 'tool-call',
            toolCallId: 'bad',
            name: 'write',
            arguments: '{"a":',
            argumentsComplete: false,
          },
          {
            type: 'tool-call',
            toolCallId: 'unknown',
            name: 'shell',
            arguments: '{}',
          },
        ]),
      );

      expect(summary.textChars).toBe(2);
      expect(summary.reasoningChars).toBe(2);
      expect(summary.visibleChars).toBe(4);
      expect(summary.completeToolCalls.map((b) => b.toolCallId)).toEqual(['ok']);
      expect(summary.incompleteToolCalls.map((b) => b.toolCallId)).toEqual([
        'bad',
        'unknown',
      ]);
    });

    it('null 消息返回全零', () => {
      expect(summarizeAssistantPartial(null)).toMatchObject({
        textChars: 0,
        reasoningChars: 0,
        visibleChars: 0,
        completeToolCalls: [],
        incompleteToolCalls: [],
      });
    });
  });

  describe('可重试判定', () => {
    it('用户中止永远不可重试', () => {
      const abort = createAbortError('aborted');
      const wrapped = new UpstreamNetworkError('wrapped', abort);
      expect(isRetryableStreamRecoveryFailure(abort)).toBe(false);
      expect(isRetryableStreamRecoveryFailure(wrapped)).toBe(false);
    });

    it('空闲超时（AbortError 在 cause 里）仍可重试', () => {
      // 复现 session-e9821bc1：180s 无数据触发 idle timeout，内部 controller abort
      // 让 SDK 抛 AbortError 并作为 cause 挂在 UpstreamTimeoutError 上。它不能被
      // 误判成用户中止，否则恢复层直接 stopping、不重试。
      const idle = new UpstreamTimeoutError(
        'Stream idle timeout: no data received for 180s',
        createAbortError('aborted'),
      );
      expect(isRetryableStreamRecoveryFailure(idle)).toBe(true);
      expect(classifyStreamRecoveryFailure(idle)).toBe('provider_timeout');
    });

    it('结构化 upstream 错误', () => {
      expect(
        isRetryableStreamRecoveryFailure(
          new UpstreamStreamTruncatedError('cut'),
        ),
      ).toBe(true);
      expect(
        isRetryableStreamRecoveryFailure(new UpstreamTimeoutError('timeout')),
      ).toBe(true);
      expect(
        isRetryableStreamRecoveryFailure(new UpstreamRateLimitError('429')),
      ).toBe(true);
      expect(
        isRetryableStreamRecoveryFailure(
          new UpstreamResponseFailedError('failed', { retryable: true }),
        ),
      ).toBe(true);
      expect(
        isRetryableStreamRecoveryFailure(
          new UpstreamResponseFailedError('failed', { retryable: false }),
        ),
      ).toBe(false);
      expect(
        isRetryableStreamRecoveryFailure(new UpstreamRequestError('400')),
      ).toBe(false);
    });

    it('沿 cause 链读取 retryable / timeout 文案', () => {
      const wrapped = new Error('outer');
      (wrapped as any).cause = Object.assign(new Error('inner'), {
        retryable: true,
      });
      expect(isRetryableStreamRecoveryFailure(wrapped)).toBe(true);

      const timeoutMsg = new Error(
        'Unable to download content before the timeout',
      );
      expect(isRetryableStreamRecoveryFailure(timeoutMsg)).toBe(true);

      const business = new Error('invalid request');
      expect(isRetryableStreamRecoveryFailure(business)).toBe(false);
    });

    it('分类用于 telemetry', () => {
      expect(
        classifyStreamRecoveryFailure(new UpstreamTimeoutError('timeout')),
      ).toBe('provider_timeout');
      expect(
        classifyStreamRecoveryFailure(new UpstreamNetworkError('reset')),
      ).toBe('provider_network_error');
      expect(
        classifyStreamRecoveryFailure(
          new UpstreamStreamTruncatedError('cut'),
        ),
      ).toBe('provider_stream_error');
      expect(
        classifyStreamRecoveryFailure(
          new UpstreamResponseFailedError('failed', { retryable: true }),
        ),
      ).toBe('provider_response_failed');
      expect(classifyStreamRecoveryFailure('boom')).toBe('unknown');
    });
  });

  describe('anchor / request id', () => {
    it('生成稳定 anchor id', () => {
      expect(createPreviousMessageAnchorId('m1')).toBe(
        'm1:previous-message-anchor',
      );
      expect(createToolResultAnchorId('m1', 'call_1')).toBe(
        'm1:call_1:tool-result',
      );
    });

    it('从 response.failed 提取 request id', () => {
      const error = new UpstreamResponseFailedError('failed', {
        retryable: true,
        requestId: 'resp_123',
      });
      expect(extractFailedRequestId(error)).toBe('resp_123');
      expect(extractFailedRequestId(new Error('x'))).toBeUndefined();
    });
  });
});
