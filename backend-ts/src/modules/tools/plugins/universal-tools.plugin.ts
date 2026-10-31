import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginApi, ToolExecCtx } from "../../plugins/api/plugin-api";
import { PromptCollector } from "../../plugins/prompt-collector.service";
import {
  PluginContext,
  ToolHandlerDef,
} from "../../plugins/types/plugin.types";
import { ToolExecutor } from "../tool-executor.service";
import { ToolkitCatalogService } from "../toolkit-catalog.service";
import { HOOKS } from "../../chat/types/hooks.contract";
import langZh from "./universal-tools.lang.zh.json";
import langEn from "./universal-tools.lang.en.json";

@Injectable()
export class UniversalToolsPlugin extends PluginBase {
  private readonly logger = new Logger(UniversalToolsPlugin.name);

  /** sessionId → 工具包记忆提示词缓存（压缩后失效） */
  private toolkitMemoryCache = new Map<string, string>();

  manifest = {
    id: "universal_tools",
    name: "%universalTools.name%",
    description: "%universalTools.description%",
    version: "1.1.0",
    category: "system" as const,
    essential: true,
    icon: "images/plugins/universal_tools.svg",
  };

  constructor(
    private orchestrator: ToolExecutor,
    private toolkitCatalog: ToolkitCatalogService,
    private promptCollector: PromptCollector,
  ) {
    super();
  }

  /** 压缩发生后清除对应 session 的缓存，下次 getMessages 时自动重建 */
  @OnEvent(HOOKS.MEMORY_COMPACTED)
  handleCompacted(payload: { sessionId: string }) {
    if (this.toolkitMemoryCache.has(payload.sessionId)) {
      this.toolkitMemoryCache.delete(payload.sessionId);
      this.logger.debug(
        `Toolkit memory cache cleared for session ${payload.sessionId} after compression`,
      );
    }
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // 注册懒加载工具包：学习入口已由 skill_learn 承担（经 ToolkitCatalogService
    // 桥接，见 skill 插件），本插件只剩通用调用器 tool_use。
    // kit id 保留 lazy_tools：ToolExecutor.toFlatToolDefs 靠它判断
    // "没有 lazy 包时不广告 tool_use"。
    const lazyKit = api.registerToolKit({
      id: "lazy_tools",
      name: "%universalTools.toolkitName%",
      description: "%universalTools.toolkitDescription%",
      loadMode: "eager",
      activator:
        "Use skill_learn to learn toolkit usage, use tool_use to invoke specific tools",
    });

    // tool_use
    lazyKit.registerTool({
      name: "tool_use",
      description:
        "Use a specified tool to perform an operation. Pass the tool name and corresponding parameters to invoke any registered tool in the system. For lazy-loaded tools, call skill_learn(\"<toolkit>\") first to get their definitions.",
      inputSchema: z.object({
        tool_name: z.string().describe("Name of the tool to be called"),
        arguments: z
          .record(z.string(), z.any())
          .describe(
            "JSON object containing parameters for the lazy-loaded tool call, providing the appropriate parameter object according to the specific tool's requirements",
          ),
      }),
      execute: async (
        args: { tool_name: string; arguments: Record<string, any> },
        ctx?: ToolExecCtx,
        signal?: AbortSignal,
      ) => {
        const session = ctx?.session;
        if (!session) return "Error: Tool execution context not available";
        const result = await this.orchestrator.executeTool(
          args.tool_name,
          args.arguments,
          // 用外层真实 callId：常量 id 会让大结果落盘文件名在同轮多次 tool_use 时互相覆盖
          ctx?.toolCallId ?? "tool_use",
          session,
          signal,
          { allowLazy: true },
        );
        // 透传 images / imageRefs（多模态图片返回，base64 与磁盘引用两种形态，由引擎
        // 物化后注入为隐藏 user 消息）与 meta（内层工具的结构化结果元数据，如 todo 的
        // 待办列表）；不传则在本通道被静默丢弃。isError 也要透传，否则退役工具/参数
        // 校验失败等错误会退化成普通成功结果。
        if (
          result.isError ||
          result.images?.length ||
          result.imageRefs?.length ||
          result.meta
        ) {
          return {
            content: result.content,
            ...(result.isError ? { isError: true } : {}),
            ...(result.images?.length ? { images: result.images } : {}),
            ...(result.imageRefs?.length ? { imageRefs: result.imageRefs } : {}),
            ...(result.meta ? { meta: result.meta } : {}),
          };
        }
        return result.content;
      },
      display: {
        actionType: "tool_use",
        text: { executing: "%tool_use.executing%", completed: "%tool_use.completed%" },
        aggregate: { executing: "%tool_use.aggregate.executing%", completed: "%tool_use.aggregate.completed%" },
        argsKey: "tool_name",
        icon: "tool",
      },
    });

    // 工具包记忆提示词：注入到 system prompt（压缩后自动恢复 AI 正在使用的工具包定义）
    api.registerPrompt({
      frequency: "VOLATILE",
      description: "已加载工具包的工具定义（压缩后自动恢复）",
      content: async (context: PluginContext) => {
        return this.buildToolkitMemoryPrompt(context);
      },
    });
  }

  /**
   * 构建工具包记忆提示词。
   * 缓存命中 → 直接返回；缓存未命中 → 扫描历史 → 反查工具包 → 构建文本 → 回填缓存。
   *
   * 优化：如果历史中仍存在 skill_learn（或 legacy tool_learn）返回的完整工具定义
   * （首尾标记俱在、未被压缩裁掉），则跳过注入，避免重复占用 context。
   *
   * 学习入口已从 tool_learn 迁到 skill_learn（tool_use 不变），历史扫描两者兼容。
   */
  private async buildToolkitMemoryPrompt(
    context: PluginContext,
  ): Promise<string> {
    const sessionId = context.session.sessionId;

    // 缓存命中，直接返回（未压缩则一直命中）
    const cached = this.toolkitMemoryCache.get(sessionId);
    if (cached !== undefined) return cached;
    this.toolkitMemoryCache.set(sessionId, "");
    const history = await context.session.getHistory();
    if (!history || history.length === 0) return "";

    // ── 1. 单次遍历：收集 tool_use 调用、learn 调用与 learn 结果正文 ──
    const usedTools = new Set<string>();
    const learnedNames = new Set<string>();
    const learnContents: Array<{ name: string; content: string }> = [];

    for (const msg of history) {
      if (msg.role === "assistant") {
        for (const block of msg.content) {
          if (block.type !== "tool-call") continue;
          try {
            const args =
              typeof block.arguments === "string"
                ? JSON.parse(block.arguments)
                : block.arguments;
            if (block.name === "tool_use") {
              const toolName: string | undefined = args?.tool_name;
              if (toolName && typeof toolName === "string") {
                usedTools.add(toolName);
              }
            } else if (block.name === "skill_learn" || block.name === "tool_learn") {
              const name: string | undefined = args?.name ?? args?.toolkit;
              if (name && typeof name === "string") {
                learnedNames.add(name.toLowerCase());
              }
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      } else if (msg.role === "tool") {
        for (const block of msg.content) {
          if (block.type !== "tool-result") continue;
          if (block.name === "skill_learn" || block.name === "tool_learn") {
            learnContents.push({ name: block.name, content: block.content });
          }
        }
      }
    }

    if (usedTools.size === 0) return "";

    // ── 2. 反查每个工具所属的懒加载工具包，跳过定义仍在可见历史的包 ──
    const resolved = context.session.getResolvedPlugins();
    if (!resolved || resolved.length === 0) return "";

    // 规范化已学名称：与 resolved 中 kit id / name 对齐（legacy 名称可能不同）
    const existingKits = new Set<string>();
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      for (const tk of rp.enabledToolKits) {
        if (!tk.enabled || tk.loadMode !== "lazy") continue;
        if (
          learnedNames.has(tk.id.toLowerCase()) ||
          learnedNames.has((tk.name || "").toLowerCase())
        ) {
          existingKits.add(tk.id);
        }
      }
    }

    // kitId → 该包内被使用过的工具
    const kitToolsMap = new Map<
      string,
      { tools: ToolHandlerDef[]; pluginId: string }
    >();

    for (const rp of resolved) {
      if (!rp.enabled) continue;

      // 预处理本插件中懒加载工具包的 id → 显示名映射（避免 nested loop + filter）
      const lazyKitMeta = new Map<string, { kitName: string }>();
      for (const tk of rp.enabledToolKits) {
        if (!tk.enabled || tk.loadMode !== "lazy") continue;
        lazyKitMeta.set(tk.id, { kitName: tk.id });
      }
      if (lazyKitMeta.size === 0) continue;

      // 单次遍历 allTools，直接查懒加载映射
      for (const t of rp.allTools) {
        if (!usedTools.has(t.name) || !t.toolSet) continue;
        const meta = lazyKitMeta.get(t.toolSet);
        if (!meta) continue;
        // 该包的完整定义仍在可见历史（skill_learn 结果未被裁剪）→ 不重复注入
        const stillComplete = learnContents.some((lc) =>
          this.toolkitCatalog.hasCompleteSkillContent(
            lc.name,
            lc.content,
            t.toolSet!,
          ),
        );
        // existingKits 存的是规范 kit id（learn 参数可能是展示名，已对齐）
        if (existingKits.has(t.toolSet) || stillComplete) continue;

        let entry = kitToolsMap.get(t.toolSet);
        if (!entry) {
          entry = { tools: [], pluginId: rp.plugin.id };
          kitToolsMap.set(t.toolSet, entry);
        }
        entry.tools.push(t);
      }
    }

    if (kitToolsMap.size === 0) {
      return "";
    }

    // ── 3. 逐工具包构建完整描述（工具定义 + 使用说明），回填缓存 ──
    const parts: string[] = [
      "The following are toolkits you learned earlier in the conversation and are still actively using.",
      "",
    ];

    for (const [kitName, { tools, pluginId }] of kitToolsMap) {
      const content = await this.buildKitContent(kitName, tools, pluginId, resolved, context);
      if (content) parts.push(content);
    }

    const result = "# LEARNED TOOLKITS\n" + parts.join("\n\n");

    // 回填缓存
    this.toolkitMemoryCache.set(sessionId, result);
    return result;
  }

  /**
   * 构建单个工具包的完整内容（工具定义 + 使用说明）。
   *
   * 与 ToolkitCatalogService.buildToolSkillContent 输出同构（不含首尾标记），
   * 保证压缩记忆注入与 skill_learn 返回的内容格式一致。
   */
  private async buildKitContent(
    kitName: string,
    tools: ToolHandlerDef[],
    pluginId: string,
    resolved: import("../../plugins/types/plugin.types").ResolvedPluginInfo[],
    context: PluginContext,
  ): Promise<string> {
    const parts: string[] = [];

    if (tools.length > 0) {
      const toolDescriptions = tools
        .map((tool) => {
          // 按原生 function-calling 形状序列化为单个 JSON 对象 {name, description, parameters}，
          // 与 openai.adapter 的 function 字段及内部 ToolDefinition 同构
          const toolJson = JSON.stringify(
            {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
            null,
            2,
          );
          return [`<tool_definition>`, toolJson, `</tool_definition>`].join("\n");
        })
        .join("\n\n");
      parts.push(`toolkit ${kitName}`, "", toolDescriptions);
    }

    // 使用说明 prompt（lazy prompts）
    let toolUsagePrompt = "";
    try {
      const prompts = await this.promptCollector.collectLazyPrompts(
        resolved,
        context,
      );
      const tsPrompts = prompts.filter((p: any) => p.pluginId === pluginId);
      if (tsPrompts.length > 0) {
        toolUsagePrompt = tsPrompts.map((p: any) => p.content).join("\n\n");
      }
    } catch {}
    if (toolUsagePrompt) parts.push(toolUsagePrompt);
    parts.push("---");
    return parts.join("\n");
  }
}
