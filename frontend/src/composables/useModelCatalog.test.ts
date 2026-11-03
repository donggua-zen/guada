import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useModelCatalog 共享模型目录测试
 *
 * 覆盖：并发去重、TTL 内不重拉 / 过期重拉、force 强刷、
 * 失败后可重试且旧数据保留、text+isActive 过滤口径、resetCatalog 隔离。
 */

const fetchModels = vi.fn(async (): Promise<PaginatedResponse<ModelProvider>> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 0,
  hasNext: false,
  hasPrev: false,
}));

vi.mock("@/services/ApiService", () => ({
  apiService: {
    fetchModels: () => fetchModels(),
  },
}));

import { resetCatalog, useModelCatalog } from "./useModelCatalog";
import type { Model, ModelProvider } from "@/types/api";
import type { PaginatedResponse } from "@/types/common";

function makeProvider(
  id: string,
  models: Array<Partial<Model> & { id: string }>,
): ModelProvider & { models: Model[] } {
  return {
    id,
    name: `provider-${id}`,
    apiUrl: "",
    apiKey: "",
    models: models.map((m) => ({
      modelType: "text",
      isActive: true,
      ...m,
    })) as Model[],
  } as ModelProvider & { models: Model[] };
}

function makePage(items: ModelProvider[]): PaginatedResponse<ModelProvider> {
  return { items, total: items.length, page: 1, pageSize: items.length, hasNext: false, hasPrev: false };
}

describe("useModelCatalog", () => {
  beforeEach(() => {
    resetCatalog();
    fetchModels.mockReset();
    fetchModels.mockResolvedValue(makePage([]));
  });

  it("并发/重复 ensureLoaded 只发一次 fetchModels", async () => {
    await Promise.all([
      useModelCatalog().ensureLoaded(),
      useModelCatalog().ensureLoaded(),
      useModelCatalog().ensureLoaded(),
    ]);
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it("TTL 内再调 ensureLoaded 不重拉；过期后重拉", async () => {
    const { ensureLoaded } = useModelCatalog();
    await ensureLoaded();
    await ensureLoaded();
    expect(fetchModels).toHaveBeenCalledTimes(1);

    // TTL 为 60s：把 loadedAt 回拨 61s 模拟过期（直接操纵 Date.now 不动模块私有态）
    const realNow = Date.now;
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow() + 61_000);
    await ensureLoaded();
    spy.mockRestore();
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("ensureLoaded(true) 强制重拉", async () => {
    const { ensureLoaded } = useModelCatalog();
    await ensureLoaded();
    await ensureLoaded(true);
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("重拉失败时旧数据保留，下次调用可重试", async () => {
    const { ensureLoaded, models } = useModelCatalog();
    fetchModels.mockResolvedValueOnce(makePage([makeProvider("p1", [{ id: "m1" }])]));
    await ensureLoaded();
    expect(models.value.map((m) => m.id)).toEqual(["m1"]);

    fetchModels.mockRejectedValueOnce(new Error("network down"));
    await expect(useModelCatalog().ensureLoaded(true)).rejects.toThrow("network down");
    // 旧数据不清空
    expect(models.value.map((m) => m.id)).toEqual(["m1"]);

    // 失败不清新鲜度：TTL 内复用旧数据零请求
    await useModelCatalog().ensureLoaded();
    expect(fetchModels).toHaveBeenCalledTimes(2);

    // 过期后调用自动重试并落地新数据
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    fetchModels.mockResolvedValueOnce(makePage([makeProvider("p1", [{ id: "m2" }])]));
    await useModelCatalog().ensureLoaded();
    spy.mockRestore();
    expect(fetchModels).toHaveBeenCalledTimes(3);
    expect(models.value.map((m) => m.id)).toEqual(["m2"]);
  });

  it("过滤口径：仅 text+isActive 入列表，无合格模型的 provider 不入 providers", async () => {
    fetchModels.mockResolvedValueOnce(
      makePage([
        makeProvider("p1", [
          { id: "text-active", modelType: "text", isActive: true },
          { id: "text-disabled", modelType: "text", isActive: false },
          { id: "embedding", modelType: "embedding", isActive: true },
        ]),
        makeProvider("p2", [{ id: "only-embedding", modelType: "embedding" }]),
      ]),
    );
    const { ensureLoaded, models, providers } = useModelCatalog();
    await ensureLoaded();

    expect(models.value.map((m) => m.id)).toEqual(["text-active"]);
    expect(providers.value.map((p) => p.id)).toEqual(["p1"]);
    // 供应商嵌套 models 字段不残留在 providers 里
    expect(providers.value[0]).not.toHaveProperty("models");
  });

  it("强刷取代在飞请求后，晚完成的旧拉取不覆盖新数据", async () => {
    const { ensureLoaded, models } = useModelCatalog();
    let resolveFirst!: (page: PaginatedResponse<ModelProvider>) => void;
    fetchModels.mockImplementationOnce(
      () => new Promise<PaginatedResponse<ModelProvider>>((resolve) => (resolveFirst = resolve)),
    );
    const first = ensureLoaded();

    // 旧请求在飞时强刷，新请求立即完成
    fetchModels.mockResolvedValueOnce(makePage([makeProvider("p1", [{ id: "new" }])]));
    await ensureLoaded(true);
    expect(models.value.map((m) => m.id)).toEqual(["new"]);

    // 旧请求晚完成：整体丢弃，不得回写旧目录
    resolveFirst(makePage([makeProvider("p1", [{ id: "stale" }])]));
    await first;
    expect(models.value.map((m) => m.id)).toEqual(["new"]);
  });

  it("resetCatalog 后状态归零、可重新加载", async () => {
    const first = useModelCatalog();
    fetchModels.mockResolvedValueOnce(makePage([makeProvider("p1", [{ id: "m1" }])]));
    await first.ensureLoaded();
    expect(first.models.value).toHaveLength(1);

    resetCatalog();
    expect(first.models.value).toEqual([]);
    expect(first.providers.value).toEqual([]);

    fetchModels.mockResolvedValueOnce(makePage([makeProvider("p2", [{ id: "m2" }])]));
    await first.ensureLoaded();
    expect(fetchModels).toHaveBeenCalledTimes(2);
    expect(first.models.value.map((m) => m.id)).toEqual(["m2"]);
  });
});
