import { PluginApiImpl } from "./plugin-api";
import { PluginRegistry } from "../registry/plugin-registry";

/**
 * v3：主题与皮肤统一
 * - registerTheme 支持纯 CSS 与「富主题」（runtimeScript / assetBase / settings）
 * - registerSkin 是 registerTheme 的别名（兼容旧插件）
 * - getSkins 只返回富主题
 */
describe("PluginApi theme/skin unification", () => {
  const id = "theme-plugin";

  afterEach(() => {
    PluginRegistry.clearPlugin(id);
  });

  function makeApi() {
    return new PluginApiImpl(id, "Theme", undefined, undefined, "user");
  }

  it("accepts a pure CSS theme", () => {
    const api = makeApi();
    api.registerTheme({ id: "neon", name: "Neon", cssFile: "themes/neon.css" });
    const [theme] = api.getSkins();
    expect(theme).toBeUndefined(); // 纯 CSS 主题不算富主题
    api.flush();
    expect(PluginRegistry.getThemes(id).map((t) => t.id)).toEqual(["neon"]);
    expect(PluginRegistry.getSkins(id)).toEqual([]);
  });

  it("accepts a rich theme and exposes it via getSkins", () => {
    const api = makeApi();
    api.registerTheme({
      id: "maid",
      name: "Maid",
      cssFiles: { light: "l.css", dark: "d.css" },
      runtimeScript: "runtime.js",
      assetBase: "assets",
      bodyAttribute: "data-gd-theme-maid",
      settings: [{ key: "tint", label: "Tint", type: "select" }],
    });
    api.flush();
    expect(PluginRegistry.getThemes(id).map((t) => t.id)).toEqual(["maid"]);
    expect(PluginRegistry.getSkins(id).map((t) => t.id)).toEqual(["maid"]);
  });

  it("registerSkin is an alias for registerTheme", () => {
    const api = makeApi();
    api.registerSkin({ id: "alias", name: "Alias", cssFile: "a.css" });
    api.flush();
    expect(PluginRegistry.getThemes(id).map((t) => t.id)).toEqual(["alias"]);
  });

  it("normalizes a single cssFile into light/dark", () => {
    const api = makeApi();
    api.registerTheme({ id: "x", name: "X", cssFile: "x.css" });
    api.flush();
    expect(PluginRegistry.getThemes(id)[0].cssFiles).toEqual({
      light: "x.css",
      dark: "x.css",
    });
  });

  it("is idempotent per id", () => {
    const api = makeApi();
    api.registerTheme({ id: "y", name: "Y", cssFile: "y.css" });
    api.registerTheme({ id: "y", name: "Y again", cssFile: "y2.css" });
    expect(api.getSkins().length + 0).toBe(0);
    api.flush();
    expect(PluginRegistry.getThemes(id)).toHaveLength(1);
    expect(PluginRegistry.getThemes(id)[0].cssFiles?.light).toBe("y.css");
  });

  it("rejects a theme with neither css nor runtime", () => {
    const api = makeApi();
    expect(() => api.registerTheme({ id: "bad", name: "Bad" })).toThrow(
      /must declare cssFile/,
    );
  });

  it("rejects a theme without an id", () => {
    const api = makeApi();
    expect(() => api.registerTheme({ id: "", name: "NoId" } as any)).toThrow(/requires an id/);
  });
});
