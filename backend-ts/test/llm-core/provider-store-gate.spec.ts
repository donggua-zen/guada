import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProviderFileStore } from "../../src/modules/llm-core/provider-file.store";
import { BundledCatalogService } from "../../src/modules/llm-core/bundled-catalog.service";
import {
  META_DOMAIN_PROVIDERS,
  MetadataBootstrapGate,
} from "../../src/common/database/metadata-bootstrap.gate";

/**
 * 「升级后首次启动供应商全丢」回归
 *
 * 现象（客户复现）：升级后打开设置，供应商列表为空；随便新增一个供应商，
 * 之前所有供应商"突然全部出现"——数据从未丢失，是索引预热跑在迁移导出之前、
 * 把空目录缓存了一整个会话（新增写操作触发 loadAll 全量重扫才补齐）。
 *
 * 根因：LlmCoreModule（@Global 基座）在 app.module.ts 中位于 PersistenceModule
 * 之前，其 onModuleInit 的 store.initialize() 先于 DB→文件导出执行。
 * 修复：ProviderFileStore.initialize() 等 MetadataBootstrapGate 的 providers 域，
 * ProviderBootstrapService 导出结束后 complete。
 */
describe("ProviderFileStore 启动门控（供应商首启不可见回归）", () => {
  let dir: string;
  let previousDir: string | undefined;

  const writeProvider = (id: string, name: string): void => {
    fs.writeFileSync(
      path.join(dir, `${id}.yaml`),
      `id: ${id}\ntype: openai\nname: ${name}\nprotocol: openai\n`,
    );
  };

  const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("waitFor 超时：条件未在期限内满足");
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-gate-"));
    previousDir = process.env.PROVIDERS_DIR;
    process.env.PROVIDERS_DIR = dir;
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.PROVIDERS_DIR;
    else process.env.PROVIDERS_DIR = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("预热早于迁移导出时：不阻塞初始化，门控放行后自动重扫纳入全部供应商", async () => {
    const gate = new MetadataBootstrapGate();
    const store = new ProviderFileStore(new BundledCatalogService(), gate);

    // 模拟 app.module 的启动顺序：LlmCoreModule 的预热先跑（此刻目录还是空的）。
    // 关键点：初始化必须立即返回——Nest 的模块钩子跨模块串行 await，
    // 若在此阻塞等门控，会与 PersistenceModule 的迁移导出互锁到超时。
    await store.initialize();
    expect(store.listProviders()).toHaveLength(0);

    // 迁移导出（晚于预热）写出实例文件，然后放行门控
    writeProvider("p1", "供应商一");
    writeProvider("p2", "供应商二");
    gate.complete(META_DOMAIN_PROVIDERS);

    // 放行后 store 自动重扫（无需任何写操作触发）
    await waitFor(() => store.listProviders().length === 2, 2000);
    expect(
      store
        .listProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p1", "p2"]);
  });

  it("门控已放行后再预热：直接加载，不做多余重扫", async () => {
    writeProvider("p1", "供应商一");
    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_PROVIDERS);

    const store = new ProviderFileStore(new BundledCatalogService(), gate);
    await store.initialize();
    expect(store.listProviders().map((p) => p.id)).toEqual(["p1"]);
  });

  it("脚手架自持实例（无门控）不等待，避免导出方自锁", async () => {
    writeProvider("p1", "供应商一");
    const store = new ProviderFileStore(new BundledCatalogService());
    await store.initialize();
    expect(store.listProviders().map((p) => p.id)).toEqual(["p1"]);
  });

  it("导出失败也必须放行（ProviderBootstrapService.run 的 finally 语义）", async () => {
    // 用假 prisma 触发导出失败路径：run() 抛错时门控仍应 complete，
    // 否则域 store 每次启动都要空等 30s 超时。
    const { ProviderBootstrapService } = await import(
      "../../src/common/database/bootstrap/provider-bootstrap.service"
    );
    const gate = new MetadataBootstrapGate();
    const failingPrisma = {
      modelProvider: {
        findMany: async () => {
          throw new Error("DB unreadable");
        },
      },
      model: { findMany: async () => [] },
    };
    const service = new ProviderBootstrapService(
      failingPrisma as any,
      { getSettings: async () => ({}), updateSettings: async () => undefined } as any,
      gate,
    );

    await expect(service.run()).resolves.toBeUndefined();
    expect(gate.isCompleted(META_DOMAIN_PROVIDERS)).toBe(true);
  });
});
