import {
  buildHttpContext,
  normalizeRoutePath,
  PluginHttpRegistry,
} from "./plugin-http.registry";

describe("PluginHttpRegistry", () => {
  let registry: PluginHttpRegistry;
  let enabled: Record<string, boolean>;

  beforeEach(() => {
    registry = new PluginHttpRegistry();
    enabled = {};
    registry.setEnabledResolver((id) => enabled[id] !== false);
  });

  const handler = () => undefined;

  it("matches exact paths per method", () => {
    registry.register("p1", { method: "GET", path: "api/ping", handler });
    expect(registry.match("p1", "GET", "api/ping")).toBeDefined();
    expect(registry.match("p1", "POST", "api/ping")).toBeUndefined();
    expect(registry.match("p1", "GET", "api/pong")).toBeUndefined();
  });

  it("captures :param segments", () => {
    registry.register("p1", { method: "GET", path: "api/items/:id", handler });
    const hit = registry.match("p1", "GET", "api/items/42");
    expect(hit?.params.id).toBe("42");
    expect(registry.match("p1", "GET", "api/items")).toBeUndefined();
  });

  it("supports a trailing wildcard", () => {
    registry.register("p1", { method: "GET", path: "files/*", handler });
    expect(registry.match("p1", "GET", "files/a/b/c")).toBeDefined();
    expect(registry.match("p1", "GET", "files")).toBeDefined();
  });

  it("prefers static segments over params", () => {
    registry.register("p1", { method: "GET", path: "api/items/:id", handler });
    registry.register("p1", { method: "GET", path: "api/items/count", handler });
    const hit = registry.match("p1", "GET", "api/items/count");
    expect(hit?.route.path).toBe("api/items/count");
  });

  it("supports method ALL", () => {
    registry.register("p1", { method: "ALL", path: "any", handler });
    expect(registry.match("p1", "GET", "any")).toBeDefined();
    expect(registry.match("p1", "DELETE", "any")).toBeDefined();
  });

  it("isolates routes per plugin", () => {
    registry.register("p1", { method: "GET", path: "x", handler });
    expect(registry.match("p2", "GET", "x")).toBeUndefined();
  });

  it("returns nothing while the plugin is disabled", () => {
    registry.register("p1", { method: "GET", path: "x", handler });
    enabled.p1 = false;
    expect(registry.match("p1", "GET", "x")).toBeUndefined();
  });

  it("clears routes on unregister", () => {
    registry.register("p1", { method: "GET", path: "x", handler });
    registry.unregisterPlugin("p1");
    expect(registry.countOf("p1")).toBe(0);
  });

  it("overrides a duplicate registration", () => {
    const first = jest.fn();
    const second = jest.fn();
    registry.register("p1", { method: "GET", path: "x", handler: first });
    registry.register("p1", { method: "GET", path: "x", handler: second });
    expect(registry.countOf("p1")).toBe(1);
    expect(registry.match("p1", "GET", "x")?.route.handler).toBe(second);
  });

  it("rejects bad paths and methods", () => {
    expect(() => registry.register("p1", { method: "GET", path: "", handler })).toThrow(
      /non-empty relative path/,
    );
    expect(() =>
      registry.register("p1", { method: "GET", path: "../etc/passwd", handler }),
    ).toThrow(/non-empty relative path/);
    expect(() =>
      registry.register("p1", { method: "GET", path: "/abs", handler }),
    ).not.toThrow(); // 前导斜杠被规范化
    expect(() =>
      registry.register("p1", { method: "TRACE" as any, path: "x", handler }),
    ).toThrow(/unsupported route method/);
  });
});

describe("normalizeRoutePath", () => {
  it("strips leading/trailing slashes", () => {
    expect(normalizeRoutePath("/api/x/")).toBe("api/x");
  });
  it("rejects traversal and empty segments", () => {
    expect(normalizeRoutePath("a/../b")).toBe("");
    expect(normalizeRoutePath("a//b")).toBe("");
  });
  it("allows a trailing star only", () => {
    expect(normalizeRoutePath("files/*")).toBe("files/*");
    expect(normalizeRoutePath("*/x")).toBe("");
  });
});

describe("buildHttpContext", () => {
  it("carries params, query, body and dataDir", () => {
    const ctx = buildHttpContext({
      pluginId: "p1",
      params: { id: "1" },
      query: { a: "b" },
      body: { x: 1 },
      dataDir: "/tmp/data",
      req: { method: "POST", url: "/plugins/p1/http/x?y=1" },
    });
    expect(ctx.pluginId).toBe("p1");
    expect(ctx.params.id).toBe("1");
    expect(ctx.query.a).toBe("b");
    expect(ctx.body).toEqual({ x: 1 });
    expect(ctx.dataDir).toBe("/tmp/data");
    expect(ctx.method).toBe("POST");
  });
});
