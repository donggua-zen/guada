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
      this.tcpBaseUrl = `http://127.0.0.1:${process.env.BROWSER_BRIDGE_PORT || "3001"}/browser-tool`;
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
    api.registerToolSet({
      name: "browser",
      loadMode: "lazy",
      activator: "当需要浏览器自动化操作时通过 tool_load 加载",
    });

    api.registerTool({
      name: "browser_navigate",
      toolSet: "browser",
      description: "导航到指定 URL，返回页面标题和 URL",
      inputSchema: z.object({
        url: z.string().describe("要导航到的 URL"),
        window_id: z.string().describe("目标窗口 ID（必填）"),
      }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_navigate", args, signal),
      display: { action: "访问网页", argsKey: "url", icon: "browser" },
    });
    api.registerTool({
      name: "browser_run_js",
      toolSet: "browser",
      description:
        "在指定窗口执行 JavaScript 代码并返回结果。支持直接传入代码字符串或文件路径（相对路径相对于会话工作目录）。获取返回值需要使用 return。",
      inputSchema: z.object({
        code: z.string().optional().describe("要执行的 JavaScript 代码字符串"),
        file_path: z
          .string()
          .optional()
          .describe(
            "JavaScript 文件路径（相对路径相对于会话工作目录，与 code 二选一）",
          ),
        window_id: z.string().describe("目标窗口 ID（必填）"),
        is_async: z
          .boolean()
          .optional()
          .describe("是否支持异步代码（async/await、Promise 等），默认 false"),
      }),
      execute: async (args, ctx, signal) => {
        const { code, file_path, window_id, is_async } = args;
        if (!window_id) throw new Error("window_id 是必填参数");
        if (!code && !file_path)
          throw new Error("必须提供 code 或 file_path 其中之一");
        if (code && file_path)
          throw new Error("code 和 file_path 不能同时提供");
        const finalCode = file_path
          ? await this.readJsFile(file_path, ctx)
          : code!;
        const result = await this.sendRequest(
          "browser_run_js",
          { code: finalCode, window_id, is_async: is_async || false },
          signal,
        );
        return typeof result === "string" ? result : JSON.stringify(result);
      },
      display: { action: "执行 JavaScript", argsKey: "code", icon: "code" },
    });
    api.registerTool({
      name: "browser_page_text",
      toolSet: "browser",
      description:
        "获取指定窗口的页面纯文本内容（移除所有 HTML 标签、脚本和样式）",
      inputSchema: z.object({ window_id: z.string().describe("目标窗口 ID") }),
      execute: async (args, ctx, signal) => {
        const r = await this.sendRequest("browser_page_text", args, signal);
        return typeof r === "string" ? r : JSON.stringify(r);
      },
      display: { action: "提取页面文本", icon: "browser" },
    });
    api.registerTool({
      name: "browser_page_struct",
      toolSet: "browser",
      description:
        "获取指定窗口的页面结构化 JSON（选择器风格优化，大幅减少 Token 占用）",
      inputSchema: z.object({ window_id: z.string().describe("目标窗口 ID") }),
      execute: async (args, ctx, signal) => {
        const r = await this.sendRequest("browser_page_struct", args, signal);
        return this.handleLargeStructResult(r, ctx);
      },
      display: { action: "获取页面结构", icon: "browser" },
    });
    api.registerTool({
      name: "browser_page_summary",
      toolSet: "browser",
      description: "获取指定窗口的页面摘要（提取文本、链接和标题层级）",
      inputSchema: z.object({ window_id: z.string().describe("目标窗口 ID") }),
      execute: async (args, ctx, signal) => {
        const r = await this.sendRequest("browser_page_summary", args, signal);
        return typeof r === "string" ? r : JSON.stringify(r);
      },
      display: { action: "获取页面摘要", icon: "browser" },
    });
    api.registerTool({
      name: "browser_go_back",
      toolSet: "browser",
      description: "浏览器后退",
      inputSchema: z.object({ window_id: z.string().describe("目标窗口 ID") }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_go_back", args, signal),
      display: { action: "后退", icon: "browser" },
    });
    api.registerTool({
      name: "browser_go_forward",
      toolSet: "browser",
      description: "浏览器前进",
      inputSchema: z.object({ window_id: z.string().describe("目标窗口 ID") }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_go_forward", args, signal),
      display: { action: "前进", icon: "browser" },
    });
    api.registerTool({
      name: "browser_reload",
      toolSet: "browser",
      description: "刷新指定窗口的页面",
      inputSchema: z.object({ window_id: z.string().describe("目标窗口 ID") }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_reload", args, signal),
      display: { action: "刷新页面", icon: "browser" },
    });
    api.registerTool({
      name: "browser_click",
      toolSet: "browser",
      description: "点击指定窗口中 CSS 选择器匹配的元素",
      inputSchema: z.object({
        selector: z.string().describe("CSS 选择器"),
        window_id: z.string().describe("目标窗口 ID"),
      }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_click", args, signal),
      display: { action: "点击元素", argsKey: "selector", icon: "browser" },
    });
    api.registerTool({
      name: "browser_input",
      toolSet: "browser",
      description: "向指定窗口的输入框填入文本",
      inputSchema: z.object({
        selector: z.string().describe("CSS 选择器"),
        value: z.string().describe("要填入的文本"),
        window_id: z.string().describe("目标窗口 ID"),
      }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_input", args, signal),
      display: { action: "输入文本", argsKey: "value", icon: "browser" },
    });
    api.registerTool({
      name: "browser_new_window",
      toolSet: "browser",
      description:
        "打开新的独立窗口，返回 window_id。支持传递元数据用于 session 隔离和作用域标识",
      inputSchema: z.object({
        url: z.string().describe("要打开的 URL"),
        metadata: z
          .object({
            scope: z
              .string()
              .optional()
              .describe("作用域标识，用于 session 隔离"),
            purpose: z.string().optional().describe("窗口用途描述"),
          })
          .optional()
          .describe(
            "可选元数据，如 { scope: 'session_123', purpose: 'research' }",
          ),
      }),
      execute: async (args, ctx, signal) => {
        const r = await this.sendRequest(
          "browser_new_window",
          {
            ...args,
            session_path: ctx?.workspacePath,
            session_id: ctx?.sessionId,
          },
          signal,
        );
        return typeof r === "string" ? r : JSON.stringify(r);
      },
      display: { action: "打开新窗口", argsKey: "url", icon: "browser" },
    });
    api.registerTool({
      name: "browser_close",
      toolSet: "browser",
      description: "关闭指定窗口并清除所有浏览数据",
      inputSchema: z.object({
        window_id: z.string().describe("要关闭的窗口 ID"),
      }),
      execute: async (args, ctx, signal) =>
        this.sendRequest("browser_close", args, signal),
      display: { action: "关闭窗口", icon: "browser" },
    });
    api.registerTool({
      name: "browser_windows",
      toolSet: "browser",
      description: "获取当前所有窗口的列表，包括窗口 ID、URL、标题等信息",
      inputSchema: z.object({}),
      execute: async (args, ctx, signal) => {
        const r = await this.sendRequest("browser_windows", args, signal);
        return typeof r === "string" ? r : JSON.stringify(r);
      },
      display: { action: "获取窗口列表", icon: "browser" },
    });

    // ── 使用说明提示词 ──
        api.registerPrompt({
      frequency: "REGULAR",
      toolSet: "browser",
      description: "浏览器控制工具使用说明",
      content: [
        "# 浏览器控制工具使用说明 (browser)",
        "",
        "你可以通过本工具集直接控制内置的 Chromium 浏览器，支持页面导航、JS 执行、DOM 交互等。",
        "",
        "## 多窗口支持",
        "- 最多支持 5 个并发窗口",
        "- 每个窗口有独立的会话隔离（cookies、localStorage 等完全隔离）",
        "- 使用 `browser_windows()` 查看当前所有可用窗口",
        "- 使用 `browser_new_window(url)` 创建新窗口后会返回新的 `window_id`",
        "",
        "## 使用建议",
        "1. 先用 `browser_new_window(url)` 创建新窗口并导航到目标网页，获取 `window_id`",
        "2. 用 `browser_page_text` 获取纯文本内容进行分析（适合快速了解页面主要内容）",
        "3. 用 `browser_page_struct` 获取结构化 JSON（适合需要分析 DOM 结构或提取特定元素）",
        "4. 如需交互，使用 `browser_click` 和 `browser_input` 操作页面元素",
        "5. 进阶功能，使用 `browser_run_js` 编写 JavaScript 或使用 `file_path` 参数执行外部 JS 文件",
        "6. 所有新打开的自动化窗口都是**完全无痕的**，关闭后不留任何数据，如果需要保存登录信息，请导出认证相关信息（如cookie）并下次注入",
        "",
        "## browser_run_js 异步代码使用",
        "当需要执行异步代码时，设置 `is_async: true`：",
        "- `async/await` 语法",
        "- `Promise` 对象",
        "- `fetch` API 进行网络请求",
        "- `setTimeout/setInterval` 等定时器",
        "",
        "## run_js 文件执行",
        "可以通过 `file_path` 参数执行外部 JavaScript 文件，长代码建议使用此方法",
        "",
        "```javascript",
        '// 示例 1: 使用 code 参数直接执行代码',
        '{"code": "document.title", "window_id": "abc123"}',
        "",
        '// 示例 2: 使用 file_path 参数执行文件',
        '{"file_path": "scripts/extract-data.js", "window_id": "abc123", "is_async": true}',
        "",
        '// 示例 3: 使用 async/await (is_async: true)',
        'const response = await fetch("https://api.example.com/data");',
        'const data = await response.json();',
        'return data;',
        "",
        '// 示例 4: 同步代码',
        'document.title',
        "",
        '// 示例 5: 使用 Promise',
        'new Promise((resolve) => {',
        '  setTimeout(() => resolve("Hello after 1 second"), 1000);',
        '})',
        "```",
        "",
        "## 浏览器内文件存储 API（导出/保存到本地、读取本地文件）",
        "每个浏览器自动化窗口的渲染进程中都注入了 `window._browserBridge` 对象，支持在页面内部直接保存数据到本地文件或读取本地文件。支持文本、JSON 和二进制数据（通过 base64 编码）。你可以在 `run_js` 的代码中调用这些方法：",
        "",
        "- `window._browserBridge.saveLocalFile(filename, data, options?)` — 保存数据到本地文件（导出/下载）",
        '  - `filename`: 文件名（字符串,只能导出到工作目录下）',
        '  - `data`: 要保存的数据（字符串、对象或 base64 编码的二进制数据）',
        '  - `options.encoding`: 数据编码方式，`"utf8"`（默认，文本/JSON）或 `"base64"`（二进制数据）',
        '  - 返回: `{ success: boolean, filePath?: string, error?: string }`',
        "",
        "- `window._browserBridge.readLocalFile(filename, options?)` — 读取本地文件内容",
        '  - `filename`: 文件名（字符串）',
        '  - `options.encoding`: 读取编码方式，`"utf8"`（默认，返回文本）或 `"base64"`（返回 base64 编码字符串，用于二进制数据）',
        '  - 返回: `{ success: boolean, content?: string, error?: string }`',
        "",
        "文件自动保存到当前会话的工作目录中，不同会话之间相互隔离。",
        "",
        "```javascript",
        '// 示例 1: 保存文本/JSON 数据',
        'const data = { title: document.title, url: location.href, timestamp: Date.now() };',
        'const result = await window._browserBridge.saveLocalFile("page-data.json", data);',
        'return result;',
        "",
        '// 示例 2: 保存二进制数据（如 canvas 转图片）',
        'const canvas = document.querySelector("canvas");',
        'const base64Data = canvas.toDataURL("image/png").replace("data:image/png;base64,", "");',
        'const result = await window._browserBridge.saveLocalFile("screenshot.png", base64Data, { encoding: "base64" });',
        'return result;',
        "",
        '// 示例 3: 读取文本文件',
        'const result = await window._browserBridge.readLocalFile("page-data.json");',
        'return result;',
        "",
        '// 示例 4: 读取二进制文件（如图片）',
        'const result = await window._browserBridge.readLocalFile("screenshot.png", { encoding: "base64" });',
        'if (result.success) {',
        '  const img = document.createElement("img");',
        '  img.src = "data:image/png;base64," + result.content;',
        '  document.body.appendChild(img);',
        '}',
        'return result;',
        "",
        '// 示例 5: 获取 Cookie',
        'const result = await window._browserBridge.getCookies();',
        'return result.cookies;',
        "",
        '// 示例 6: 按 URL 过滤获取 Cookie',
        'const result = await window._browserBridge.getCookies({ url: "https://example.com" });',
        'return result.cookies;',
        "",
        '// 示例 7: 设置 Cookie',
        'const result = await window._browserBridge.setCookie({',
        '  url: "https://example.com",',
        '  name: "session_id",',
        '  value: "abc123",',
        '  expirationDate: Math.floor(Date.now() / 1000) + 86400',
        '});',
        'return result;',
        "",
        '// 示例 8: 删除 Cookie',
        'const result = await window._browserBridge.removeCookie("https://example.com", "session_id");',
        'return result;',
        "```",
      ].join("\n"),
    });
  }

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
        abortSignal.addEventListener("abort", () => {
          req.destroy();
        }, { once: true });
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
      context?.workspacePath,
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

  // ── 大结果处理 ──

  private async handleLargeStructResult(
    result: any,
    context?: PluginContext,
  ): Promise<string> {
    const MAX_SIZE_BYTES = 50 * 1024;
    const jsonString =
      typeof result === "string" ? result : JSON.stringify(result);
    const byteSize = Buffer.byteLength(jsonString, "utf-8");
    if (byteSize <= MAX_SIZE_BYTES) return jsonString;
    try {
      if (!context?.workspacePath) throw new Error("工作路径未提供");
      const outputDir = path.join(context.workspacePath, "tools_output");
      await fs.promises.mkdir(outputDir, { recursive: true });
      const fileName = `page_struct_output_${Date.now()}.json`;
      await fs.promises.writeFile(
        path.join(outputDir, fileName),
        jsonString,
        "utf-8",
      );
      return JSON.stringify({
        message: "结果过大，已保存到你的工作目录",
        file_path: path.join("tools_output", fileName),
        file_size_bytes: byteSize,
        file_size_kb: Math.round(byteSize / 1024),
      });
    } catch (error: any) {
      const truncated =
        jsonString.substring(0, MAX_SIZE_BYTES) + "\n... [结果被截断]";
      return JSON.stringify({
        error: `保存大结果失败: ${error.message}`,
        truncated_result: truncated,
        original_size_bytes: byteSize,
      });
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
