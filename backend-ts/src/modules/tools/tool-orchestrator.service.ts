import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
} from "./interfaces/tool-provider.interface";
import { ToolRuntime } from "./tool-context";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { PluginInstance, PluginManager } from "../plugins/plugin.manager";
import {
  PluginContext,
  PluginManifest,
  ToolHandlerDef,
  ToolLoadMode,
  PluginConfig,
} from "../plugins/types/plugin.types";
import { TokenizerService } from "../../common/utils/tokenizer.service";

@Injectable()
export class ToolOrchestrator {
  private readonly logger = new Logger(ToolOrchestrator.name);

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly pluginManager: PluginManager,
    private readonly tokenizerService: TokenizerService,
  ) {}
  async resolveAvailableTools(role?: PluginConfig): Promise<
    {
      enabled: boolean;
      effective: "global" | "role";
      plugin: PluginManifest;
      enabledTools: ToolHandlerDef[];
      allTools: ToolHandlerDef[];
    }[]
  > {
    const rawGlobal = await this.settingsStorage.getSettings("plugins");
    const globalCfg = this.normalizePluginConfig(rawGlobal);
    const rawRole = role;
    const roleCfg = this.normalizePluginConfig(rawRole);
    const pluginToosList: {
      enabled: boolean;
      effective: "global" | "role";
      plugin: PluginManifest;
      enabledTools: ToolHandlerDef[];
      allTools: ToolHandlerDef[];
    }[] = [];
    for (const instance of this.pluginManager.getAllPluginRegistrations()) {
      const pluginId = instance.manifest.id;
      const tools = this.pluginManager.getPluginTools(pluginId);
      const manifest = instance.manifest;
      const result = this.resolvePluginEnabledTools(
        globalCfg,
        roleCfg,
        manifest,
        tools,
      );
      pluginToosList.push({
        enabled: result.enabled,
        effective: result.effective,
        plugin: manifest,
        enabledTools: result.tools,
        allTools: tools,
      });
    }
    return pluginToosList;
  }

  async buildToolRuntime(injectParams: PluginContext): Promise<ToolRuntime> {
    const pluginAvailableTools = await this.resolveAvailableTools(
      injectParams.tools,
    );
    const allToolSets =
      await this.pluginManager.getPluginToolSets(injectParams);

    const eagerTools = new Map<string, ToolHandlerDef>();
    const lazyToolSets = new Map<
      string,
      { tools: ToolHandlerDef[]; pluginId: string }
    >();
    const toolNames = new Set<string>();

    const toolSetLoadModes = new Map<string, ToolLoadMode>();
    for (const group of allToolSets) {
      for (const ts of group.toolSets) {
        toolSetLoadModes.set(ts.name, ts.loadMode);
      }
    }

    for (const { enabled, plugin, enabledTools } of pluginAvailableTools) {
      if (!enabled) continue;

      const lazyByToolSet = new Map<string, ToolHandlerDef[]>();

      for (const tool of enabledTools) {
        const loadMode = tool.toolSet
          ? (toolSetLoadModes.get(tool.toolSet) ?? "eager")
          : "eager";

        let toolAllowed = true;
        if (Array.isArray(enabled)) {
          toolAllowed = enabled.includes(tool.name);
        }
        if (!toolAllowed) continue;

        if (toolNames.has(tool.name)) {
          this.logger.warn(`Duplicate tool name: ${tool.name}`);
          continue;
        }
        toolNames.add(tool.name);

        if (loadMode === "lazy") {
          const ts = tool.toolSet || "__default";
          if (!lazyByToolSet.has(ts)) lazyByToolSet.set(ts, []);
          lazyByToolSet.get(ts)!.push(tool);
        } else if (loadMode === "eager") {
          eagerTools.set(tool.name, tool);
        }
      }

      for (const [ts, tsTools] of lazyByToolSet) {
        lazyToolSets.set(ts, { tools: tsTools, pluginId: plugin.id });
      }
    }

    return new ToolRuntime(
      injectParams,
      eagerTools,
      lazyToolSets,
      injectParams.tools,
    );
  }

  async buildRuntimeByScope(
    injectParams: PluginContext,
    scope: string,
  ): Promise<ToolRuntime> {
    const allGroups = await this.pluginManager.getTools(injectParams);

    let allowedPluginIds: string[] | null = null;
    if (scope === "memory_only") {
      allowedPluginIds = ["file"];
    } else {
      allowedPluginIds = [];
    }

    const scopeGroups = allowedPluginIds
      ? allGroups.filter((g) => allowedPluginIds!.includes(g.pluginId))
      : [];

    const fileTools = scopeGroups.flatMap((g) => g.tools);

    if (fileTools.length === 0) {
      return new ToolRuntime(
        { ...injectParams, scope },
        new Map(),
        new Map(),
      );
    }

    return new ToolRuntime(
      { ...injectParams, scope },
      new Map(fileTools.map((t) => [t.name, t])),
      new Map(),
    );
  }

  private normalizePluginConfig(
    toolsConfig: PluginConfig,
    mcpServersConfig?: any,
  ): PluginConfig {
    let merged: Record<string, boolean | string[]>;

    if (typeof toolsConfig === "boolean") {
      merged = {};
    } else if (Array.isArray(toolsConfig)) {
      merged = {};
      for (const id of toolsConfig) merged[id] = true;
    } else {
      merged = { ...toolsConfig };
    }

    if (
      mcpServersConfig &&
      typeof mcpServersConfig === "object" &&
      merged.mcp !== false
    ) {
      merged.mcp = mcpServersConfig;
    }

    return merged;
  }

  public resolvePluginEnabledTools(
    global: PluginConfig,
    role: PluginConfig,
    plugin: PluginManifest,
    tools: ToolHandlerDef[],
  ): {
    enabled: boolean;
    effective: "global" | "role";
    tools: ToolHandlerDef[];
  } {
    const resolve = (
      val: boolean | string[] | undefined,
      effective: "global" | "role",
    ) => {
      if (val === true) return { enabled: true, effective, tools };
      if (Array.isArray(val) && val.length > 0) {
        return {
          enabled: true,
          effective,
          tools: val
            .map((id) => tools.find((t) => t.name === id))
            .filter((t): t is ToolHandlerDef => !!t),
        };
      }
      return { enabled: false, effective, tools: [] };
    };

    if (plugin.id in global && global[plugin.id] === false)
      return { enabled: false, effective: "global", tools: [] };

    const defaultEnabled = plugin.category === "core";

    if (plugin.id in role) {
      if (plugin.id in global) return resolve(role[plugin.id], "role");
      if (defaultEnabled) return resolve(role[plugin.id], "role");
      return { enabled: false, effective: "global", tools: [] };
    }

    if (plugin.id in global) return resolve(global[plugin.id], "global");

    return { enabled: defaultEnabled, effective: "global", tools: tools };
  }

  async executeBatch(
    requests: ToolCallRequest[],
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse[]> {
    const responses: ToolCallResponse[] = new Array(requests.length);
    const MAX_CONCURRENCY = 10;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < requests.length) {
        if (abortSignal?.aborted) break;
        const index = nextIndex++;
        const req = requests[index];
        try {
          responses[index] = await this.execute(req, context, abortSignal);
        } catch (error: any) {
          responses[index] = {
            toolCallId: req.id,
            name: req.name,
            content: `Error: ${error.message || String(error)}`,
            isError: true,
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENCY, requests.length) }, () =>
        worker(),
      ),
    );
    return responses;
  }

  private async execute(
    request: ToolCallRequest,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    return await this.executeTool(
      request.name,
      request.arguments,
      request.id,
      context,
      abortSignal,
    );
  }

  // ── 公开方法（供 UniversalToolsPlugin 调用） ──

  async executeTool(
    fullToolName: string,
    toolArgs: any,
    toolCallId: string,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    if (!context.hasTool(fullToolName))
      throw new Error(`Tool ${fullToolName} is not available or disabled`);

    // 直接从 runtime 获取 handler（已含角色过滤，无需再查 PluginManager）
    const toolEntry = context.eagerTools.get(fullToolName)
      ?? Array.from(context.lazyToolSets.values())
           .flatMap((ls) => ls.tools)
           .find((t) => t.name === fullToolName);
    if (!toolEntry) throw new Error(`Tool handler not found: ${fullToolName}`);

    try {
      let validatedArgs = toolArgs;
      if (toolEntry._zodSchema) {
        const result = toolEntry._zodSchema.safeParse(toolArgs);
        if (!result.success) {
          return {
            toolCallId,
            name: fullToolName,
            content: `参数校验失败：${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
            isError: true,
          };
        }
        validatedArgs = result.data;
      }

      // 将 ToolRuntime 注入 injectParams，供工具 handler 内获取
      (context.injectParams as any).__runtime = context;

      let content = await toolEntry.handler(
        validatedArgs,
        context.injectParams,
        abortSignal,
      );

      if (typeof content === 'object' && content !== null) {
        content = JSON.stringify(content);
      }

      if (content && fullToolName !== 'read') {
        content = await this.handleLargeResult(content, fullToolName, toolCallId, context);
      }
      return { toolCallId, name: fullToolName, content, isError: false };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing tool ${fullToolName}: ${errorMsg}`);
      return {
        toolCallId,
        name: fullToolName,
        content: JSON.stringify({ success: false, message: errorMsg }),
        isError: true,
      };
    }
  }

  // ── 工具列表（前端 UI 用） ──

  async getLocalToolsList(roleCfg?: PluginConfig): Promise<any[]> {
    const toolsList: any[] = [];

    for (const instance of await this.resolveAvailableTools(roleCfg)) {
      const { enabled, effective, plugin, enabledTools, allTools } = instance;

      toolsList.push({
        pluginId: plugin.id,
        effective,
        name: plugin.id,
        displayName: plugin.name,
        description: plugin.description,
        category: plugin.category,
        enabled,
        isMcp: plugin.id === "mcp",
        isSkill: plugin.id === "skill",
        tools: allTools.map((t) => ({
          enabled: enabledTools.some((e) => e.name === t.name),
          name: t.name,
          description: t.description,
          parameters: t.parameters as any,
        })),
      });
    }
    return toolsList;
  }

  // ── 大结果处理 ──

  private async handleLargeResult(
    content: string,
    toolName: string,
    toolCallId: string,
    context: ToolRuntime,
  ): Promise<string> {
    const MAX_TOKENS = 20000;
    const PREVIEW_BYTES = 2048;

    let tokenCount: number;
    try {
      tokenCount = await this.tokenizerService.countTextTokens('default', content, false);
    } catch {
      tokenCount = Math.ceil(Buffer.byteLength(content, 'utf-8') / 4);
    }
    if (tokenCount <= MAX_TOKENS) return content;

    const preview = content.substring(0, PREVIEW_BYTES);

    const workspacePath = context.injectParams?.workspacePath;
    if (!workspacePath) {
      return JSON.stringify({
        warning: `结果过大（约 ${tokenCount} tokens），且无法保存到工作目录`,
        preview,
        tool_truncated_hint: '请使用 read 工具读取文件，或要求缩小范围',
      });
    }

    try {
      const outputDir = path.join(workspacePath, '.guada', 'tools_output');
      await fs.mkdir(outputDir, { recursive: true });
      const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${safeName}_${toolCallId}.json`;
      await fs.writeFile(path.join(outputDir, fileName), content, 'utf-8');
      return JSON.stringify({
        message: `结果较大（约 ${tokenCount} tokens），已保存到工作目录`,
        file_path: path.join('.guada', 'tools_output', fileName),
        preview,
        tool_truncated_hint: `完整结果已保存至上述文件。如需读取，请使用 read 工具并指定 file_path 参数为 "${path.join('.guada', 'tools_output', fileName)}"，可配合 unit/offset/limit 分块读取（unit="char" 按字符偏移读取）。`,
      });
    } catch (saveError: any) {
      this.logger.warn(`保存大结果到文件失败: ${saveError.message}，回退到截断`);
      return JSON.stringify({
        warning: '结果过大且无法保存到文件',
        preview,
        tool_truncated_hint: '请使用 read 工具读取文件，或要求缩小范围',
        token_count: tokenCount,
      });
    }
  }
}
