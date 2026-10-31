import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
import { OpenAIAdapter } from "./openai.adapter";
import { insecureFetch } from "../utils/tls.util";
import {
  UpstreamNetworkError,
  UpstreamTimeoutError,
} from "../utils/upstream-errors";

describe("OpenAIAdapter error normalization", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    adapter = new OpenAIAdapter({} as any);
    // handleError 会先写日志，单测里静音
    (adapter as any).logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  });

  it("把连接超时归一化为 UpstreamTimeoutError（可重试）", () => {
    expect(() =>
      (adapter as any).handleError(new APIConnectionTimeoutError(), true),
    ).toThrow(UpstreamTimeoutError);
  });

  it("把连接失败归一化为 UpstreamNetworkError（可重试）", () => {
    expect(() =>
      (adapter as any).handleError(
        new APIConnectionError({ message: "Connection error." }),
        true,
      ),
    ).toThrow(UpstreamNetworkError);
  });
});

describe("OpenAIAdapter request compression wiring", () => {
  const adapter = new OpenAIAdapter({} as any);
  const baseConfig = {
    id: 'relay',
    type: 'guada-relay',
    apiUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-test',
  };

  it("requestCompression=true 时注入压缩 fetch（与 insecureFetch 不同）", () => {
    const client: any = (adapter as any).createClient({
      ...baseConfig,
      requestCompression: true,
    });
    expect(client.fetch).not.toBe(insecureFetch);
    expect(typeof client.fetch).toBe('function');
  });

  it("requestCompression 缺省/ false 时保持 insecureFetch", () => {
    const plain: any = (adapter as any).createClient(baseConfig);
    expect(plain.fetch).toBe(insecureFetch);
    const off: any = (adapter as any).createClient({
      ...baseConfig,
      requestCompression: false,
    });
    expect(off.fetch).toBe(insecureFetch);
  });
});
