import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";

// 切断 ApiService → locales → localStorage 导入链（node 环境无 localStorage）
vi.mock("@/services/ApiService", () => ({
  apiService: { updateGroupSettings: vi.fn(() => Promise.resolve({})) },
}));

import {
  applyLanguageFromAppearance,
  resolveLanguage,
  useLanguage,
} from "./useLanguage";
import { apiService } from "@/services/ApiService";

/**
 * 语言解析与应用测试
 *
 * 语言随 appearance 分组一起下发（App.vue 不再单独请求一次该分组），规则是
 * "localStorage 优先，后端为 fallback"：
 * - resolveLanguage 是纯函数，四种取值组合全覆盖（含 localStorage 命中的分支）
 * - applyLanguageFromAppearance 在 node 环境（无 localStorage，saved 恒为 null）
 *   覆盖"应用 + 防抖回写"的实际行为
 */

const mockedUpdate = vi.mocked(apiService.updateGroupSettings);

describe("resolveLanguage", () => {
  it("localStorage 有合法值：以它为准，不落盘、不用后端值", () => {
    expect(resolveLanguage("en-US", "zh-CN")).toEqual({
      locale: "en-US",
      persist: false,
    });
  });

  it("localStorage 缺失、后端合法：用后端值并落盘", () => {
    expect(resolveLanguage(null, "en-US")).toEqual({
      locale: "en-US",
      persist: true,
    });
  });

  it("两边都没有可用值：返回 null（调用方保持现状）", () => {
    expect(resolveLanguage(null, undefined)).toBeNull();
    expect(resolveLanguage(null, "")).toBeNull();
    expect(resolveLanguage(null, 42)).toBeNull();
  });

  it("非法值一律不采用", () => {
    expect(resolveLanguage(null, "fr-FR")).toBeNull();
    expect(resolveLanguage("zh_CN", "en-US")).toEqual({
      locale: "en-US",
      persist: true,
    });
  });
});

describe("applyLanguageFromAppearance", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    // 模块级单例：先复位，并把复位本身触发的回写清干净
    useLanguage().setLanguage("zh-CN");
    await nextTick();
    vi.runAllTimers();
    mockedUpdate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("后端下发语言时切换当前语言，并经防抖回写一次（幂等）", async () => {
    applyLanguageFromAppearance("en-US");
    expect(useLanguage().locale.value).toBe("en-US");

    await nextTick();
    vi.advanceTimersByTime(600);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith("appearance", { language: "en-US" });
  });

  it("后端未给 language：保持现状且不发请求", async () => {
    applyLanguageFromAppearance(undefined);
    expect(useLanguage().locale.value).toBe("zh-CN");

    await nextTick();
    vi.advanceTimersByTime(600);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("后端值与当前一致：不触发任何同步", async () => {
    applyLanguageFromAppearance("zh-CN");

    await nextTick();
    vi.advanceTimersByTime(600);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
