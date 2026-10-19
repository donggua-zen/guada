import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
import { OpenAIAdapter } from "./openai.adapter";
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
