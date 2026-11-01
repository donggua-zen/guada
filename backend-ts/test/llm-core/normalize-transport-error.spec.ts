import {
  normalizeTransportError,
  classifyError,
} from '../../src/modules/llm-core/utils/retry-on-error.util';
import {
  UpstreamNetworkError,
  UpstreamTimeoutError,
} from '../../src/modules/llm-core/utils/upstream-errors';

describe('normalizeTransportError（传输层裸错误归一化）', () => {
  it('undici 流中断裸 TypeError（cause.code=UND_ERR_SOCKET）→ UpstreamNetworkError', () => {
    const raw = new TypeError('terminated');
    (raw as any).cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' };

    const normalized = normalizeTransportError(raw);

    expect(normalized).toBeInstanceOf(UpstreamNetworkError);
    expect(normalized.message).toBe('LLM API 连接中断: other side closed');
    expect(normalized.cause).toBe(raw);
  });

  it('error.code=ECONNRESET（无 cause 包装）→ UpstreamNetworkError', () => {
    const raw: any = new Error('socket hang up');
    raw.code = 'ECONNRESET';

    const normalized = normalizeTransportError(raw);

    expect(normalized).toBeInstanceOf(UpstreamNetworkError);
    expect(normalized.message).toBe('LLM API 连接中断: socket hang up');
  });

  it('cause.code=UND_ERR_CONNECT_TIMEOUT → UpstreamTimeoutError', () => {
    const raw = new TypeError('terminated');
    (raw as any).cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' };

    const normalized = normalizeTransportError(raw);

    expect(normalized).toBeInstanceOf(UpstreamTimeoutError);
    expect(normalized.message).toBe('LLM API 连接超时: Connect Timeout Error');
  });

  it('用户中止（name=AbortError）原样返回，不误标网络错误', () => {
    const raw: any = new Error('This operation was aborted');
    raw.name = 'AbortError';

    expect(normalizeTransportError(raw)).toBe(raw);
  });

  it('SDK 用户取消（message 含 abort，如 APIUserAbortError）原样返回', () => {
    const raw: any = new Error('Request was aborted');
    raw.name = 'APIUserAbortError';

    expect(normalizeTransportError(raw)).toBe(raw);
  });

  it('已包装的 UpstreamError 原样返回（不二次包装）', () => {
    const raw = new Error('connection reset');
    const wrapped = new UpstreamNetworkError('LLM API 连接失败: connection reset', raw);

    expect(normalizeTransportError(wrapped)).toBe(wrapped);
  });

  it('普通业务错误（无可识别传输码）原样返回', () => {
    const raw: any = new Error('LLM API Error: 402 - insufficient balance');
    raw.status = 402;

    expect(normalizeTransportError(raw)).toBe(raw);
  });

  it('归一化结果可被 classifyError 判为 network_error（重试链路不断）', () => {
    const raw = new TypeError('terminated');
    (raw as any).cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' };

    expect(classifyError(normalizeTransportError(raw))).toBe('network_error');
  });
});
