import { PluginBase, type PluginApi } from "../../backend-ts/src/modules/plugins";
import { z } from "zod";

/**
 * 示例插件 —— 同时演示 v3 的三项能力：
 *   1. registerRoute：自定义 HTTP 路由（含流式）
 *   2. complete / completeStream / listModels：调用宿主已配置的模型
 *   3. registerSlot('main') / registerSlot('conversation.side.panel')：全页工作台 + 对话右侧面板
 */
export default class HelloPlugin extends PluginBase {
  manifest = {
    id: "hello-plugin",
    name: "Hello Plugin",
    version: "1.1.0",
    description: "示例外部插件（工具 / 提示词 / HTTP 路由 / 模型调用 / 页面槽位）",
    category: "user" as const,
  };

  /** v3：直连路由里复用同一段问候逻辑 */
  private greet(name?: string): string {
    const who = String(name || "").trim() || "世界";
    return `你好，${who}！这是来自外部插件的问候。`;
  }

  async onLoad(api: PluginApi) {
    this.registerTools(api);
    this.registerPrompt(api);
    this.registerRoutes(api);
    this.registerUi(api);
    this.registerRpc(api);
  }

  // ── 工具 ──
  private registerTools(api: PluginApi) {
    api.registerTool({
      name: "hello_say",
      description: "打个招呼。用户说你好、打招呼时使用。",
      inputSchema: z.object({
        name: z.string().describe("要称呼的名字"),
      }),
      execute: async (args: any) => this.greet(args?.name),
      display: { actionType: "hello", argsKey: "name", icon: "message" },
    } as any);

    // v3：模型能力演示——让模型"自我介绍一句"
    api.registerTool({
      name: "hello_model_echo",
      description:
        "调用宿主已配置的模型，让它用一句话介绍自己。用于验证插件的 LLM 能力。",
      inputSchema: z.object({
        modelId: z.string().optional().describe("可选：指定模型 id；缺省用第一个可用模型"),
      }),
      dangerLevel: "normal" as const,
      execute: async (args: any) => {
        const result = await api.complete({
          modelId: args?.modelId,
          system: "你是一个简洁的助手，只回答一句话。",
          prompt: "用一句话介绍你自己。",
          maxTokens: 120,
        });
        return `模型 ${result.model} 说：${result.text.trim()}`;
      },
      display: { argsKey: "modelId", icon: "sparkle" },
    } as any);
  }

  // ── 提示词 ──
  private registerPrompt(api: PluginApi) {
    api.registerPrompt({
      content: "## Hello Plugin\n这是一个示例外部插件，提供 hello_say 工具。",
      frequency: "REGULAR",
      description: "Hello Plugin 说明",
    });
  }

  // ── v3：HTTP 路由 ──
  private registerRoutes(api: PluginApi) {
    // 精确路径 + JSON
    api.registerRoute({
      method: "POST",
      path: "api/ping",
      handler: (_req, res, ctx) => {
        const name = (ctx.body as any)?.name;
        res.status(200).json({ ok: true, message: this.greet(name), dataDir: ctx.dataDir });
      },
    });

    // 路径参数
    api.registerRoute({
      method: "GET",
      path: "api/echo/:name",
      handler: (_req, res, ctx) => {
        res.json({ name: ctx.params.name, message: this.greet(ctx.params.name) });
      },
    });

    // 流式（SSE）：验证 res.write 多次可用
    api.registerRoute({
      method: "GET",
      path: "api/stream",
      handler: async (_req, res) => {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        for (let i = 1; i <= 3; i++) {
          res.write(`data: ${JSON.stringify({ tick: i })}\n\n`);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        res.write("data: [DONE]\n\n");
        res.end();
      },
    });
  }

  // ── v3：页面槽位 ──
  private registerUi(api: PluginApi) {
    api.registerSlot({
      name: "main",
      component: "Workbench",
      mode: "single",
      order: 200,
      meta: { label: "Hello 工作台", icon: "puzzle" },
    });

    api.registerSlot({
      name: "conversation.side.panel",
      component: "Workbench",
      mode: "tabs",
      order: 200,
      meta: { label: "Hello", icon: "puzzle" },
    });
  }

  /**
   * 同一份前端产物服务两个槽位：
   * - 作为 `main` 时 props.sessionId = null（全页）
   * - 作为 `conversation.side.panel` 时带当前会话 id
   */

  // ── v3：RPC（前端按钮 → 后端 LLM） ──
  private registerRpc(api: PluginApi) {
    api.registerRpc({
      // 非流式：一句话自我介绍
      demo_complete: async (args: any) => {
        const result = await api.complete({
          modelId: args?.modelId,
          system: "你是一个简洁的助手，只回答一句话。",
          prompt: String(args?.prompt || "用一句话介绍你自己。"),
          maxTokens: 200,
        });
        return { ok: true, model: result.model, text: result.text, usage: result.usage };
      },

      // 模型清单
      demo_models: async () => ({ models: await api.listModels() }),

      // 流式：返回完整文本 + 分片数（浏览器端也可以直接 fetch /http 路由看 SSE）
      demo_stream: async (args: any) => {
        const chunks: string[] = [];
        for await (const chunk of api.completeStream({
          modelId: args?.modelId,
          prompt: String(args?.prompt || "数到三。"),
          maxTokens: 200,
        })) {
          if (chunk.type === "text" && chunk.text) chunks.push(chunk.text);
        }
        return { ok: true, text: chunks.join(""), chunks: chunks.length };
      },

      // 路由自检：返回本插件注册的示例路由，供页面展示
      demo_links: async () => ({
        ping: "http/api/ping",
        echo: "http/api/echo/hello",
        stream: "http/api/stream",
      }),
    });
  }
}
