import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
import { classifyError, isPayloadTooLarge } from "./retry-on-error.util";
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

describe("isPayloadTooLarge", () => {
  it("识别 413 状态码", () => {
    expect(isPayloadTooLarge(makeError("nope", { status: 413 }))).toBe(true);
    expect(isPayloadTooLarge(makeError("nope", { statusCode: 413 }))).toBe(true);
    expect(
      isPayloadTooLarge(makeError("nope", { response: { status: 413 } })),
    ).toBe(true);
  });

  it("识别错误码", () => {
    expect(
      isPayloadTooLarge(makeError("x", { code: "request_too_large" })),
    ).toBe(true);
    expect(
      isPayloadTooLarge(makeError("x", { code: "payload_too_large" })),
    ).toBe(true);
  });

  it("识别网关文案", () => {
    expect(
      isPayloadTooLarge(makeError("Request entity too large")),
    ).toBe(true);
    expect(
      isPayloadTooLarge(makeError("request body is too large")),
    ).toBe(true);
    expect(
      isPayloadTooLarge(
        makeError("Request exceeds the maximum allowed size of 10485760 bytes"),
      ),
    ).toBe(true);
    expect(
      isPayloadTooLarge(makeError("413 Payload Too Large")),
    ).toBe(true);
  });

  it("普通 400 不误判（交给其他分类器）", () => {
    expect(isPayloadTooLarge(makeError("bad request", { status: 400 }))).toBe(
      false,
    );
    expect(isPayloadTooLarge(makeError("invalid json"))).toBe(false);
    expect(isPayloadTooLarge(null)).toBe(false);
  });

  it("上下文超长不被误判为体积超限", () => {
    expect(
      isPayloadTooLarge(makeError("maximum context length is 128000 tokens")),
    ).toBe(false);
  });
});
