import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
import { classifyError } from "./retry-on-error.util";
import {
  UpstreamNetworkError,
  UpstreamRequestError,
  UpstreamTimeoutError,
} from "./upstream-errors";

function makeError(message: string, extra: Record<string, any> = {}): Error {
  return Object.assign(new Error(message), extra);
}

describe("classifyError", () => {
  it("把 OpenAI APIConnectionTimeoutError 归类为 timeout", () => {
    expect(classifyError(new APIConnectionTimeoutError())).toBe("timeout");
  });

  it("把 OpenAI APIConnectionError 归类为 network_error", () => {
    const error = new APIConnectionError({ message: "Connection error." });
    expect(classifyError(error)).toBe("network_error");
  });

  it("把裸的 Request timed out 消息归类为 timeout", () => {
    expect(classifyError(makeError("Request timed out."))).toBe("timeout");
  });

  it("把 undici 连接超时的 cause code 归类为 timeout", () => {
    const error = makeError("fetch failed", {
      cause: makeError("Connect Timeout Error", {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
    expect(classifyError(error)).toBe("timeout");
  });

  it("把 ECONNRESET 归类为 network_error", () => {
    expect(classifyError(makeError("socket hang up", { code: "ECONNRESET" }))).toBe(
      "network_error",
    );
  });

  it("把 fetch failed 消息归类为 network_error", () => {
    expect(classifyError(makeError("fetch failed"))).toBe("network_error");
  });

  it("用户中止不可重试", () => {
    const error = makeError("aborted", { name: "AbortError" });
    expect(classifyError(error)).toBeNull();
  });

  it("4xx 不可重试", () => {
    expect(classifyError(makeError("bad request", { status: 400 }))).toBeNull();
  });

  it("5xx 可重试", () => {
    expect(classifyError(makeError("bad gateway", { status: 502 }))).toBe(
      "network_error",
    );
  });

  it("保留 Upstream 类型的既有分类", () => {
    expect(classifyError(new UpstreamTimeoutError("timeout"))).toBe("timeout");
    expect(classifyError(new UpstreamNetworkError("network"))).toBe(
      "network_error",
    );
    expect(classifyError(new UpstreamRequestError("bad request"))).toBeNull();
  });
});
