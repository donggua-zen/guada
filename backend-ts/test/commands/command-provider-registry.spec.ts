/**
 * CommandProviderRegistry + SnipCommandProvider
 *
 * 这两个模块此前无任何测试（执行层零覆盖之一）。注册表是纯逻辑、零依赖：
 * 校验 → 过滤 → 聚合，全部可同步断言；不需要临时目录或 DI。
 */
import { Logger } from "@nestjs/common";
import { CommandProviderRegistry } from "../../src/modules/commands/command-provider-registry.service";
import {
  ICommandProvider,
  CommandItem,
  CommandContext,
  ParserResult,
} from "../../src/modules/commands/interfaces/command-provider.interface";
import { SnipCommandProvider } from "../../src/modules/commands/providers/snip.provider";

/** 造一个最小 provider，未指定的部分给安全默认值 */
function makeProvider(
  base: Pick<ICommandProvider, "id" | "trigger"> & Partial<ICommandProvider>,
): ICommandProvider {
  return {
    fetchItems: () => [],
    parse: () => undefined,
    ...base,
  } as ICommandProvider;
}

describe("CommandProviderRegistry", () => {
  let registry: CommandProviderRegistry;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // 注册表在非法输入路径上会打日志，静音以保持输出干净
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    registry = new CommandProviderRegistry();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("register", () => {
    it("合法 id 注册成功并出现在 getProviders", () => {
      registry.register(makeProvider({ id: "skill", trigger: "slash" }));

      expect(registry.getProviders()).toEqual([{ id: "skill", trigger: "slash" }]);
    });

    it.each([
      ["含空格", "my cmd"],
      ["含点号", "my.cmd"],
      ["含中文", "命令"],
      ["空字符串", ""],
    ])("非法 id（%s）被跳过注册且不抛错", (_label, badId) => {
      expect(() =>
        registry.register(makeProvider({ id: badId, trigger: "slash" })),
      ).not.toThrow();

      expect(registry.getProviders()).toEqual([]);
      expect(errorSpy).toHaveBeenCalled();
    });

    it.each(["my-cmd", "a/b", "cmd_1", "CMD123"])(
      "允许字母数字下划线连字符与斜杠：%s 注册成功",
      (id) => {
        registry.register(makeProvider({ id, trigger: "slash" }));

        expect(registry.getProviders()).toEqual([{ id, trigger: "slash" }]);
      },
    );

    it("重复 id 覆盖更新（不是并存）", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      registry.register(
        makeProvider({ id: "dup", trigger: "slash", fetchItems: () => [{ name: "old", description: "旧" }] }),
      );
      registry.register(
        makeProvider({ id: "dup", trigger: "slash", fetchItems: () => [{ name: "new", description: "新" }] }),
      );

      expect(warnSpy).toHaveBeenCalled();
      const items = await registry.getItems("slash");
      expect(items.map((i) => i.name)).toEqual(["new"]);
    });
  });

  describe("getItems", () => {
    it("只返回 trigger 匹配的 provider", async () => {
      registry.register(
        makeProvider({ id: "s1", trigger: "slash", fetchItems: () => [{ name: "a", description: "" }] }),
      );
      registry.register(
        makeProvider({ id: "m1", trigger: "mention", fetchItems: () => [{ name: "b", description: "" }] }),
      );

      const slashItems = await registry.getItems("slash");

      expect(slashItems.map((i) => i.name)).toEqual(["a"]);
    });

    it("聚合项附带 providerId 与 trigger", async () => {
      registry.register(
        makeProvider({ id: "skill", trigger: "slash", fetchItems: () => [{ name: "coder", description: "编码" }] }),
      );

      const [item] = await registry.getItems("slash");

      expect(item).toMatchObject({ name: "coder", description: "编码", providerId: "skill", trigger: "slash" });
    });

    it("跳过非法 item name，但保留同一 provider 的合法 item", async () => {
      registry.register(
        makeProvider({
          id: "mixed",
          trigger: "slash",
          fetchItems: () => [
            { name: "ok", description: "" },
            { name: "has space", description: "" },
            { name: "", description: "" },
            { name: "also.ok", description: "" },
            { name: "fine-1", description: "" },
          ] as CommandItem[],
        }),
      );

      const items = await registry.getItems("slash");

      expect(items.map((i) => i.name)).toEqual(["ok", "fine-1"]);
      expect(errorSpy).toHaveBeenCalledTimes(3);
    });

    it("某个 provider 抛错被吞掉，其余 provider 照常返回", async () => {
      registry.register(
        makeProvider({
          id: "boom",
          trigger: "slash",
          fetchItems: () => {
            throw new Error("provider 内部炸了");
          },
        }),
      );
      registry.register(
        makeProvider({ id: "good", trigger: "slash", fetchItems: () => [{ name: "alive", description: "" }] }),
      );

      const items = await registry.getItems("slash");

      expect(items.map((i) => i.name)).toEqual(["alive"]);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("透传 ctx 给 fetchItems", async () => {
      const fetchItems = jest.fn(() => []);
      registry.register(makeProvider({ id: "ctx", trigger: "slash", fetchItems }));

      const ctx: CommandContext = { sessionId: "s-1", agentId: "coder", commandCount: 2 };
      await registry.getItems("slash", ctx);

      expect(fetchItems).toHaveBeenCalledWith(ctx);
    });

    it("未注册任何 provider 时返回空数组", async () => {
      await expect(registry.getItems("slash")).resolves.toEqual([]);
    });
  });

  describe("getParser", () => {
    it("未注册的 type 返回 undefined", () => {
      expect(registry.getParser("nope")).toBeUndefined();
    });

    it("provider 未实现 parse 时返回 undefined", () => {
      const noParse = { id: "bare", trigger: "slash", fetchItems: () => [] } as ICommandProvider;
      registry.register(noParse);

      expect(registry.getParser("bare")).toBeUndefined();
    });

    it("返回的函数可 await 且透传 attrs 与 ctx", async () => {
      const parse = jest.fn((attrs: Record<string, string>): ParserResult => ({
        replacement: `R:${attrs.name}`,
        appendix: "APP",
      }));
      registry.register(makeProvider({ id: "skill", trigger: "slash", parse }));

      const parser = registry.getParser("skill");
      const ctx: CommandContext = { sessionId: "s-1" };
      const result = await parser!({ name: "coder" }, ctx);

      expect(result).toEqual({ replacement: "R:coder", appendix: "APP" });
      expect(parse).toHaveBeenCalledWith({ name: "coder" }, ctx);
    });
  });

  describe("unregister / getProviders", () => {
    it("unregister 后不再出现在 getProviders 与 getItems 中", async () => {
      registry.register(
        makeProvider({ id: "temp", trigger: "slash", fetchItems: () => [{ name: "x", description: "" }] }),
      );
      registry.unregister("temp");

      expect(registry.getProviders()).toEqual([]);
      await expect(registry.getItems("slash")).resolves.toEqual([]);
    });

    it("unregister 不存在的 id 不抛错", () => {
      expect(() => registry.unregister("ghost")).not.toThrow();
    });
  });
});

describe("SnipCommandProvider", () => {
  let provider: SnipCommandProvider;

  beforeEach(() => {
    provider = new SnipCommandProvider();
  });

  it("fetchItems 返回空数组（snip 不出现在 picker）", () => {
    expect(provider.fetchItems()).toEqual([]);
  });

  it("parse 生成行内引用标记与含路径/行范围的 appendix", () => {
    const content = Buffer.from("const a = 1;", "utf-8").toString("base64");

    const result = provider.parse({
      path: "src/a.ts",
      start: "15",
      end: "22",
      content,
      label: "a.ts",
    });

    expect(result).toEqual({
      replacement: "`选区:a.ts`",
      appendix: "Snippet: src/a.ts L15-L22\nconst a = 1;",
    });
  });

  it("start 与 end 相同 → 单个 L 标记", () => {
    const result = provider.parse({ path: "a.ts", start: "7", end: "7" });

    expect(result!.appendix).toBe("Snippet: a.ts L7");
  });

  it("仅有 start → 单个 L 标记", () => {
    const result = provider.parse({ path: "a.ts", start: "7" });

    expect(result!.appendix).toBe("Snippet: a.ts L7");
  });

  it("无 start/end → 不带行范围", () => {
    const result = provider.parse({ path: "a.ts" });

    expect(result!.appendix).toBe("Snippet: a.ts");
  });

  it("label 缺省时回退到 path", () => {
    const result = provider.parse({ path: "src/b.ts" });

    expect(result!.replacement).toBe("`选区:src/b.ts`");
  });

  it("content 支持 UTF-8 选区文本（中文）解码", () => {
    const content = Buffer.from("中文选区内容", "utf-8").toString("base64");

    const result = provider.parse({ path: "a.ts", content });

    expect(result!.appendix).toBe("Snippet: a.ts\n中文选区内容");
  });

  it("content 含非法 base64 字符时不抛错（Buffer 忽略非法字符）", () => {
    // 注意：Buffer.from(x, "base64") 会静默忽略非法字符而非返回空串，
    // decodeBase64 的 try/catch 只是防御性兜底，这里只保证不把异常抛给调用方。
    expect(() => provider.parse({ path: "a.ts", content: "!!!not-base64!!!" })).not.toThrow();
  });

  it("content 为空时 appendix 不含尾随换行", () => {
    const result = provider.parse({ path: "a.ts", start: "1" });

    expect(result!.appendix!.endsWith("\n")).toBe(false);
  });
});
