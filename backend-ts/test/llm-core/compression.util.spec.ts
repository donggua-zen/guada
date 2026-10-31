import * as zlib from 'zlib';
import {
  COMPRESSION_THRESHOLD_BYTES,
  resetCompressionStateForTests,
  withRequestBodyCompression,
} from '../../src/modules/llm-core/utils/compression.util';

/** 构造一个记录调用参数的 fetch 桩 */
function makeRecordingFetch(
  respond: (call: { url: string; init: any }) => Response = () =>
    new Response('{}', { status: 200 }),
) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = async (input: any, init?: any) => {
    calls.push({ url: String(input), init });
    return respond({ url: String(input), init });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

function bodyOf(init: any): Buffer {
  const b = init.body;
  if (typeof b === 'string') return Buffer.from(b, 'utf8');
  if (Buffer.isBuffer(b)) return b;
  return Buffer.from(b);
}

function gunzip(buf: Buffer): string {
  return zlib.gunzipSync(buf).toString('utf8');
}

const BIG_JSON = JSON.stringify({ data: 'x'.repeat(COMPRESSION_THRESHOLD_BYTES + 100) });
const SMALL_JSON = JSON.stringify({ data: 'x'.repeat(1024) });

beforeEach(() => resetCompressionStateForTests());

describe('withRequestBodyCompression', () => {
  it('小于阈值不压缩（body 原样、无 content-encoding）', async () => {
    const { fn, calls } = makeRecordingFetch();
    const fetch = withRequestBodyCompression(fn);

    await fetch('https://relay.example.com/v1/chat/completions', {
      method: 'POST',
      body: SMALL_JSON,
      headers: { 'content-type': 'application/json' },
    });

    expect(calls).toHaveLength(1);
    const init = calls[0].init;
    expect(typeof init.body).toBe('string');
    expect(bodyOf(init).toString('utf8')).toBe(SMALL_JSON);
    expect(new Headers(init.headers).get('content-encoding')).toBeNull();
  });

  it('达到阈值压缩：gzip magic、content-encoding、可还原', async () => {
    const { fn, calls } = makeRecordingFetch();
    const fetch = withRequestBodyCompression(fn);

    await fetch('https://relay.example.com/v1/chat/completions', {
      method: 'POST',
      body: BIG_JSON,
      headers: { 'content-type': 'application/json', 'content-length': String(BIG_JSON.length) },
    });

    expect(calls).toHaveLength(1);
    const init = calls[0].init;
    const buf = bodyOf(init);
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);
    expect(new Headers(init.headers).get('content-encoding')).toBe('gzip');
    // 旧 content-length 必须删除（否则 undici 只发前 N 字节）
    expect(new Headers(init.headers).get('content-length')).toBeNull();
    expect(gunzip(buf)).toBe(BIG_JSON);
    expect(buf.length).toBeLessThan(Buffer.byteLength(BIG_JSON) / 2);
  });

  it('非 JSON 字符串/非 string body 透传（FormData / Buffer）', async () => {
    const { fn, calls } = makeRecordingFetch();
    const fetch = withRequestBodyCompression(fn);

    const form = new FormData();
    form.append('file', 'hello');
    await fetch('https://relay.example.com/upload', { method: 'POST', body: form });

    const buf = Buffer.alloc(COMPRESSION_THRESHOLD_BYTES + 10, 1);
    await fetch('https://relay.example.com/raw', { method: 'POST', body: buf });

    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0].init.headers).get('content-encoding')).toBeNull();
    expect(new Headers(calls[1].init.headers).get('content-encoding')).toBeNull();
  });

  it('压缩请求收到 415：自动明文重发一次，并记住该 origin', async () => {
    let call = 0;
    const { fn, calls } = makeRecordingFetch(() => {
      call += 1;
      return call === 1
        ? new Response('unsupported content encoding', { status: 415 })
        : new Response('{}', { status: 200 });
    });
    const fetch = withRequestBodyCompression(fn);

    const res = await fetch('https://relay.example.com/v1/chat/completions', {
      method: 'POST',
      body: BIG_JSON,
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    // 第一次压缩，第二次明文
    expect(new Headers(calls[0].init.headers).get('content-encoding')).toBe('gzip');
    expect(new Headers(calls[1].init.headers).get('content-encoding')).toBeNull();
    expect(bodyOf(calls[1].init).toString('utf8')).toBe(BIG_JSON);

    // 同 origin 后续请求直接明文（不再先压一次）
    await fetch('https://relay.example.com/v1/chat/completions', {
      method: 'POST',
      body: BIG_JSON,
      headers: { 'content-type': 'application/json' },
    });
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[2].init.headers).get('content-encoding')).toBeNull();
  });

  it('400 且响应体提示编码问题 → 回退；400 普通错误不重发', async () => {
    // 编码问题
    let call = 0;
    const enc = makeRecordingFetch(() => {
      call += 1;
      return call === 1
        ? new Response('JSON parse error: content-encoding gzip not supported', { status: 400 })
        : new Response('{}', { status: 200 });
    });
    const fetch1 = withRequestBodyCompression(enc.fn);
    const res1 = await fetch1('https://a.example.com/v1/chat/completions', {
      method: 'POST', body: BIG_JSON, headers: { 'content-type': 'application/json' },
    });
    expect(res1.status).toBe(200);
    expect(enc.calls).toHaveLength(2);

    // 普通 400（如参数错误）：不重发
    const plain = makeRecordingFetch(() => new Response('{"error":"bad model"}', { status: 400 }));
    const fetch2 = withRequestBodyCompression(plain.fn);
    const res2 = await fetch2('https://b.example.com/v1/chat/completions', {
      method: 'POST', body: BIG_JSON, headers: { 'content-type': 'application/json' },
    });
    expect(res2.status).toBe(400);
    expect(plain.calls).toHaveLength(1);
  });

  it('保留 dispatcher/signal 等其它 init 字段', async () => {
    const { fn, calls } = makeRecordingFetch();
    const fetch = withRequestBodyCompression(fn);
    const controller = new AbortController();
    const dispatcher = { marker: 'agent' };

    await fetch('https://relay.example.com/v1/chat/completions', {
      method: 'POST',
      body: BIG_JSON,
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      dispatcher,
    } as any);

    expect(calls[0].init.dispatcher).toBe(dispatcher);
    expect(calls[0].init.signal).toBe(controller.signal);
  });
});
