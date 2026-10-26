import { describe, expect, it, vi } from "vitest";
import { generateUuid } from "./uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUuid", () => {
  it("生成合法 UUID v4", () => {
    expect(generateUuid()).toMatch(UUID_V4);
  });

  it("非安全上下文（无 crypto.randomUUID）时降级仍生成合法 UUID", () => {
    const original = crypto.randomUUID;
    // 模拟 http://局域网IP 访问：randomUUID 不存在，getRandomValues 可用
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(generateUuid()).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
    vi.restoreAllMocks();
  });
});
