import { generateDisplayMessage } from "../../src/modules/plugins/utils/display-formatter";
import { ToolCallRequest } from "../../src/modules/tools/interfaces/tool-provider.interface";
import { ToolHandlerDef } from "../../src/modules/plugins/types/plugin.types";

describe("generateDisplayMessage", () => {
  // ── 新 action/argsKey/icon 字段 ──

  describe("action/argsKey/icon fields", () => {
    it("should generate display with action prefix and isExecuting=true", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "test_tool",
        arguments: { url: "https://example.com" },
      };
      const toolEntry: ToolHandlerDef = {
        name: "test_tool",
        description: "Test",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "访问网页",
        argsKey: "url",
        icon: "browser",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.action).toBe("正在访问网页");
      expect(result.args).toBe("https://example.com");
      expect(result.toolType).toBe("browser");
    });

    it("should generate display with action prefix and isExecuting=false", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "test_tool",
        arguments: {},
      };
      const toolEntry: ToolHandlerDef = {
        name: "test_tool",
        description: "Test",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "写入文件",
        icon: "edit",
      };
      const result = generateDisplayMessage(request, false, undefined, toolEntry);
      expect(result.action).toBe("已写入文件");
      expect(result.toolType).toBe("edit");
    });

    it("should truncate long args", () => {
      const longUrl = "https://very-long-url.example.com/" + "x".repeat(100);
      const request: ToolCallRequest = {
        id: "r1",
        name: "navigate",
        arguments: { url: longUrl },
      };
      const toolEntry: ToolHandlerDef = {
        name: "navigate",
        description: "Nav",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "访问",
        argsKey: "url",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.args!.length).toBeLessThanOrEqual(63); // 60 + "..."
      expect(result.args).toContain("...");
    });

    it("should auto-pick first string arg when argsKey not set", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "execute",
        arguments: { command: "ls -la", encoding: "utf-8" },
      };
      const toolEntry: ToolHandlerDef = {
        name: "execute",
        description: "Exec",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "执行命令",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.action).toBe("正在执行命令");
      expect(result.args).toBe("ls -la");
    });

    it("should use icon as toolType", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "code_tool",
        arguments: {},
      };
      const toolEntry: ToolHandlerDef = {
        name: "code_tool",
        description: "Code",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "执行代码",
        icon: "code",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.toolType).toBe("code");
    });

    it("should use 'generic' as toolType when icon not set", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "generic_tool",
        arguments: {},
      };
      const toolEntry: ToolHandlerDef = {
        name: "generic_tool",
        description: "Generic",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "通用操作",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.toolType).toBe("generic");
    });
  });

  // ── tool_call 递归解析 ──

  describe("tool_call wrapper", () => {
    it("should unwrap tool_call and fallback to generic display", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "tool_call",
        arguments: {
          tool_name: "inner_tool",
          arguments: { file_path: "/tmp/test.txt" },
        },
      };
      // 解析后的 inner_tool 没有 toolEntry，走通用降级
      const result = generateDisplayMessage(request, true);
      expect(result.action).toBe("Inner Tool");
    });
  });

  // ── tool_load 展示 ──

  describe("tool_load display", () => {
    it("should generate display for tool_load", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "tool_load",
        arguments: { pluginId: "browser" },
      };
      const result = generateDisplayMessage(request, true);
      expect(result.action).toBe("正在加载工具");
      expect(result.args).toBe("browser");
    });
  });

  // ── 旧式 formatDisplayMessage 兼容 ──

  describe("legacy formatDisplayMessage fallback", () => {
    it("should use formatDisplayMessage when action not set", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "legacy_tool",
        arguments: { input: "data" },
      };
      const toolEntry: ToolHandlerDef = {
        name: "legacy_tool",
        description: "Legacy",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        formatDisplayMessage: (args: any, isExecuting: boolean) =>
          isExecuting ? `正在处理 ${args.input}` : `已处理 ${args.input}`,
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.action).toBe("正在处理 data");
    });
  });

  // ── 通用降级 ──

  describe("generic fallback", () => {
    it("should fallback to generic display when no action and no formatDisplayMessage", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "namespace__some_tool",
        arguments: { value: "test" },
      };
      const toolEntry: ToolHandlerDef = {
        name: "namespace__some_tool",
        description: "Some",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.action).toBe("Some Tool");
    });

    it("should handle errors gracefully", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "test",
        arguments: null as any,
      };
      // 传入 null arguments 应被 catch 捕获
      const result = generateDisplayMessage(request, true);
      expect(result.action).toBeDefined();
    });
  });

  // ── args 取值 ──

  describe("args extraction", () => {
    it("should use raw value from argsKey", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "read",
        arguments: { file_path: "/home/user/documents/report.pdf" },
      };
      const toolEntry: ToolHandlerDef = {
        name: "read",
        description: "Read",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "读取文件",
        argsKey: "file_path",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      expect(result.args).toBe("/home/user/documents/report.pdf");
    });

    it("should auto-pick first string arg when no argsKey", () => {
      const request: ToolCallRequest = {
        id: "r1",
        name: "read",
        arguments: { file_path: "/home/user/doc.txt" },
      };
      const toolEntry: ToolHandlerDef = {
        name: "read",
        description: "Read",
        parameters: { type: "object", properties: {} },
        handler: async () => "ok",
        action: "读取文件",
      };
      const result = generateDisplayMessage(request, true, undefined, toolEntry);
      // 无 argsKey 时提取文件名
      expect(result.args).toBe("doc.txt");
    });
  });
});
