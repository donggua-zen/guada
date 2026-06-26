import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
} from "./interfaces/tool-provider.interface";
import {
  UniversalToolHandler,
  UNIVERSAL_TOOLS,
} from "./universal-tool-handler";
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

/**
 * MCP 配置以 toolsConfig.mcp 字段形式存在
 */

@Injectable()
export class ToolOrchestrator {
  private readonly logger = new Logger(ToolOrchestrator.name);
  private universalHandler: UniversalToolHandler;

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly pluginManager: PluginManager,
    private readonly tokenizerService: TokenizerService,
  ) {
    this.universalHandler = new UniversalToolHandler();
  }
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
      // 即使 disabled 也要获取 tools（onLoad 始终调用，PluginRegistry 有数据）
      const tools = this.pluginManager.getPluginTools(pluginId);
      const manifest = instance.manifest;
      const result = this.resolvePluginEnabledTools(
        globalCfg,
        roleCfg,
        manifest,
        tools,
      );
      // console.log(result);
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
  // ── 构建工具运行时 ──

  async buildToolRuntime(injectParams: PluginContext): Promise<ToolRuntime> {
    const pluginAvailableTools = await this.resolveAvailableTools(
      injectParams.tools,
    );
    const allToolSets =
      await this.pluginManager.getPluginToolSets(injectParams);

    // // 1. 读取全局配置并标准化
    // const rawGlobal = await this.settingsStorage.getSettings("plugins");
    // const globalCfg = this.normalizePluginConfig(rawGlobal, undefined);

    // // 2. 标准化角色/会话配置 + 合并 MCP
    // const roleCfg = this.normalizePluginConfig(toolsConfig, mcpServersConfig);

    const eagerTools = new Map<string, ToolDefinition>();
    const lazyToolSets = new Map<
      string,
      { tools: ToolDefinition[]; pluginId: string }
    >();
    const toolNames = new Set<string>();

    // 先获取所有已解析运行时的 ToolSet 信息
    // const allToolSets =
    // await this.pluginManager.getPluginToolSets(injectParams);
    // 构建 toolSet → loadMode 查找表
    const toolSetLoadModes = new Map<string, ToolLoadMode>();
    for (const group of allToolSets) {
      for (const ts of group.toolSets) {
        toolSetLoadModes.set(ts.name, ts.loadMode);
      }
    }

    for (const { enabled, plugin, enabledTools } of pluginAvailableTools) {
      // const enabled = this.resolvePluginEnabledTools(
      //   globalCfg,
      //   roleCfg,
      //   plugin.id,
      //   manifest?.category,
      // );
      if (!enabled) continue;

      const lazyByToolSet = new Map<string, ToolDefinition[]>();

      for (const tool of enabledTools) {
        // 根据 tool.toolSet 查表获取加载模式
        const loadMode = tool.toolSet
          ? (toolSetLoadModes.get(tool.toolSet) ?? "eager")
          : "eager";

        // 细粒度过滤：如果 enabled 是 string[]，只包含数组中的工具
        let toolAllowed = true;
        if (Array.isArray(enabled)) {
          toolAllowed = enabled.includes(tool.name);
        }
        if (!toolAllowed) continue;

        const def: ToolDefinition = {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as any,
          action: tool.action,
          icon: tool.icon,
          argsKey: tool.argsKey,
        };

        if (toolNames.has(tool.name)) {
          this.logger.warn(`Duplicate tool name: ${tool.name}`);
          continue;
        }
        toolNames.add(tool.name);

        if (loadMode === "lazy") {
          const ts = tool.toolSet || "__default";
          if (!lazyByToolSet.has(ts)) lazyByToolSet.set(ts, []);
          lazyByToolSet.get(ts)!.push(def);
        } else if (loadMode === "eager") {
          eagerTools.set(tool.name, def);
        }
        // loadMode === "none" 则跳过
      }

      // 注册懒加载工具集
      for (const [ts, tsTools] of lazyByToolSet) {
        lazyToolSets.set(ts, { tools: tsTools, pluginId: plugin.id });
      }
    }

    // 有懒加载工具集时添加通用工具
    if (lazyToolSets.size > 0) {
      for (const ut of UNIVERSAL_TOOLS) {
        eagerTools.set(ut.name, ut);
      }
    }

    return new ToolRuntime(
      injectParams,
      eagerTools,
      lazyToolSets,
      injectParams.tools,
    );
  }

  /**
   * 按作用域构建受限的工具运行时
   *
   * "memory_only" 作用域：只暴露文件插件的工具，并在 injectParams 中注入 scope 标记，
   * 文件工具内部根据 scope 决定是否进行路径限制。
   */
  async buildRuntimeByScope(
    injectParams: PluginContext,
    scope: string,
  ): Promise<ToolRuntime> {
    const allGroups = await this.pluginManager.getTools(injectParams);

    // 只对已知 scope 做精确放行，未知 scope 返回空工具（防手误）
    let allowedPluginIds: string[] | null = null;
    if (scope === "memory_only") {
      allowedPluginIds = ["file"];
    } else {
      // 未知 scope：不暴露任何工具
      allowedPluginIds = [];
    }

    const scopeGroups = allowedPluginIds
      ? allGroups.filter((g) => allowedPluginIds!.includes(g.pluginId))
      : [];

    // ... rest unchanged
    const fileTools = scopeGroups.flatMap((g) => g.tools).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
      action: t.action,
      icon: t.icon,
      argsKey: t.argsKey,
    }));

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

  /**
   * 标准化 toolsConfig：旧格式转对象 + 合并 MCP 配置
   */
  private normalizePluginConfig(
    toolsConfig: PluginConfig,
    mcpServersConfig?: any,
  ): PluginConfig {
    let merged: Record<string, boolean | string[]>;

    // 旧格式转换
    if (typeof toolsConfig === "boolean") {
      // 旧版 true/false → 空对象（后续由 resolvePluginEnabledTools 按类型推导）
      merged = {};
    } else if (Array.isArray(toolsConfig)) {
      // 旧版 string[] → { pluginId: true }
      merged = {};
      for (const id of toolsConfig) merged[id] = true;
    } else {
      merged = { ...toolsConfig };
    }

    // MCP 配置直接存入 merged.mcp
    if (
      mcpServersConfig &&
      typeof mcpServersConfig === "object" &&
      merged.mcp !== false
    ) {
      merged.mcp = mcpServersConfig;
    }

    return merged;
  }

  /**
   * 判断插件是否启用：全局与角色直接传入，不提前合并
   *
   * 规则：
   * 1. 全局禁用（值为 false）→ 角色不可覆盖
   * 2. 角色有配置 → 全局已定义则采纳；全局未定义时仅 core 可采纳
   * 3. 角色未配置、全局有值 → 用全局
   * 4. 完全未配置 → core=true，其余=false
   */
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

    // 1. 全局禁用 → 不可覆盖
    if (plugin.id in global && global[plugin.id] === false)
      return { enabled: false, effective: "global", tools: [] };

    const defaultEnabled = plugin.category === "core";

    // 2. 角色有配置
    if (plugin.id in role) {
      // 全局已定义 → 角色可覆盖
      if (plugin.id in global) return resolve(role[plugin.id], "role");
      // 全局未定义 + core → 采纳角色
      if (defaultEnabled) return resolve(role[plugin.id], "role");
      // 全局未定义 + 非 core → 不可激活
      return { enabled: false, effective: "global", tools: [] };
    }

    // 3. 角色未配置，全局有值
    if (plugin.id in global) return resolve(global[plugin.id], "global");

    // 4. 完全未配置 → 按类型默认
    return { enabled: defaultEnabled, effective: "global", tools: tools };
  }

  // ── 批量执行工具 ──

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

    if (abortSignal?.aborted) {
      for (let i = 0; i < requests.length; i++) {
        if (!responses[i])
          responses[i] = {
            toolCallId: requests[i].id,
            name: requests[i].name,
            content: "Error: Request was aborted",
            isError: true,
          };
      }
    }
    return responses;
  }

  private async execute(
    request: ToolCallRequest,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    if (request.name === "tool_load") {
      return await this.handleToolLoad(request, context);
    }
    if (request.name === "tool_call") {
      const { fullToolName, toolArgs } =
        this.universalHandler.parseToolCall(request);
      return await this.executeTool(
        fullToolName,
        toolArgs,
        request.id,
        context,
        abortSignal,
      );
    }
    return await this.executeTool(
      request.name,
      request.arguments,
      request.id,
      context,
      abortSignal,
    );
  }

  /**
   * 处理 tool_load 请求：通过 PluginManager 加载插件详细说明
   */
  private async handleToolLoad(
    request: ToolCallRequest,
    context: ToolRuntime,
  ): Promise<ToolCallResponse> {
    const { toolSet } = request.arguments;

    if (!toolSet || typeof toolSet !== "string") {
      return {
        toolCallId: request.id,
        name: request.name,
        content: "Error: 无效的参数：toolSet 必须是字符串",
        isError: true,
      };
    }

    // 通过 runtime 预建结构直接获取懒加载工具集
    const lazySet = context.getLazyToolSet(toolSet);
    if (!lazySet) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 未知的工具集: ${toolSet}`,
        isError: true,
      };
    }

    const plugin = this.pluginManager.getPlugin(lazySet.pluginId);
    if (!plugin || !plugin.enabled) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 工具集 ${toolSet} 不可用`,
        isError: true,
      };
    }

    try {
      // 直接从 lazySet 获取工具定义
      const tools = lazySet.tools;

      // 获取该 toolSet 关联的 lazy 提示词
      let toolUsagePrompt = "";
      try {
        const prompts = await this.pluginManager.collectLazyPrompts(
          context.injectParams,
        );
        const tsPrompts = prompts.filter(
          (p: any) => p.pluginId === lazySet.pluginId,
        );
        if (tsPrompts.length > 0) {
          toolUsagePrompt = tsPrompts.map((p: any) => p.content).join("\n\n");
        }
      } catch {}

      // 工具和提示词都为 0 才报错
      if (tools.length === 0 && !toolUsagePrompt) {
        return {
          toolCallId: request.id,
          name: request.name,
          content: `Error: 工具集 ${toolSet} 下没有可加载的内容`,
          isError: true,
        };
      }

      const responseParts: string[] = [];

      if (tools.length > 0) {
        const toolDescriptions = tools
          .map((tool) => {
            const params = tool.parameters?.properties || {};
            const required = tool.parameters?.required || [];

            const paramList = Object.entries(params)
              .map(([key, value]: [string, any]) => {
                const isRequired = required.includes(key);
                const type = value.type || "string";
                const description = value.description || "";
                const enumStr = value.enum
                  ? ` enum="${value.enum.join("|")}"`
                  : "";
                const defaultStr =
                  value.default !== undefined
                    ? ` default="${value.default}"`
                    : "";
                return [
                  `      <param name="${key}" required="${isRequired}" type="${type}"${defaultStr}${enumStr}>`,
                  `        <description>${description}</description>`,
                  `      </param>`,
                ].join("\n");
              })
              .join("\n");

            return [
              `  <tool name="${tool.name}">`,
              `    <description>${tool.description}</description>`,
              `    <parameters>`,
              paramList,
              `    </parameters>`,
              `  </tool>`,
            ].join("\n");
          })
          .join("\n");

        responseParts.push(
          `<tool_set name="${toolSet}">`,
          "",
          toolDescriptions,
          `</tool_set>`,
        );
      }

      if (toolUsagePrompt) {
        if (responseParts.length > 0) responseParts.push("---", "");
        responseParts.push(toolUsagePrompt);
      }

      if (responseParts.length > 0) {
        responseParts.push(
          "---",
          "",
          "**使用方式**:",
          "直接调用工具，格式为：`tool_name`，或者使用`tool_call`间接调用",
          "",
          "现在你可以根据上述说明调用相应的工具了。",
        );
      }

      return {
        toolCallId: request.id,
        name: request.name,
        content: responseParts.join("\n"),
        isError: false,
      };
    } catch (error: any) {
      this.logger.error(`Error executing tool_load`, error);
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: ${error.message}`,
        isError: true,
      };
    }
  }

  private async executeTool(
    fullToolName: string,
    toolArgs: any,
    toolCallId: string,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    if (!context.hasTool(fullToolName))
      throw new Error(`Tool ${fullToolName} is not available or disabled`);

    const allGroups = await this.pluginManager.getTools(context.injectParams);
    const allTools = allGroups.flatMap((g) => g.tools);
    const toolEntry = allTools.find((t) => t.name === fullToolName);
    if (!toolEntry) throw new Error(`Tool handler not found: ${fullToolName}`);

    try {
      // Zod 运行时校验（仅当工具通过 inputSchema 注册时）
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

      let content = await toolEntry.handler(
        validatedArgs,
        context.injectParams,
        abortSignal,
      );

      // 统一序列化：工具返回对象时自动转字符串，返回字符串时保持原样
      if (typeof content === 'object' && content !== null) {
        content = JSON.stringify(content);
      }

      // 判断工具所属插件是否为 file 插件（file 插件有自身的长度控制，豁免大结果处理）
      // const toolPluginId = allGroups.find(g =>
      //   g.tools.some(t => t.name === fullToolName)
      // )?.pluginId;

      // 大结果处理：非 file 插件的结果过大时保存到文件
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

  /**
   * 处理过大的工具结果：使用 tiktoken 快速计数，超过 20K tokens 时保存到文件
   * 返回 2KB 预览 + 文件路径，并引导 AI 分段读取
   * file 插件在调用前已豁免，不会进入此方法
   */
  private async handleLargeResult(
    content: string,
    toolName: string,
    toolCallId: string,
    context: ToolRuntime,
  ): Promise<string> {
    const MAX_TOKENS = 20000;
    const PREVIEW_BYTES = 2048;

    // 使用 tiktoken（cl100k_base）快速计数
    let tokenCount: number;
    try {
      tokenCount = await this.tokenizerService.countTextTokens('default', content, false);
    } catch {
      // 分词器失败时回退到字节估算（约 4 字符/token）
      tokenCount = Math.ceil(Buffer.byteLength(content, 'utf-8') / 4);
    }
    if (tokenCount <= MAX_TOKENS) return content;

    // 预览：取前 2KB
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
