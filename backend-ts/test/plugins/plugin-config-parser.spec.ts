import { PluginConfigParser } from "../../src/modules/plugins/utils/plugin-config-parser";

describe("PluginConfigParser", () => {
  describe("normalizeEntry", () => {
    it("返回默认值当输入为 undefined", () => {
      const result = PluginConfigParser.normalizeEntry(undefined);
      expect(result.enabled).toBe(false);
      expect(result.toolkits_filter).toBe("deny");
      expect(result.toolkits_deny).toEqual([]);
      expect(result.toolkits_allow).toEqual([]);
    });

    it("返回默认值当输入为 null", () => {
      const result = PluginConfigParser.normalizeEntry(null as any);
      expect(result.enabled).toBe(false);
    });

    it("兼容旧格式 boolean true", () => {
      expect(PluginConfigParser.normalizeEntry(true as any).enabled).toBe(true);
    });

    it("兼容旧格式 boolean false", () => {
      expect(PluginConfigParser.normalizeEntry(false as any).enabled).toBe(false);
    });

    it("兼容旧格式 string 'true' / 'false'", () => {
      expect(PluginConfigParser.normalizeEntry("true" as any).enabled).toBe(true);
      expect(PluginConfigParser.normalizeEntry("false" as any).enabled).toBe(false);
    });

    it("解析新格式 enabled: false", () => {
      const result = PluginConfigParser.normalizeEntry({ enabled: false });
      expect(result.enabled).toBe(false);
      expect(result.toolkits_filter).toBe("deny");
    });

    it("解析新格式 toolkits_filter: allow", () => {
      const result = PluginConfigParser.normalizeEntry({
        toolkits_filter: "allow" as const,
        toolkits_allow: ["mcp_srv1"],
      });
      expect(result.toolkits_filter).toBe("allow");
      expect(result.toolkits_allow).toEqual(["mcp_srv1"]);
      expect(result.enabled).toBe(true);
    });

    it("解析新格式 toolkits_filter: deny + toolkits_deny", () => {
      const result = PluginConfigParser.normalizeEntry({
        toolkits_filter: "deny" as const,
        toolkits_deny: ["mcp_srv2"],
      });
      expect(result.toolkits_filter).toBe("deny");
      expect(result.toolkits_deny).toEqual(["mcp_srv2"]);
    });

    it("toolkits_filter 默认值为 deny", () => {
      const result = PluginConfigParser.normalizeEntry({ enabled: true });
      expect(result.toolkits_filter).toBe("deny");
    });

    it("保留 params", () => {
      const result = PluginConfigParser.normalizeEntry({
        params: { key: "val" },
      });
      expect(result.params).toEqual({ key: "val" });
    });
  });

  describe("normalize", () => {
    it("返回空对象当输入为 undefined", () => {
      expect(PluginConfigParser.normalize(undefined)).toEqual({});
    });

    it("保留 __strategy 和 __default 系统字段", () => {
      const result = PluginConfigParser.normalize({
        __strategy: "deny_nonsystem" as const,
        __default: false,
        browser: { enabled: true },
      });
      expect(result.__strategy).toBe("deny_nonsystem");
      expect(result.__default).toBe(false);
    });

    it("规范化所有插件条目", () => {
      const result = PluginConfigParser.normalize({
        browser: { enabled: true },
        file: { enabled: false, toolkits_filter: "allow" as const },
      });
      const browser = result.browser as any;
      const file = result.file as any;
      expect(browser?.enabled).toBe(true);
      expect(file?.enabled).toBe(false);
      expect(file?.toolkits_filter).toBe("allow");
    });
  });

  describe("isEnabled", () => {
    it("返回 defaultEnabled 当 entry 为 undefined", () => {
      expect(PluginConfigParser.isEnabled(undefined, true)).toBe(true);
      expect(PluginConfigParser.isEnabled(undefined, false)).toBe(false);
    });

    it("enabled !== false 视为启用", () => {
      expect(PluginConfigParser.isEnabled({ enabled: true }, false)).toBe(true);
      expect(PluginConfigParser.isEnabled({ enabled: false }, true)).toBe(false);
    });

    it("enabled 默认启用", () => {
      expect(PluginConfigParser.isEnabled({}, false)).toBe(true);
    });
  });
});
