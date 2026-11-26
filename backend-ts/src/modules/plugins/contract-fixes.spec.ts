import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { ExternalPluginLoader } from "./external/external-plugin-loader";
import { PluginApiImpl } from "./api/plugin-api";
import { PluginRegistry } from "./registry/plugin-registry";
import { LocalSlashCommandRegistry } from "../chat/commands/local-slash-command.registry";

/**
 * 三项契约缺陷的回归测试（此前只写在 docs/plugin-api.md 的「陷阱」表里）：
 *   1. manifest.entries 字段无效 —— 现在 backend 真正生效
 *   2. 顶层 registerTool 丢嵌套 schema —— 现在复用限深展平器
 *   3. RPC / 本地命令不跟随启停 —— 现在执行前检查
 */

describe("修复1: manifest.entries.backend 真正生效", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "entries-test-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeLoader(userDir: string) {
    const registered: any[] = [];
    const loader = new ExternalPluginLoader(
      {
        getPlugin: () => undefined,
        registerPlugin: async (i: any) => registered.push(i),
      } as any,
      { get: (k: string) => (k === "PLUGINS_USER_DIR" ? userDir : undefined) } as any,
      { registerBundle: () => undefined } as any,
      { emit: () => undefined } as any,
    );
    return { loader, registered };
  }

  it("entries.backend 指向子目录时，从该文件加载而不是 index.js", async () => {
    const dir = path.join(root, "entries-plugin");
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        id: "entries-plugin",
        name: "E",
        version: "1.0.0",
        description: "d",
        main: "index.js",
        entries: { backend: "src/entry.js" },
        apiVersion: 2,
      }),
      "utf8",
    );
    // index.js 故意写成会抛错的实现：若被加载说明 entries 没生效
    fs.writeFileSync(
      path.join(dir, "index.js"),
      "throw new Error('index.js 不应被加载');",
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "src/entry.js"),
      "module.exports = class { async onLoad() {} };",
      "utf8",
    );

    const { loader, registered } = makeLoader(root);
    await (loader as any).loadExternalPlugin(dir, "user");

    expect(registered).toHaveLength(1);
    expect(registered[0].manifest.id).toBe("entries-plugin");
  });

  it("未声明 entries 时仍回退 main / index.js（旧插件不受影响）", async () => {
    const dir = path.join(root, "plain-plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        id: "plain-plugin",
        name: "P",
        version: "1.0.0",
        description: "d",
        main: "index.js",
        apiVersion: 2,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "index.js"),
      "module.exports = class { async onLoad() {} };",
      "utf8",
    );

    const { loader, registered } = makeLoader(root);
    await (loader as any).loadExternalPlugin(dir, "user");
    expect(registered).toHaveLength(1);
  });
});

describe("修复2: 顶层 registerTool 保留嵌套 schema", () => {
  const id = "nested-schema-plugin";

  afterEach(() => {
    PluginRegistry.clearPlugin(id);
  });

  it("数组元素与子对象形状不再丢失", () => {
    const api = new PluginApiImpl(id, "Nested");
    api.registerTool({
      name: "nested_tool",
      description: "x",
      inputSchema: z.object({
        items: z.array(z.object({ name: z.string(), qty: z.number().optional() })),
        meta: z.object({ tag: z.string() }),
      }),
      execute: async () => "ok",
    });
    api.flush();

    const [tool] = PluginRegistry.getTools(id);
    const props = tool.parameters.properties as any;

    // 修复前：items 只剩 { type: "array" }，元素形状全丢
    expect(props.items.type).toBe("array");
    expect(props.items.items).toBeDefined();
    expect(props.items.items.properties.name.type).toBe("string");
    expect(props.items.items.properties.qty.type).toBe("number");
    expect(props.meta.properties.tag.type).toBe("string");
  });

  it("与工具包版本的展平结果一致（两处不再分裂）", () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string() })),
    });

    const api = new PluginApiImpl(id, "Nested");
    api.registerTool({
      name: "top_tool",
      description: "x",
      inputSchema: schema,
      execute: async () => "ok",
    });
    const kit = api.registerToolKit({ id: "k", loadMode: "eager" });
    kit.registerTool({
      name: "kit_tool",
      description: "x",
      inputSchema: schema,
      execute: async () => "ok",
    });
    api.flush();

    const topProps = (PluginRegistry.getTools(id)[0].parameters.properties as any).items;
    const kitProps = (
      PluginRegistry.getToolKits(id)[0].tools[0].parameters.properties as any
    ).items;

    expect(topProps).toEqual(kitProps);
  });
});

describe("修复5: 本地命令跟随插件启停", () => {
  function seed(registry: LocalSlashCommandRegistry, pluginId: string) {
    registry.register(
      "demo-cmd",
      async () => ({ ok: true }),
      { description: "d", pluginId },
    );
  }

  it("插件启用时命令可列出且可执行", async () => {
    const registry = new LocalSlashCommandRegistry();
    registry.setEnabledResolver(() => true);
    seed(registry, "p1");

    expect(registry.list().map((c) => c.name)).toContain("demo-cmd");
    await expect(
      registry.dispatch("demo-cmd", { sessionId: "s", raw: "/demo-cmd" }),
    ).resolves.toEqual({ ok: true });
  });

  it("插件禁用后命令不再列出、也不可执行", async () => {
    const registry = new LocalSlashCommandRegistry();
    let enabled = true;
    registry.setEnabledResolver(() => enabled);
    seed(registry, "p1");

    enabled = false;
    expect(registry.list().map((c) => c.name)).not.toContain("demo-cmd");
    expect(registry.has("demo-cmd")).toBe(false);
    // dispatch 在调用 handler 前同步抛错（不进入 handler），所以用 toThrow 而非 rejects
    expect(() =>
      registry.dispatch("demo-cmd", { sessionId: "s", raw: "/demo-cmd" }),
    ).toThrow(/disabled/);
  });

  it("内置命令（无 pluginId）不受插件启停影响", async () => {
    const registry = new LocalSlashCommandRegistry();
    registry.setEnabledResolver(() => false); // 所有插件都禁用
    registry.register("builtin-cmd", async () => ({ ok: true }), { description: "b" });

    expect(registry.list().map((c) => c.name)).toContain("builtin-cmd");
    await expect(
      registry.dispatch("builtin-cmd", { sessionId: "s", raw: "/builtin-cmd" }),
    ).resolves.toEqual({ ok: true });
  });

  it("未注入 resolver 时保持旧行为（全部可用）", () => {
    const registry = new LocalSlashCommandRegistry();
    seed(registry, "p1");
    expect(registry.has("demo-cmd")).toBe(true);
    expect(registry.list().map((c) => c.name)).toContain("demo-cmd");
  });

  it("诊断接口仍能看到已禁用插件的命令", () => {
    const registry = new LocalSlashCommandRegistry();
    registry.setEnabledResolver(() => false);
    seed(registry, "p1");
    expect(registry.getByPlugin("p1").map((c) => c.name)).toEqual(["demo-cmd"]);
  });
});
