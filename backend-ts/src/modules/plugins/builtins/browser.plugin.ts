import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as path from "path";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { PluginApi } from "../api/plugin-api";
import { BridgeClient } from "../../bridge/bridge-client";
import { safeTruncate } from "../../../common/utils/string.utils";

@Injectable()
export class BrowserPlugin extends PluginBase {
  private readonly logger = new Logger(BrowserPlugin.name);

  manifest = {
    id: "browser",
    name: "浏览器控制",
    description: "通过 Electron 内置 Chromium 进行浏览器自动化操作",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(
    private workspaceService: WorkspaceService,
    private bridgeClient: BridgeClient,
  ) {
    super();
  }

  /**
   * 监听子 Agent 关闭事件，自动清理其创建的浏览器窗口
   */
  @OnEvent("subagent.closed")
  async handleSubAgentClosed(event: any): Promise<void> {
    const subSessionId = event?.payload?.subSessionId;
    if (!subSessionId) return;
    this.logger.log(`子 Agent ${subSessionId} 已关闭，清理其浏览器窗口`);
    await this.closeWindowsByCreator(subSessionId);
  }

  async onLoad(api: PluginApi) {
    api.registerToolKit({
      id: "browser",
      name: "Browser Automation",
      loadMode: "lazy",
      activator:
        "Use this toolkit for navigating to URLs, reading page content, interacting with elements (clicks, form inputs), extracting page snapshots, executing JavaScript in page context, viewing console logs, taking screenshots, and managing browser tabs. Essential for web browsing, front-end debugging, and any task that requires interacting with or inspecting live web pages.",
      onLoad: (toolkit) => {
        // ── 1. 统一导航 ──
        toolkit.registerTool({
          name: "browser_navigate",
          description:
            "Navigate to a URL. Set new_tab=true to open in a new tab (auto-set as current), false to navigate in the current tab (auto-creates one if none exists). Returns tab list and page snapshot. Use load_delay (seconds, default 3s) to wait for dynamic content before snapshot. After navigation or interaction, call browser_snapshot again to refresh element refs.",
          inputSchema: z.object({
            url: z.string().describe("URL to navigate to"),
            new_tab: z
              .boolean()
              .optional()
              .describe(
                "true=open new tab and set as current, false=navigate in current tab (default false)",
              ),
            type: z
              .enum(["simple", "struct", "summary"])
              .optional()
              .describe(
                "Snapshot type: 'simple' (compact accessibility YAML, default), 'struct' (detailed DOM structure JSON), or 'summary' (text/links/headings)",
              ),
            load_delay: z
              .number()
              .optional()
              .describe(
                "Seconds to wait after page load before snapshot (default 3s)",
              ),
          }),
          execute: async (args, ctx, signal) => {
            const ownerSessionId =
              ctx?.session.parentSessionId || ctx?.session.sessionId;
            const result = await this.executeWithSnapshot(
              "browser_navigate",
              {
                url: args.url,
                new_tab: args.new_tab || false,
                type: args.type || "simple",
                session_path: ctx?.session.workspacePath,
                session_id: ownerSessionId,
                created_by: ctx?.session.sessionId,
              },
              args.load_delay,
              args.type || "simple",
              signal,
            );
            return this.formatNavigateResult(
              result,
              ctx?.session.sessionId || "",
              signal,
            );
          },
          display: { actionType: "navigate", argsKey: "url", icon: "browser" },
        });

        // ── 2. 标签管理 ──
        toolkit.registerTool({
          name: "browser_tabs",
          description:
            "Manage browser tabs. action='list' returns all tabs with index, url, title, and is_current marker. action='select' switches current tab by index (AI-level only, does not affect frontend display). action='close' closes current tab or specified index (auto-switches to next available). action='close_all' closes every tab. Only tabs created by this session are visible.",
          inputSchema: z.object({
            action: z
              .enum(["list", "select", "close", "close_all"])
              .describe(
                "'list'=show all tabs, 'select'=switch to a tab, 'close'=close a tab, 'close_all'=close all tabs",
              ),
            index: z
              .number()
              .optional()
              .describe(
                "Tab position (0-based, from browser_tabs list). Required for 'select'. Optional for 'close' (defaults to current tab)",
              ),
          }),
          execute: async (args, ctx, signal) => {
            const result = await this.sendRequest(
              "browser_tabs",
              {
                action: args.action,
                index: args.index,
                created_by: ctx?.session.sessionId,
              },
              signal,
            );
            this.assertSuccess(result);
            return this.formatTabsResult(
              result,
              ctx?.session.sessionId || "",
              signal,
            );
          },
          display: { actionType: "tabs", argsKey: "action", icon: "browser" },
        });

        // ── 3. 页面快照 ──
        toolkit.registerTool({
          name: "browser_snapshot",
          description:
            "Get the current page snapshot. type='simple' (default) returns compact accessibility YAML with interactive ref IDs for browser_interact. type='struct' returns a detailed DOM role/ref tree as JSON for elements missing from accessibility semantics. type='summary' returns text, links, and headings.",
          inputSchema: z.object({
            type: z
              .enum(["simple", "struct", "summary"])
              .optional()
              .describe(
                "'simple'=compact accessibility YAML (default), 'struct'=detailed DOM JSON, 'summary'=text/links/headings",
              ),
          }),
          execute: async (args, ctx, signal) => {
            const result = await this.sendRequest(
              "browser_snapshot",
              {
                type: args.type || "simple",
                created_by: ctx?.session.sessionId,
              },
              signal,
            );
            this.assertSuccess(result);
            return this.formatSnapshot(result, args.type || "simple");
          },
          display: { actionType: "snapshot", argsKey: "type", icon: "browser" },
        });

        // ── 4. 交互操作 ──
        toolkit.registerTool({
          name: "browser_interact",
          description:
            "Interact with the page: click an element or fill text into an input field. Use action='click' to click, action='input' to fill text.",
          inputSchema: z
            .object({
              action: z
                .enum(["click", "input"])
                .describe("Interaction type: 'click' or 'input'"),
              selector: z
                .string()
                .describe(
                  "Element ref ID (e.g. 'e0') from page snapshot, or CSS selector",
                ),
              value: z
                .string()
                .optional()
                .describe("Text to fill in (required when action='input')"),
            })
            .superRefine((args, ctx) => {
              if (args.action === "input" && args.value === undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: ["value"],
                  message: "value is required when action is input",
                });
              }
            }),
          execute: async (args, ctx, signal) => {
            const method =
              args.action === "click" ? "browser_click" : "browser_input";
            const result = await this.sendRequest(
              method,
              {
                selector: args.selector,
                value: args.value,
                created_by: ctx?.session.sessionId,
              },
              signal,
            );
            this.assertSuccess(result);
            return this.formatInteractResult(args, result);
          },
          display: { actionType: "interact", argsKey: "action", icon: "browser" },
        });

        // ── 5. 执行 JavaScript ──
        toolkit.registerTool({
          name: "browser_evaluate",
          description:
            "Execute JavaScript code in the current tab and return the result. Pass code directly as a string, or use file_path for a JS file (relative to the session working directory; use either, not both). Within the page, window._browserBridge.saveLocalFile() / .readLocalFile() / .getCookies() / .setCookie() / .removeCookie() operate on local files in the session directory. await is naturally available.",
          inputSchema: z.object({
            code: z
              .string()
              .optional()
              .describe("JavaScript code string to execute"),
            file_path: z
              .string()
              .optional()
              .describe(
                "JavaScript file path (relative to session working directory; use either this or code)",
              ),
          }),
          execute: async (args, ctx, signal) => {
            const { code, file_path } = args;
            if (!code && !file_path)
              throw new Error("Must provide either code or file_path");
            if (code && file_path)
              throw new Error(
                "code and file_path cannot be provided simultaneously",
              );
            const finalCode = file_path
              ? await this.readJsFile(file_path, ctx)
              : code!;
            const result = await this.sendRequest(
              "browser_evaluate",
              {
                code: finalCode,
                created_by: ctx?.session.sessionId,
              },
              signal,
            );
            this.assertSuccess(result);
            return this.formatEvaluateResult(result);
          },
          display: {
            actionType: "evaluate",
            argsKey: "code",
            icon: "browser",
          },
        });

        // ── 6. 导航操作 ──
        toolkit.registerTool({
          name: "browser_history",
          description:
            "Page navigation: action='back' goes to previous page, 'forward' goes to next page, 'reload' refreshes the current tab. Returns the tab list and a compact accessibility snapshot after the operation.",
          inputSchema: z.object({
            action: z
              .enum(["back", "forward", "reload"])
              .describe("Navigation action: 'back', 'forward', or 'reload'"),
            load_delay: z
              .number()
              .optional()
              .describe(
                "Seconds to wait after page load before snapshot (default 3s)",
              ),
          }),
          execute: async (args, ctx, signal) => {
            const method =
              args.action === "reload" ? "browser_reload" : "browser_history";
            const result = await this.executeWithSnapshot(
              method,
              {
                action: args.action,
                created_by: ctx?.session.sessionId,
              },
              args.load_delay,
              "simple",
              signal,
            );
            return this.formatNavigateResult(
              result,
              ctx?.session.sessionId || "",
              signal,
            );
          },
          display: { actionType: "history", argsKey: "action", icon: "browser" },
        });

        // ── 7. 控制台日志 ──
        toolkit.registerTool({
          name: "browser_console",
          description:
            "Get console logs from the current tab — page errors, warnings, and log outputs. Logs are cleared after each read, so each call returns only new logs.",
          inputSchema: z.object({}),
          execute: async (args, ctx, signal) => {
            const result = await this.sendRequest(
              "browser_console",
              {
                created_by: ctx?.session.sessionId,
              },
              signal,
            );
            this.assertSuccess(result);
            return this.formatConsoleResult(result);
          },
          display: { actionType: "console", icon: "browser" },
        });

        // ── 8. 截图 ──
        toolkit.registerTool({
          name: "browser_screenshot",
          description:
            "Take a screenshot of the current tab and save it as a PNG file. Returns the saved file path and image dimensions. If no file path is provided, the screenshot is saved to the session workspace directory with an auto-generated filename.",
          inputSchema: z.object({
            file_path: z
              .string()
              .optional()
              .describe(
                "File path to save the screenshot. Can be absolute or relative to the session working directory. If omitted, saves to session workspace as screenshot-<timestamp>.png",
              ),
          }),
          execute: async (args, ctx, signal) => {
            const result = await this.sendRequest(
              "browser_screenshot",
              {
                created_by: ctx?.session.sessionId,
                file_path: args.file_path,
                session_path: ctx?.session.workspacePath,
              },
              signal,
            );
            this.assertSuccess(result);
            const parts: string[] = [];
            if (result.saved_path) {
              parts.push(`Screenshot saved: ${result.saved_path}`);
            }
            parts.push(
              `Dimensions: ${result.width}x${result.height}`,
            );
            return parts.join("\n");
          },
          display: { actionType: "screenshot", icon: "browser" },
        });

        // ── 使用说明 ──
        toolkit.registerPrompt({
          frequency: "REGULAR",
          description: "浏览器控制工具使用说明",
          content: [
            "# Browser Tools Workflow",
            "",
            "## Current Tab",
            "- Most tools operate on the **current tab** automatically",
            "- `browser_navigate(url, new_tab=true)` opens a new tab and sets it as current",
            "- `browser_navigate(url)` navigates in the current tab (auto-creates one if none exists)",
            "- Use `browser_tabs(action=\"list\")` to see all tabs, `browser_tabs(action=\"select\", index=N)` to switch current tab",
            "",
            "## Snapshot & Interaction",
            "- `browser_navigate` and `browser_history` auto-return a snapshot after the operation",
            "- Use `browser_snapshot` to re-capture page state when needed (e.g. after JS-driven content changes)",
            "- Simple snapshots return interactive ref IDs (e.g. 'e0') — use these as selector in `browser_interact`",
            "- Use a struct snapshot only when accessibility semantics omit an element you need",
            "- Use `browser_screenshot(file_path?)` to capture a visual screenshot of the current page",
            "",
            "## Session Isolation",
            "- All tabs are **incognito** — no data persists after closing",
            "- Tabs are **session-isolated** — each agent only sees its own tabs",
          ].join("\n"),
        });
      },
    });
  }

  /**
   * 公开方法：关闭指定创建者的所有浏览器窗口（供 SubAgentManager 调用）
   */
  async closeWindowsByCreator(createdBy: string): Promise<void> {
    try {
      await this.bridgeClient.request("browser_close_by_creator", {
        created_by: createdBy,
      });
      this.logger.log(`已清理子 Agent ${createdBy} 的浏览器窗口`);
    } catch (err) {
      this.logger.warn(`清理子 Agent ${createdBy} 的浏览器窗口失败: ${err}`);
    }
  }

  private async sendRequest(
    method: string,
    params: any,
    _abortSignal?: AbortSignal,
  ): Promise<any> {
    return this.bridgeClient.request(method, params);
  }

  // ── 纯文本格式化 ──

  /**
   * 统一断言：服务层返回 success=false 时抛异常
   */
  private assertSuccess(result: any): void {
    if (result?.success === false) {
      throw new Error(result?.message || result?.error || "Operation failed.");
    }
  }

  /**
   * 获取标签列表纯文本（附带在 navigate/history 等操作结果后）
   */
  private async fetchTabsText(
    createdBy: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const tabsResult = await this.sendRequest(
        "browser_tabs",
        { action: "list", created_by: createdBy },
        signal,
      );
      return this.formatTabsList(tabsResult);
    } catch {
      return "";
    }
  }

  /**
   * 将 tabs list 返回格式化为纯文本
   */
  private formatTabsList(tabsResult: any): string {
    const tabs = tabsResult?.tabs;
    if (!Array.isArray(tabs) || tabs.length === 0) return "No tabs.";
    return tabs
      .map((t: any, i: number) => {
        const marker = t.is_current ? " [current]" : "";
        return `${i}. [${t.title || "Untitled"}][${t.url}]${marker}`;
      })
      .join("\n");
  }

  /**
   * 将 snapshot 返回格式化为纯文本：simple=YAML，struct=JSON，summary=可读文本。
   */
  private formatSnapshotText(snapshot: any, type: string): string {
    if (type === "simple") {
      const tree = snapshot?.snapshot ?? snapshot;
      return yaml
        .dump(tree, {
          lineWidth: -1,
          noRefs: true,
          sortKeys: false,
          quotingType: '"',
        })
        .trimEnd();
    }

    if (type === "struct") {
      const struct = snapshot?.struct ?? snapshot;
      return typeof struct === "string"
        ? struct
        : JSON.stringify(struct, null, 2);
    }

    const parts: string[] = [];
    if (snapshot.text) {
      const text = safeTruncate(snapshot.text, 5000);
      parts.push(`--- Page Text ---\n${text}`);
    }
    if (snapshot.headings?.length) {
      parts.push("\n--- Headings ---");
      for (const h of snapshot.headings) {
        parts.push(`${"  ".repeat(h.level - 1)}H${h.level}: ${h.text}`);
      }
    }
    if (snapshot.links?.length) {
      parts.push("\n--- Links ---");
      for (const l of snapshot.links.slice(0, 50)) {
        parts.push(`  [${l.text}] -> ${l.href}`);
      }
      if (snapshot.links.length > 50)
        parts.push(`  ... and ${snapshot.links.length - 50} more links`);
    }
    return parts.join("\n");
  }

  /**
   * browser_navigate / browser_history 的结果格式化
   * 返回: tabs + snapshot
   */
  private async formatNavigateResult(
    result: any,
    createdBy: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const parts: string[] = [];

    // tabs
    const tabsText = await this.fetchTabsText(createdBy, signal);
    if (tabsText) parts.push(`Tabs:\n${tabsText}`);

    // snapshot
    if (result?.type === "simple" && result?.snapshot) {
      parts.push(`\nSnapshot:\n${this.formatSnapshotText(result, "simple")}`);
    } else if (result?.type === "struct" && result?.struct) {
      parts.push(`\nSnapshot:\n${this.formatSnapshotText(result, "struct")}`);
    } else if (result?.text || result?.headings || result?.links) {
      parts.push(`\nSnapshot:\n${this.formatSnapshotText(result, "summary")}`);
    }

    return parts.join("\n") || "Navigation completed.";
  }

  /**
   * browser_tabs 的结果格式化
   */
  private async formatTabsResult(
    result: any,
    createdBy: string,
    signal?: AbortSignal,
  ): Promise<string> {
    // close_all 特殊处理
    if (result?.closed_count !== undefined) {
      return `Closed ${result.closed_count} tab(s).`;
    }

    // list / select / close — 都返回标签列表
    // 优先用 result 中的 tabs，没有则重新拉取
    if (result?.tabs) {
      return this.formatTabsList(result);
    }
    // select/close 返回的不是 tabs 列表，需要主动拉取
    const tabsText = await this.fetchTabsText(createdBy, signal);
    if (tabsText) return tabsText;

    return result?.closed_tab_id
      ? `Closed tab ${result.closed_tab_id}. No remaining tabs.`
      : "No tabs.";
  }

  /**
   * browser_snapshot 的结果格式化
   */
  private formatSnapshot(snapshot: any, type: string): string {
    return this.formatSnapshotText(snapshot, type);
  }

  /**
   * browser_interact 的结果格式化
   */
  private formatInteractResult(args: any, result: any): string {
    if (args.action === "click") {
      return `Clicked: ${args.selector}`;
    }
    return `Filled: ${args.selector} = ${args.value}`;
  }

  /**
   * browser_evaluate 的结果格式化
   */
  private formatEvaluateResult(result: any): string {
    const val = result?.result;
    if (val === undefined) return "undefined";
    if (typeof val === "string") return val;
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }

  /**
   * browser_console 的结果格式化
   */
  private formatConsoleResult(result: any): string {
    const logs = result?.logs;
    if (!Array.isArray(logs) || logs.length === 0) return "No console output.";
    return logs.join("\n");
  }

  private async executeWithSnapshot(
    method: string,
    args: any,
    loadDelay: number | undefined,
    snapshotType: string,
    signal?: AbortSignal,
  ): Promise<any> {
    const delayMs = (loadDelay ?? 3) * 1000;

    // 执行主操作（导航/后退/前进/刷新等）
    const result = await this.sendRequest(method, args, signal);
    this.assertSuccess(result);

    // 从返回结果中获取 tab_id
    const tabId = result?.tab_id || result?.windowId;
    if (!tabId) return result;

    // 等待动态内容加载
    if (delayMs > 0) {
      await this.sleep(delayMs, signal);
    }

    // 自动获取快照；失败统一抛异常，避免把缺失快照误判为成功导航
    const snapshot = await this.sendRequest(
      "browser_snapshot",
      { type: snapshotType, created_by: args.created_by },
      signal,
    );
    this.assertSuccess(snapshot);
    return typeof snapshot === "string"
      ? { ...result, snapshot }
      : { ...result, ...snapshot };
  }

  /** 可被 AbortSignal 提前中断的延时 */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }
    });
  }

  // ── JS 文件读取 ──

  private resolveJsFilePath(filePath: string, context?: PluginContext): string {
    return this.workspaceService.resolveFilePath(
      filePath,
      context?.session.workspacePath,
    );
  }

  private async readJsFile(
    filePath: string,
    context?: PluginContext,
  ): Promise<string> {
    if (!filePath || typeof filePath !== "string")
      throw new Error("filePath is required and must be a string");
    try {
      const resolvedPath = this.resolveJsFilePath(filePath, context);
      await fs.promises.access(resolvedPath);
      const stats = await fs.promises.stat(resolvedPath);
      if (!stats.isFile()) throw new Error(`${resolvedPath} is not a file`);
      if (stats.size > 5 * 1024 * 1024)
        throw new Error(
          `File size is too large: ${stats.size} bytes (max 5MB)`,
        );
      const content = await fs.promises.readFile(resolvedPath, "utf-8");
      return content;
    } catch (error: any) {
      throw new Error(`Failed to read JavaScript file: ${error.message}`);
    }
  }
}
