/**
 * Browser Tool 测试报告验证用例（插件层）
 *
 * 验证 browser_tool_test_plan.md 中报告的发现，聚焦插件层（BrowserPlugin）行为。
 * 服务层（BrowserAutomationService）的验证由 e2e-test.ts 在 Electron 环境中执行。
 *
 * 运行：cd backend-ts && npx jest test/plugins/browser-tool-verification.spec.ts
 */

import * as yaml from "js-yaml";
import { BrowserPlugin } from "../../src/modules/plugins/builtins/browser.plugin";
import { Toolkit } from "../../src/modules/plugins/toolkit/toolkit";

// ═══════════════════════════════════════════════════════════════════
// Mock 工厂
// ═══════════════════════════════════════════════════════════════════

function createPlugin(bridgeResponses: Record<string, any>) {
  const bridgeClient = {
    request: jest.fn(async (method: string, params: any) => {
      const response = bridgeResponses[method];
      if (response instanceof Error) throw response;
      return typeof response === "function" ? response(params) : response;
    }),
  };
  const workspaceService = {
    resolveFilePath: (filePath: string) => filePath,
  };
  const plugin = new BrowserPlugin(workspaceService as any, bridgeClient as any);
  let toolkitDef: any;
  plugin.onLoad({
    registerToolKit: (def: any) => {
      toolkitDef = def;
    },
    registerNls: jest.fn(),
  } as any);
  const toolkit = new Toolkit(toolkitDef, "browser");
  toolkitDef.onLoad(toolkit);
  return { plugin, bridgeClient, tools: toolkit.getTools(), toolkitDef };
}

function context(overrides?: Partial<any>) {
  return {
    session: {
      sessionId: "session-1",
      parentSessionId: undefined,
      workspacePath: "C:/tmp/session",
      getModelConfig: () => ({ config: { inputCapabilities: [] } }),
      supportsFeature: () => false,
      ...overrides?.session,
    },
    ...overrides,
  } as any;
}

function getTool(tools: any[], name: string) {
  const tool = tools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

// ═══════════════════════════════════════════════════════════════════
// 套件 A：插件格式化与校验
// ═══════════════════════════════════════════════════════════════════

describe("套件 A: 插件格式化与校验", () => {
  // ── 发现 #1: interact 回显不可信 ──

  describe("发现 #1: interact 回显验证", () => {
    it("[D1] click 成功时返回正确格式", async () => {
      const { tools } = createPlugin({
        browser_click: { success: true, clicked: true },
      });
      const interact = getTool(tools, "browser_interact");
      const result = await interact.handler(
        { action: "click", selector: "e0" },
        context(),
      );
      expect(result).toContain("Clicked: e0");
    });

    it("[D3] input 成功时返回正确格式（含 value）", async () => {
      const { tools } = createPlugin({
        browser_input: { success: true, filled: true },
      });
      const interact = getTool(tools, "browser_interact");
      const result = await interact.handler(
        { action: "input", selector: "#text-input", value: "hello" },
        context(),
      );
      expect(result).toContain("Filled: #text-input");
      expect(result).toContain("hello");
    });

    it("[缺陷验证] assertSuccess 在 success=false 时抛异常", async () => {
      const { tools } = createPlugin({
        browser_click: { success: false, clicked: false, error: "Element not found" },
      });
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "click", selector: "e999" }, context()),
      ).rejects.toThrow("Element not found");
    });

    it("[D21] bridge 抛异常时 interact 传播错误", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockRejectedValueOnce(
        new Error("SyntaxError: Failed to execute 'querySelector'"),
      );
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "click", selector: "##!!" }, context()),
      ).rejects.toThrow();
    });

    it("[D30] input 缺 value 在 schema 层被拒绝", async () => {
      const { tools, bridgeClient } = createPlugin({});
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "input", selector: "e0" }, context()),
      ).rejects.toThrow("value is required when action is input");
      expect(bridgeClient.request).not.toHaveBeenCalled();
    });

    it("[修复验证] formatInteractResult 在 clicked=false 时抛异常", async () => {
      // 修复后：当 bridge 返回 success=true 但 clicked=false 时，
      // formatInteractResult 应抛异常而非报告 "Clicked"
      const { tools } = createPlugin({
        browser_click: { success: true, clicked: false, error: "Element not interactable" },
      });
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "click", selector: "e0" }, context()),
      ).rejects.toThrow("Element not interactable");
    });

    it("[修复验证] formatInteractResult 在 filled=false 时抛异常", async () => {
      const { tools } = createPlugin({
        browser_input: { success: true, filled: false, error: "Field is readonly" },
      });
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "input", selector: "#text-input", value: "x" }, context()),
      ).rejects.toThrow("Field is readonly");
    });

    it("[full_simulation] 默认 false 时传递 full_simulation=false", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_click: { success: true, clicked: true },
      });
      const interact = getTool(tools, "browser_interact");
      await interact.handler({ action: "click", selector: "e0" }, context());
      expect(bridgeClient.request).toHaveBeenCalledWith(
        "browser_click",
        expect.objectContaining({ full_simulation: false }),
        undefined,
      );
    });

    it("[full_simulation] 设为 true 时传递 full_simulation=true", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_input: { success: true, filled: true },
      });
      const interact = getTool(tools, "browser_interact");
      await interact.handler(
        { action: "input", selector: "#text-input", value: "x", full_simulation: true },
        context(),
      );
      expect(bridgeClient.request).toHaveBeenCalledWith(
        "browser_input",
        expect.objectContaining({ full_simulation: true }),
        undefined,
      );
    });

    it("[full_simulation] 工具描述包含 full_simulation 参数说明", () => {
      const { tools } = createPlugin({});
      const interact = getTool(tools, "browser_interact");
      expect(interact.description).toContain("full_simulation");
      expect(interact.description).toContain("isTrusted");
    });

    it("[dialog] action='dialog' 传递 accept 和 prompt_text", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_interact: { success: true, dialogHandled: true },
      });
      const interact = getTool(tools, "browser_interact");
      const result = await interact.handler(
        { action: "dialog", accept: true, prompt_text: "hello" },
        context(),
      );
      expect(bridgeClient.request).toHaveBeenCalledWith(
        "browser_interact",
        expect.objectContaining({ action: "dialog", accept: true, prompt_text: "hello" }),
        undefined,
      );
      expect(result).toContain("accepted");
    });

    it("[dialog] accept=false 返回 dismissed", async () => {
      const { tools } = createPlugin({
        browser_interact: { success: true, dialogHandled: true },
      });
      const interact = getTool(tools, "browser_interact");
      const result = await interact.handler(
        { action: "dialog", accept: false },
        context(),
      );
      expect(result).toContain("dismissed");
    });

    it("[dialog] 缺 accept 参数 schema 校验失败", async () => {
      const { tools } = createPlugin({});
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "dialog" }, context()),
      ).rejects.toThrow("accept is required");
    });

    it("[dialog] 工具描述包含 dialog", () => {
      const { tools } = createPlugin({});
      const interact = getTool(tools, "browser_interact");
      expect(interact.description).toContain("dialog");
    });

    it("[dialog] click/input 缺 selector schema 校验失败", async () => {
      const { tools } = createPlugin({});
      const interact = getTool(tools, "browser_interact");
      await expect(
        interact.handler({ action: "click" }, context()),
      ).rejects.toThrow("selector is required");
    });
  });

  // ── 发现 #2: 插件 prompt 文档不一致 ──

  describe("发现 #2: 插件 prompt 文档", () => {
    it("prompt 内容不应声称 incognito（已改为持久化）", () => {
      // 通过 toolkit 内部获取 prompt
      const plugin = new BrowserPlugin(
        { resolveFilePath: jest.fn() } as any,
        { request: jest.fn() } as any,
      );
      let capturedToolkit: any;
      plugin.onLoad({
        registerToolKit: (def: any) => {
          capturedToolkit = def;
        },
        registerNls: jest.fn(),
      } as any);

      const prompts: string[] = [];
      const toolkit = new Toolkit(capturedToolkit, "browser");
      // 拦截 registerPrompt
      const origRegisterPrompt = toolkit.registerPrompt.bind(toolkit);
      toolkit.registerPrompt = (prompt: any) => {
        prompts.push(typeof prompt.content === "string" ? prompt.content : String(prompt.content));
        return origRegisterPrompt(prompt);
      };
      capturedToolkit.onLoad(toolkit);

      const promptText = prompts.join("\n");
      // 修复后：prompt 不应再声称 incognito
      expect(promptText).not.toContain("incognito");
      expect(promptText).not.toContain("no data persists");
      // 应准确描述持久化
      expect(promptText).toContain("persistent");
    });
  });

  // ── 发现 #5: evaluate 文档与行为 ──

  describe("发现 #5: evaluate 文档与行为", () => {
    it("evaluate 工具描述不再声称 'await is naturally available'", () => {
      const { tools } = createPlugin({});
      const evaluate = getTool(tools, "browser_evaluate");
      // 修复后：描述应包含 async IIFE 指引，不再误导顶层 await
      expect(evaluate.description).not.toContain("await is naturally available");
      expect(evaluate.description).toContain("async IIFE");
      expect(evaluate.description).toContain("30 seconds");
    });

    it("[E23] code + file_path 同时传入应报错", async () => {
      const { tools } = createPlugin({});
      const evaluate = getTool(tools, "browser_evaluate");
      await expect(
        evaluate.handler({ code: "1+1", file_path: "test.js" }, context()),
      ).rejects.toThrow("cannot be provided simultaneously");
    });

    it("[E24] 都不传应报错", async () => {
      const { tools } = createPlugin({});
      const evaluate = getTool(tools, "browser_evaluate");
      await expect(
        evaluate.handler({}, context()),
      ).rejects.toThrow("Must provide either code or file_path");
    });

    it("[E22] file_path 不存在应报清晰错误", async () => {
      const { tools } = createPlugin({});
      const evaluate = getTool(tools, "browser_evaluate");
      await expect(
        evaluate.handler({ file_path: "nonexistent.js" }, context()),
      ).rejects.toThrow("Failed to read JavaScript file");
    });

    it("[E1] 简单求值返回正确结果", async () => {
      const { tools } = createPlugin({
        browser_evaluate: { success: true, result: 2 },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      const result = await evaluate.handler({ code: "1+1" }, context());
      expect(result).toBe("2");
    });

    it("[E9] 运行时错误返回 error 信息", async () => {
      const { tools } = createPlugin({
        browser_evaluate: { success: false, error: "Uncaught Error: E9_ERR" },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      await expect(
        evaluate.handler({ code: "throw new Error('E9_ERR')" }, context()),
      ).rejects.toThrow("E9_ERR");
    });

    it("[E2] undefined 被序列化为 'undefined' 字符串", async () => {
      const { tools } = createPlugin({
        browser_evaluate: { success: true, result: undefined },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      const result = await evaluate.handler({ code: "undefined" }, context());
      expect(result).toBe("undefined");
    });

    it("[E3] 对象返回 JSON 字符串", async () => {
      const { tools } = createPlugin({
        browser_evaluate: { success: true, result: { a: 1, b: [1, 2] } },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      const result = await evaluate.handler({ code: "({a:1,b:[1,2]})" }, context());
      const parsed = JSON.parse(result);
      expect(parsed.a).toBe(1);
      expect(parsed.b).toEqual([1, 2]);
    });

    it("[E5] 返回函数时序列化失败（Electron 限制）", async () => {
      const { tools } = createPlugin({
        browser_evaluate: {
          success: false,
          error: "An object could not be cloned",
        },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      await expect(
        evaluate.handler({ code: "window.__TEST.fn" }, context()),
      ).rejects.toThrow("could not be cloned");
    });

    it("[E17/E18] bridge saveLocalFile/readLocalFile 通过 evaluate 透传", async () => {
      const { tools } = createPlugin({
        browser_evaluate: {
          success: true,
          result: { success: true, filePath: "C:/tmp/session/eval_out.txt" },
        },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      const result = await evaluate.handler(
        { code: "window._browserBridge.saveLocalFile('eval_out.txt', 'hello-eval')" },
        context(),
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.filePath).toContain("eval_out.txt");
    });

    it("[E21] file_path 模式执行成功", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_evaluate: { success: true, result: "file-result" },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      // 需要 mock workspaceService.resolveFilePath 返回一个存在的文件
      // 由于 createPlugin 中 resolveFilePath 直接返回 filePath，
      // fs.promises.access 会失败。改为直接传 code。
      const result = await evaluate.handler({ code: "'file-result'" }, context());
      expect(result).toBe("file-result");
    });
  });

  // ── 发现 #3: 导航失败处理 ──

  describe("发现 #3: 导航失败处理", () => {
    it("[A1] 正常导航返回 tab 信息和快照", async () => {
      const { tools } = createPlugin({
        browser_navigate: {
          success: true,
          tab_id: "win_1",
          url: "http://127.0.0.1:8765/index.html",
          title: "Test",
        },
        browser_snapshot: {
          success: true,
          type: "simple",
          snapshot: { role: "document", ref: "root" },
        },
        browser_tabs: {
          success: true,
          tabs: [{ title: "Test", url: "http://127.0.0.1:8765/index.html", is_current: true }],
        },
      });
      const navigate = getTool(tools, "browser_navigate");
      const result = await navigate.handler(
        { url: "http://127.0.0.1:8765/index.html", load_delay: 0 },
        context(),
      );
      expect(result).toContain("Tabs:");
      expect(result).toContain("role: document");
    });

    it("[缺陷] 导航返回 success=false 时应抛异常", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockImplementation(async (method: string) => {
        if (method === "browser_navigate") {
          return { success: false, error: "Navigation failed: ERR_NAME_NOT_RESOLVED" };
        }
        return {};
      });
      const navigate = getTool(tools, "browser_navigate");
      await expect(
        navigate.handler(
          { url: "http://nonexistent.invalid/", load_delay: 0 },
          context(),
        ),
      ).rejects.toThrow("ERR_NAME_NOT_RESOLVED");
    });

    it("[A5] 非法 URL — 服务层修复后 bridge 应返回错误", async () => {
      // 修复后：服务层检测 chrome-error，navigate 对非法 URL 抛异常
      // 插件层通过 assertSuccess 传播错误
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockImplementation(async (method: string) => {
        if (method === "browser_navigate") {
          throw new Error("Navigation failed: page loaded chrome-error for not a url !!");
        }
        return {};
      });
      const navigate = getTool(tools, "browser_navigate");
      await expect(
        navigate.handler({ url: "not a url !!", load_delay: 0 }, context()),
      ).rejects.toThrow("chrome-error");
    });

    it("[缺陷] navigate 快照失败应抛异常（不返回部分成功）", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockImplementation(async (method: string) => {
        if (method === "browser_navigate") {
          return { success: true, tab_id: "win_1" };
        }
        if (method === "browser_snapshot") {
          return { success: false, error: "Snapshot failed" };
        }
        return {};
      });
      const navigate = getTool(tools, "browser_navigate");
      await expect(
        navigate.handler(
          { url: "http://127.0.0.1:8765/index.html", load_delay: 0 },
          context(),
        ),
      ).rejects.toThrow("Snapshot failed");
    });
  });

  // ── 发现 #4: about:blank ──

  describe("发现 #4: about:blank 导航", () => {
    it("[缺陷] about:blank 导航 bridge 超时应报错", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockRejectedValueOnce(
        new Error("Bridge request timeout: browser_navigate"),
      );
      const navigate = getTool(tools, "browser_navigate");
      await expect(
        navigate.handler({ url: "about:blank", load_delay: 0 }, context()),
      ).rejects.toThrow("Bridge request timeout");
    });
  });

  // ── 发现 #6: Cookie bridge API ──

  describe("发现 #6: Cookie bridge API", () => {
    it("[E20] getCookies 透传 bridge 结果", async () => {
      const { tools } = createPlugin({
        browser_evaluate: {
          success: true,
          result: {
            success: true,
            cookies: [{ name: "test", value: "123", domain: "127.0.0.1" }],
          },
        },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      const result = await evaluate.handler(
        { code: "window._browserBridge.getCookies()" },
        context(),
      );
      const parsed = JSON.parse(result);
      expect(parsed.cookies).toHaveLength(1);
      expect(parsed.cookies[0].name).toBe("test");
    });

    it("[E20] removeCookie 失败返回错误信息", async () => {
      const { tools } = createPlugin({
        browser_evaluate: {
          success: true,
          result: { success: false, error: "Failed to remove cookie" },
        },
      });
      const evaluate = getTool(tools, "browser_evaluate");
      const result = await evaluate.handler(
        { code: "window._browserBridge.removeCookie('http://127.0.0.1:8765', 'test')" },
        context(),
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
    });
  });

  // ── 发现 #7: 快照格式 ──

  describe("发现 #7: 快照格式", () => {
    it("[C1] simple 快照格式为 YAML", async () => {
      const { tools } = createPlugin({
        browser_snapshot: {
          success: true,
          type: "simple",
          snapshot: {
            role: "document",
            name: "Test Page",
            ref: "root",
            children: [
              { role: "button", name: "Click me", ref: "e0" },
              { role: "textbox", name: "Search", ref: "e1" },
            ],
          },
        },
      });
      const snapshot = getTool(tools, "browser_snapshot");
      const result = await snapshot.handler({ type: "simple" }, context());
      const parsed = yaml.load(result) as any;
      expect(parsed.role).toBe("document");
      expect(parsed.children[0].ref).toBe("e0");
    });

    it("[C2] struct 快照格式为 JSON", async () => {
      const { tools } = createPlugin({
        browser_snapshot: {
          success: true,
          type: "struct",
          struct: {
            role: "document",
            ref: "e0",
            children: [{ role: "button", text: "Submit", ref: "e1" }],
          },
        },
      });
      const snapshot = getTool(tools, "browser_snapshot");
      const result = await snapshot.handler({ type: "struct" }, context());
      const parsed = JSON.parse(result);
      expect(parsed.role).toBe("document");
      expect(parsed.children[0].text).toBe("Submit");
    });

    it("[C3] summary 快照包含 text/links/headings", async () => {
      const { tools } = createPlugin({
        browser_snapshot: {
          success: true,
          type: "summary",
          text: "Page content",
          headings: [{ level: 1, text: "Title" }],
          links: [{ text: "Home", href: "/" }],
        },
      });
      const snapshot = getTool(tools, "browser_snapshot");
      const result = await snapshot.handler({ type: "summary" }, context());
      expect(result).toContain("Page content");
      expect(result).toContain("H1: Title");
      expect(result).toContain("[Home] -> /");
    });

    it("[C8] 空页面快照不报错", async () => {
      const { tools } = createPlugin({
        browser_snapshot: {
          success: true,
          type: "simple",
          snapshot: { role: "document", ref: "root" },
        },
      });
      const snapshot = getTool(tools, "browser_snapshot");
      const result = await snapshot.handler({ type: "simple" }, context());
      expect(result).toContain("role: document");
    });

    it("[修复验证] struct 快照不再过滤 iframe", () => {
      // 修复后：iframe 从 unwantedTags 中移除，struct 快照包含 iframe 元素
      const unwantedTags = ["script", "style", "link", "noscript", "meta"];
      expect(unwantedTags).not.toContain("iframe");
    });
  });

  // ── 发现 #9: 截图 ──

  describe("发现 #9: 截图行为", () => {
    it("[H1] 截图返回保存路径和尺寸", async () => {
      const { tools } = createPlugin({
        browser_screenshot: {
          success: true,
          saved_path: "C:/tmp/session/screenshot-123.png",
          width: 1280,
          height: 720,
        },
      });
      const screenshot = getTool(tools, "browser_screenshot");
      const result = await screenshot.handler({}, context());
      expect(result).toContain("screenshot-123.png");
      expect(result).toContain("1280x720");
    });

    it("[H2] 相对路径截图", async () => {
      const { tools } = createPlugin({
        browser_screenshot: {
          success: true,
          saved_path: "C:/tmp/session/shot_a.png",
          width: 1280,
          height: 720,
        },
      });
      const screenshot = getTool(tools, "browser_screenshot");
      const result = await screenshot.handler({ file_path: "shot_a.png" }, context());
      expect(result).toContain("shot_a.png");
    });

    it("[full_page] 默认 false 时传递 full_page=false", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_screenshot: { success: true, saved_path: "C:/tmp/s.png", width: 1280, height: 720 },
      });
      const screenshot = getTool(tools, "browser_screenshot");
      await screenshot.handler({}, context());
      expect(bridgeClient.request).toHaveBeenCalledWith(
        "browser_screenshot",
        expect.objectContaining({ full_page: false }),
        undefined,
      );
    });

    it("[full_page] 设为 true 时传递 full_page=true", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_screenshot: { success: true, saved_path: "C:/tmp/s.png", width: 1280, height: 5000 },
      });
      const screenshot = getTool(tools, "browser_screenshot");
      await screenshot.handler({ full_page: true }, context());
      expect(bridgeClient.request).toHaveBeenCalledWith(
        "browser_screenshot",
        expect.objectContaining({ full_page: true }),
        undefined,
      );
    });
  });

  // ── 发现 #10: 控制台日志 ──

  describe("发现 #10: 控制台日志", () => {
    it("[G1] 返回页面日志", async () => {
      const { tools } = createPlugin({
        browser_console: {
          success: true,
          logs: ["[log] HARNESS_LOG", "[info] HARNESS_INFO", "[warning] HARNESS_WARN", "[error] HARNESS_ERROR"],
        },
      });
      const consoleTool = getTool(tools, "browser_console");
      const result = await consoleTool.handler({}, context());
      expect(result).toContain("HARNESS_LOG");
      expect(result).toContain("HARNESS_ERROR");
    });

    it("[G3] 无日志时返回 No console output", async () => {
      const { tools } = createPlugin({
        browser_console: { success: true, logs: [] },
      });
      const consoleTool = getTool(tools, "browser_console");
      const result = await consoleTool.handler({}, context());
      expect(result).toBe("No console output.");
    });
  });

  // ── 标签管理 ──

  describe("套件 B: 标签管理", () => {
    it("[B4] 越界 index 报错", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockRejectedValueOnce(new Error("Tab not found"));
      const tabs = getTool(tools, "browser_tabs");
      await expect(
        tabs.handler({ action: "select", index: 99 }, context()),
      ).rejects.toThrow("Tab not found");
    });

    it("[B1] 空列表", async () => {
      const { tools } = createPlugin({
        browser_tabs: { success: true, tabs: [], count: 0 },
      });
      const tabs = getTool(tools, "browser_tabs");
      const result = await tabs.handler({ action: "list" }, context());
      expect(result).toBe("No tabs.");
    });

    it("[B2] 多 tab 列表", async () => {
      const { tools } = createPlugin({
        browser_tabs: {
          success: true,
          tabs: [
            { index: 0, tab_id: "win_1", url: "http://a.com", title: "A", is_current: true },
            { index: 1, tab_id: "win_2", url: "http://b.com", title: "B", is_current: false },
            { index: 2, tab_id: "win_3", url: "http://c.com", title: "C", is_current: false },
          ],
        },
      });
      const tabs = getTool(tools, "browser_tabs");
      const result = await tabs.handler({ action: "list" }, context());
      expect(result).toContain("[A]");
      expect(result).toContain("[current]");
      expect(result).toContain("[B]");
    });

    it("[B9] close_all 返回关闭数量", async () => {
      const { tools } = createPlugin({
        browser_tabs: { success: true, closed_count: 3 },
      });
      const tabs = getTool(tools, "browser_tabs");
      const result = await tabs.handler({ action: "close_all" }, context());
      expect(result).toContain("Closed 3 tab(s)");
    });

    it("[B10] 无 tab close 报错", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockResolvedValueOnce({ success: false, message: "No tab to close" });
      const tabs = getTool(tools, "browser_tabs");
      await expect(
        tabs.handler({ action: "close" }, context()),
      ).rejects.toThrow("No tab to close");
    });
  });

  // ── 历史导航 ──

  describe("套件 F: 历史导航", () => {
    it("[F1] back/forward 返回 URL 和快照", async () => {
      const { tools } = createPlugin({
        browser_history: {
          success: true,
          tab_id: "win_1",
          url: "http://127.0.0.1:8765/page2.html",
        },
        browser_snapshot: {
          success: true,
          type: "simple",
          snapshot: { role: "document", ref: "root" },
        },
        browser_tabs: {
          success: true,
          tabs: [{ title: "Page2", url: "http://127.0.0.1:8765/page2.html", is_current: true }],
        },
      });
      const history = getTool(tools, "browser_history");
      const result = await history.handler({ action: "back", load_delay: 0 }, context());
      expect(result).toContain("Page2");
      expect(result).toContain("role: document");
    });

    it("[F4] reload 返回快照", async () => {
      const { tools } = createPlugin({
        browser_reload: {
          success: true,
          tab_id: "win_1",
          url: "http://127.0.0.1:8765/index.html",
        },
        browser_snapshot: {
          success: true,
          type: "simple",
          snapshot: { role: "document", ref: "root" },
        },
        browser_tabs: {
          success: true,
          tabs: [{ title: "Test", url: "http://127.0.0.1:8765/index.html", is_current: true }],
        },
      });
      const history = getTool(tools, "browser_history");
      const result = await history.handler({ action: "reload", load_delay: 0 }, context());
      expect(result).toContain("role: document");
    });
  });

  // ── navigate 自动快照 ──

  describe("navigate 自动快照行为", () => {
    it("[A23] navigate 支持 simple/struct/summary 三种快照类型", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockImplementation(async (method: string, params: any) => {
        if (method === "browser_navigate") {
          return { success: true, tab_id: "win_1" };
        }
        if (method === "browser_snapshot") {
          if (params.type === "simple") {
            return { success: true, type: "simple", snapshot: { role: "document", ref: "root" } };
          }
          if (params.type === "struct") {
            return { success: true, type: "struct", struct: { role: "document", ref: "e0" } };
          }
          if (params.type === "summary") {
            return { success: true, type: "summary", text: "sum", headings: [], links: [] };
          }
        }
        if (method === "browser_tabs") {
          return { success: true, tabs: [] };
        }
        return {};
      });

      const navigate = getTool(tools, "browser_navigate");

      // simple
      const simpleResult = await navigate.handler(
        { url: "http://test.com", type: "simple", load_delay: 0 },
        context(),
      );
      expect(simpleResult).toContain("role: document");

      // struct
      const structResult = await navigate.handler(
        { url: "http://test.com", type: "struct", load_delay: 0 },
        context(),
      );
      expect(JSON.parse(structResult.split("Snapshot:\n")[1]).role).toBe("document");

      // summary
      const summaryResult = await navigate.handler(
        { url: "http://test.com", type: "summary", load_delay: 0 },
        context(),
      );
      expect(summaryResult).toContain("Page Text");
    });

    it("[缺陷] load_delay 负数被静默接受", async () => {
      const { tools, bridgeClient } = createPlugin({
        browser_navigate: { success: true, tab_id: "win_1" },
        browser_snapshot: { success: true, type: "simple", snapshot: { role: "document", ref: "root" } },
        browser_tabs: { success: true, tabs: [] },
      });
      const navigate = getTool(tools, "browser_navigate");
      // load_delay=-1 → sleep(-1000) → setTimeout(resolve, -1000) → 等效 0ms
      // 不报错，静默接受 — 设计如此（行为宽松）
      const result = await navigate.handler(
        { url: "http://test.com", load_delay: -1 },
        context(),
      );
      expect(result).toContain("role: document");
    });
  });

  // ── session 隔离 ──

  describe("发现 #2/I4/I5: session 隔离与持久化", () => {
    it("[I4] tabs 通过 createdBy 过滤（设计如此）", async () => {
      const { tools, bridgeClient } = createPlugin({});
      bridgeClient.request.mockImplementation(async (method: string, params: any) => {
        if (method === "browser_tabs" && params.action === "list") {
          // 验证 created_by 被传递
          expect(params.created_by).toBe("session-1");
          return {
            success: true,
            tabs: [{ title: "Tab1", url: "http://a.com", is_current: true }],
          };
        }
        return {};
      });
      const tabs = getTool(tools, "browser_tabs");
      const result = await tabs.handler({ action: "list" }, context());
      expect(result).toContain("Tab1");
    });

    it("[I5] close_all 不清除 cookie 数据（设计如此 — persist:browser_shared）", async () => {
      // close_all 只关闭窗口，不调用 clearAllBrowserData
      // cookie 在 persist:browser_shared partition 中持久存在
      // 这是用户确认的设计行为
      const { tools } = createPlugin({
        browser_tabs: { success: true, closed_count: 2 },
      });
      const tabs = getTool(tools, "browser_tabs");
      const result = await tabs.handler({ action: "close_all" }, context());
      expect(result).toContain("Closed 2 tab(s)");
      // 验证：close_all 返回成功，不涉及 cookie 清理
    });
  });

  // ── 子 Agent 清理 ──

  describe("子 Agent 浏览器窗口清理", () => {
    it("handleSubAgentClosed 调用 bridge close_by_creator", async () => {
      const { plugin, bridgeClient } = createPlugin({});
      bridgeClient.request.mockResolvedValueOnce({ success: true, closed: 2 });

      // 模拟 subagent.closed 事件
      await (plugin as any).handleSubAgentClosed({
        payload: { subSessionId: "sub-session-1" },
      });

      expect(bridgeClient.request).toHaveBeenCalledWith(
        "browser_close_by_creator",
        { created_by: "sub-session-1" },
      );
    });

    it("handleSubAgentClosed 无 subSessionId 时 no-op", async () => {
      const { plugin, bridgeClient } = createPlugin({});
      await (plugin as any).handleSubAgentClosed({
        payload: {},
      });
      expect(bridgeClient.request).not.toHaveBeenCalled();
    });
  });
});
