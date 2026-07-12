import { Injectable, Logger } from "@nestjs/common";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { PluginApi } from "../api/plugin-api";

@Injectable()
export class BrowserPlugin extends PluginBase {
  private readonly logger = new Logger(BrowserPlugin.name);
  private pendingRequests = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (r: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private requestIdCounter = 0;
  private bridgeMode: "ipc" | "tcp" = "ipc";
  private tcpBaseUrl = "";

  manifest = {
    id: "browser",
    name: "浏览器控制",
    description: "通过 Electron 内置 Chromium 进行浏览器自动化操作",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private workspaceService: WorkspaceService) {
    super();
    this.bridgeMode = (process.env.BROWSER_BRIDGE_MODE as any) || "ipc";
    if (this.bridgeMode === "tcp") {
      this.tcpBaseUrl = `http://127.0.0.1:${process.env.BROWSER_BRIDGE_PORT || "4111"}/browser-tool`;
    }
    if (process.send) {
      process.on("message", (message: any) => {
        if (message && message.type === "BROWSER_TOOL_RESPONSE") {
          this.handleResponse(message.data);
        }
      });
    }
  }

  async onLoad(api: PluginApi) {
    // 注册浏览器工具包（ToolKit 方式）
    api.registerToolKit({
      id: "browser",
      name: "Browser Automation",
      loadMode: "lazy",
      activator: "Use this toolkit when browser automation is needed",
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "browser_new_window",
          description:
            "Open a new independent window, returns window_id. Supports passing metadata for session isolation and scope identification.",
          inputSchema: z.object({
            url: z.string().describe("URL to open"),
            load_delay: z
              .number()
              .optional()
              .describe("Seconds to wait after page load (default 3s), used to wait for dynamic content to render before extracting summary"),
            metadata: z
              .object({
                scope: z
                  .string()
                  .optional()
                  .describe("Scope identifier for session isolation"),
                purpose: z.string().optional().describe("Purpose description for the window"),
              })
              .optional()
              .describe(
                "Optional metadata, e.g. { scope: 'session_123', purpose: 'research' }",
              ),
          }),
          execute: async (args, ctx, signal) => {
            return await this.executeWithContent(
              "browser_new_window",
              {
                ...args,
                session_path: ctx?.session.workspacePath,
                session_id: ctx?.session.sessionId,
              },
              signal,
            );
          },
          display: { action: "打开新窗口", argsKey: "url", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_navigate",
          description: "Navigate to the specified URL, returns page title, URL, and page summary content",
          inputSchema: z.object({
            url: z.string().describe("URL to navigate to"),
            window_id: z.string().describe("Target window ID (required)"),
            load_delay: z
              .number()
              .optional()
              .describe("Seconds to wait after page load (default 3s), used to wait for dynamic content to render before extracting summary"),
          }),
          execute: async (args, ctx, signal) =>
            this.executeWithContent("browser_navigate", args, signal),
          display: { action: "Navigate", argsKey: "url", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_run_js",
          description:
            "Execute JavaScript code in the specified window and return the result. Supports passing code directly as a string or a file path (relative to the session working directory).",
          inputSchema: z.object({
            code: z
              .string()
              .optional()
              .describe("JavaScript code string to execute"),
            file_path: z
              .string()
              .optional()
              .describe(
                "JavaScript file path (relative to the session working directory; use either this or code)",
              ),
            window_id: z.string().describe("Target window ID (required)"),
          }),
          execute: async (args, ctx, signal) => {
            const { code, file_path, window_id } = args;
            if (!window_id) throw new Error("window_id is required");
            if (!code && !file_path)
              throw new Error("Must provide either code or file_path");
            if (code && file_path)
              throw new Error("code and file_path cannot be provided simultaneously");
            const finalCode = file_path
              ? await this.readJsFile(file_path, ctx)
              : code!;
            const result = await this.sendRequest(
              "browser_run_js",
              { code: finalCode, window_id },
              signal,
            );
            return result;
          },
          display: { action: "执行JavaScript", argsKey: "code", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_page_text",
          description:
            "Get the plain text content of the page in the specified window (removes all HTML tags, scripts, and styles)",
          inputSchema: z.object({
            window_id: z.string().describe("Target window ID"),
          }),
          execute: async (args, ctx, signal) => {
            const r = await this.sendRequest("browser_page_text", args, signal);
            return r;
          },
          display: { action: "Extract Page Text", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_page_struct",
          description:
            "Get the structured JSON of the page in the specified window (optimized for selectors, significantly reduces token usage)",
          inputSchema: z.object({
            window_id: z.string().describe("Target window ID"),
          }),
          execute: async (args, ctx, signal) => {
            const r = await this.sendRequest(
              "browser_page_struct",
              args,
              signal,
            );
            return r;
          },
          display: { action: "提取页面结构", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_page_summary",
          description: "Get the page summary of the specified window (extracts text, links, and heading hierarchy)",
          inputSchema: z.object({
            window_id: z.string().describe("Target window ID"),
          }),
          execute: async (args, ctx, signal) => {
            const r = await this.sendRequest(
              "browser_page_summary",
              args,
              signal,
            );
            return r;
          },
          display: { action: "提取页面摘要", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_back",
          description: "Go back in the browser",
          inputSchema: z.object({
            window_id: z.string().describe("Target window ID"),
            load_delay: z
              .number()
              .optional()
              .describe("Seconds to wait after page load (default 3s), used to wait for dynamic content to render before extracting summary"),
          }),
          execute: async (args, ctx, signal) =>
            this.executeWithContent("browser_back", args, signal),
          display: { action: "Go Back", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_forward",
          description: "Go forward in the browser",
          inputSchema: z.object({
            window_id: z.string().describe("Target window ID"),
            load_delay: z
              .number()
              .optional()
              .describe("Seconds to wait after page load (default 3s), used to wait for dynamic content to render before extracting summary"),
          }),
          execute: async (args, ctx, signal) =>
            this.executeWithContent("browser_forward", args, signal),
          display: { action: "前进", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_reload",
          description: "Reload the page in the specified window",
          inputSchema: z.object({
            window_id: z.string().describe("Target window ID"),
            load_delay: z
              .number()
              .optional()
              .describe("Seconds to wait after page load (default 3s), used to wait for dynamic content to render before extracting summary"),
          }),
          execute: async (args, ctx, signal) =>
            this.executeWithContent("browser_reload", args, signal),
          display: { action: "刷新页面", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_click",
          description:
            "Click the element matching the CSS selector in the specified window; automatically returns the page summary after the operation",
          inputSchema: z.object({
            selector: z.string().describe("CSS selector"),
            window_id: z.string().describe("Target window ID"),
          }),
          execute: async (args, ctx, signal) =>
            this.sendRequest("browser_click", args, signal),
          display: { action: "点击元素", argsKey: "selector", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_input",
          description: "Fill text into an input field in the specified window; automatically returns the page summary after the operation",
          inputSchema: z.object({
            selector: z.string().describe("CSS selector"),
            value: z.string().describe("Text to fill in"),
            window_id: z.string().describe("Target window ID"),
          }),
          execute: async (args, ctx, signal) =>
            this.sendRequest("browser_input", args, signal),
          display: { action: "Input Text", argsKey: "value", icon: "browser" },
        });

        toolkit.registerTool({
          name: "browser_close",
          description: "Close the specified window and clear all browsing data",
          inputSchema: z.object({
            window_id: z.string().describe("Window ID to close"),
          }),
          execute: async (args, ctx, signal) =>
            this.sendRequest("browser_close", args, signal),
          display: { action: "Close Window", icon: "browser" },
        });
        toolkit.registerTool({
          name: "browser_windows",
          description:
            "Get the list of all windows in the current session, including window ID, URL, title, etc.",
          inputSchema: z.object({}),
          execute: async (args, ctx, signal) => {
            const r = await this.sendRequest(
              "browser_windows",
              { ...args, session_id: ctx?.session.sessionId },
              signal,
            );
            return r;
          },
          display: { action: "获取窗口列表", icon: "browser" },
        });

        // 使用说明提示词
        toolkit.registerPrompt({
          frequency: "REGULAR",
          description: "浏览器控制工具使用说明",
          content: [
            "# Browser Tools",
            "",
            "## Multi-Window Support",
            "- Always use `browser_new_window(url)` first to open a new window",
            "- After `browser_new_window` / `browser_navigate` / `go_back` / `go_forward` / `reload` operations, **the page summary is automatically returned**",
            "- For dynamically loaded pages (SPA, etc.), use the `load_delay` parameter (seconds, default 3s) to control the wait time before summary extraction",
            "- `browser_page_struct` returns a JSON structure optimized for selectors; `browser_page_text` returns plain text",
            "- All windows are **completely incognito** by default — no data is retained after closing",
            "",
            "## Persistent User Scripts",
            "`.browser-work/scripts/*.js` are automatically injected at document-start on page load. Changes take effect after `browser_reload`.",
            "Supports `@match` header for URL filtering.",
            "",
            "Example:",
            "```javascript",
            "// ==UserScript==",
            "// @match  https://example.com/*",
            "// ==/UserScript==",
            "",
            "console.log('Only executes on example.com');",
            "```",
            "",
            "## Debugging",
            "Console logs are written to `.browser-work/console/`. `browser_run_js` automatically includes the last 50 lines. Use file tools to read full logs.",
            "",
            "## Advanced Usage",
            "- `browser_run_js` supports `code` or `file_path` (relative to the session directory); `await` is naturally available",
            "- Within a page, you can use `window._browserBridge.saveLocalFile()` / `.readLocalFile()` / `.getCookies()` / `.setCookie()` / `.removeCookie()` to operate local files (automatically saved to the session working directory)",
          ].join("\n"),
        });
      },
    });
  }

  // ── 响应处理 ──
  // ── 响应处理 ──

  private handleResponse(response: any) {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    if (response.error) pending.reject(new Error(response.error.message));
    else pending.resolve(response.result);
  }

  private async sendRequest(
    method: string,
    params: any,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    if (this.bridgeMode === "tcp")
      return this.sendTCPRequest(method, params, abortSignal);
    return this.sendIPCRequest(method, params, abortSignal);
  }

  private async executeWithContent(
    method: string,
    args: any,
    signal?: AbortSignal,
  ): Promise<any> {
    // 提取 load_delay，不传给 Electron 端操作
    const { load_delay, ...restArgs } = args;
    const delayMs = (load_delay ?? 3) * 1000;

    // 先执行主操作（导航/后退/前进/刷新等）
    const result = await this.sendRequest(method, restArgs, signal);
    if (result?.success === false) return result;
    if (result?.windowId && !restArgs.window_id) restArgs.window_id = result.windowId;

    // 等待动态内容加载后再取摘要
    if (delayMs > 0) {
      await this.sleep(delayMs, signal);
    }

    // 操作成功后自动跟随获取页面摘要，避免 LLM 多一轮成对调用
    try {
      const summary = await this.sendRequest(
        "browser_page_summary",
        { window_id: restArgs.window_id },
        signal,
      );
      if (summary?.success === false) {
        this.logger.warn("get page summary failed");
        return result;
      }
      return { ...result, ...summary };
    } catch {
      // 获取摘要失败不影响主操作结果
      return result;
    }
  }

  /** 可被 AbortSignal 提前中断的延时 */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }
    });
  }

  private sendTCPRequest(
    method: string,
    params: any,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = String(++this.requestIdCounter);
      const req = http.request(
        this.tcpBaseUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeout: 60000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const response = JSON.parse(data);
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve(response.result);
              }
            } catch {
              resolve(data);
            }
          });
        },
      );
      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      if (abortSignal) {
        if (abortSignal.aborted) {
          req.destroy();
          reject(new Error("Request was aborted"));
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => {
            req.destroy();
          },
          { once: true },
        );
      }
      req.write(JSON.stringify({ id, method, params }));
      req.end();
    });
  }

  private sendIPCRequest(
    method: string,
    params: any,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!process.send) {
        reject(new Error("IPC not available"));
        return;
      }
      const id = String(++this.requestIdCounter);
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }, 60000);
      this.pendingRequests.set(id, { resolve, reject, timeout });
      const request = { id, method, params };
      process.send({ type: "BROWSER_TOOL_CALL", data: request });
      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(new Error("Request was aborted"));
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            this.pendingRequests.delete(id);
            reject(new Error("Request was aborted"));
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
      throw new Error("文件路径不能为空");
    try {
      const resolvedPath = this.resolveJsFilePath(filePath, context);
      await fs.promises.access(resolvedPath);
      const stats = await fs.promises.stat(resolvedPath);
      if (!stats.isFile()) throw new Error(`${resolvedPath} 不是一个文件`);
      if (stats.size > 5 * 1024 * 1024)
        throw new Error(`文件过大: ${stats.size} bytes (最大允许 5MB)`);
      const content = await fs.promises.readFile(resolvedPath, "utf-8");
      return content;
    } catch (error: any) {
      throw new Error(`读取 JavaScript 文件失败: ${error.message}`);
    }
  }

  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isExecuting: boolean,
  ) {
    const prefix = isExecuting ? "正在" : "已";
    let action: string,
      toolArgs: string | undefined,
      toolType = "browser";
    switch (toolName) {
      case "browser_new_window":
        action = `${prefix}打开新窗口`;
        toolArgs = args.url;
        break;
      case "browser_navigate":
        action = `${prefix}访问网页`;
        toolArgs =
          args.url?.length > 40 ? args.url.substring(0, 40) + "..." : args.url;
        break;
      case "browser_click":
        action = `${prefix}点击`;
        toolArgs = args.selector;
        break;
      case "browser_input":
        action = `${prefix}输入文本`;
        toolArgs = args.selector;
        break;
      case "browser_page_struct":
        action = `${prefix}获取页面结构`;
        break;
      case "browser_run_js":
        action = `${prefix}执行 JavaScript`;
        toolType = "code";
        toolArgs = args.code || args.file_path;
        break;
      default:
        action = `${prefix}操作浏览器`;
    }
    return { action, args: toolArgs, toolName, toolType };
  }
}
