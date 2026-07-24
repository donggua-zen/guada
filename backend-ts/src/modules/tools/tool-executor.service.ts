import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
} from "./interfaces/tool-provider.interface";
import { PluginManager } from "../plugins/plugin.manager";
import { PluginRegistry } from "../plugins/registry/plugin-registry";
import {
  PluginContext,
  ToolHandlerDef,
  ResolvedPluginInfo,
} from "../plugins/types/plugin.types";
import { ISessionContext } from "../chat/session-context";
import { TokenizerService } from "../../common/utils/tokenizer.service";

/**
 * 工具执行器
 *
 * 职责：
 * 直接消费 ResolvedPluginInfo[]，执行工具调用（含 Zod 校验、大结果处理）。
 * 不包装运行时快照，消费方传递决议数据即可。
 *
 * 属于 tools 特性模块，不归 plugins 管。
 */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly tokenizerService: TokenizerService,
  ) {}

  // ==================== 工具查找工具函数 ====================

  /**
   * 从已决议的插件信息中查找指定名称的工具 handler
   */
  static findTool(
    resolved: ResolvedPluginInfo[],
    toolName: string,
  ): ToolHandlerDef | undefined {
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      // 第 1 遍：enabledTools（plugin 级 + eager 工具包工具，已通过权限过滤）
      const found = rp.enabledTools.find((t) => t.name === toolName);
      if (found) return found;
      // 第 2 遍：已启用(lazy)工具包的工具
      const lazyTool = rp.allTools.find((t) => t.name === toolName);
      if (lazyTool) {
        const inLazyKit = rp.enabledToolKits.some(
          (tk) => tk.id === lazyTool.toolSet,
        );
        if (inLazyKit) {
          return lazyTool;
        }
      }
    }
    return undefined;
  }

  /**
   * 获取扁平化的工具定义列表（供 LLM 使用，不含 handler）
   */
  static toFlatToolDefs(
    resolved: ResolvedPluginInfo[],
    includeLazy = false,
  ): ToolDefinition[] {
    const toDef = (t: ToolHandlerDef) => {
      const params = t.parameters as any;
      // 临时调试：tool_use 的 arguments 显式标记 additionalProperties: true
      if (t.name === "tool_use" && params?.properties?.arguments) {
        params.properties.arguments.additionalProperties = true;
      }
      return {
        name: t.name,
        description: t.description,
        parameters: params,
      };
    };

    const result: ToolDefinition[] = [];
    const hasLazyKit = resolved.some((rp) =>
      rp.enabledToolKits.some((tk) => tk.loadMode === "lazy" && tk.enabled),
    );

    for (const rp of resolved) {
      for (const tool of rp.enabledTools) {
        if (!hasLazyKit) {
          if (tool.toolSet == "lazy_tools") continue;
        }
        result.push(toDef(tool));
      }
    }
    return result;
  }

  // ==================== 执行 ====================

  async executeBatch(
    requests: ToolCallRequest[],
    session: ISessionContext,
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
          responses[index] = await this.executeTool(
            req.name,
            req.arguments,
            req.id,
            session,
            abortSignal,
          );
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

  async executeTool(
    fullToolName: string,
    toolArgs: any,
    toolCallId: string,
    session: ISessionContext,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    const resolved = session.getResolvedPlugins();
    const toolEntry = ToolExecutor.findTool(resolved, fullToolName);
    if (!toolEntry)
      throw new Error(`Tool ${fullToolName} is not available or disabled`);

    // 记忆模式运行时限制：仅允许 memory 插件的工具
    if (session.getRunMode?.() === "memory") {
      const inMemoryPlugin = resolved.some(
        (rp) =>
          rp.plugin.id === "memory" &&
          rp.enabledTools.some((t) => t.name === fullToolName),
      );
      if (!inMemoryPlugin) {
        return {
          toolCallId,
          name: fullToolName,
          content: `In memory mode, only the memory tool is allowed`,
          isError: true,
        };
      }
    }

    // 计划模式运行时限制：仅允许 safe 等级的只读工具
    if (session.getRunMode?.() === "plan") {
      if (toolEntry.dangerLevel && toolEntry.dangerLevel !== "safe") {
        return {
          toolCallId,
          name: fullToolName,
          content: `The user has enabled plan mode. In this mode, only safe-level tools (typically read-only) are available. "${fullToolName}" is a ${toolEntry.dangerLevel} level tool and has been blocked. Unless the user disables plan mode, do not attempt to call this tool again. If the task cannot be completed without this tool, stop your work and inform the user.`,
          isError: true,
        };
      }
    }


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

      let content = await toolEntry.handler(
        validatedArgs,
        { session } as PluginContext,
        abortSignal,
      );

      if (typeof content === "object" && content !== null) {
        content = JSON.stringify(content);
      }

      if (content && fullToolName !== "read") {
        content = await this.handleLargeResult(
          content,
          fullToolName,
          toolCallId,
          session,
        );
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

  // ── 大结果处理 ──

  private async handleLargeResult(
    content: string,
    toolName: string,
    toolCallId: string,
    session: ISessionContext,
  ): Promise<string> {
    const MAX_TOKENS = 20000;
    const PREVIEW_BYTES = 2048;

    let tokenCount: number;
    try {
      tokenCount = await this.tokenizerService.countTextTokens(
        "default",
        content,
        false,
      );
    } catch {
      tokenCount = Math.ceil(Buffer.byteLength(content, "utf-8") / 4);
    }
    if (tokenCount <= MAX_TOKENS) return content;

    const preview = content.substring(0, PREVIEW_BYTES);

    const workspacePath = session.workspacePath;
    if (!workspacePath) {
      return JSON.stringify({
        warning: `结果过大（约 ${tokenCount} tokens），且无法保存到工作目录`,
        preview,
        tool_truncated_hint: "请使用 read 工具读取文件，或要求缩小范围",
      });
    }

    try {
      const outputDir = path.join(workspacePath, ".guada", "tools_output");
      await fs.mkdir(outputDir, { recursive: true });
      const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `${safeName}_${toolCallId}.json`;
      await fs.writeFile(path.join(outputDir, fileName), content, "utf-8");
      return JSON.stringify({
        message: `结果较大（约 ${tokenCount} tokens），已保存到工作目录`,
        file_path: path.join(".guada", "tools_output", fileName),
        preview,
        tool_truncated_hint: `完整结果已保存至上述文件。如需读取，请使用 read 工具并指定 file_path 参数为 "${path.join(".guada", "tools_output", fileName)}"，可配合 unit/offset/limit 分块读取（unit="char" 按字符偏移读取）。`,
      });
    } catch (saveError: any) {
      this.logger.warn(
        `保存大结果到文件失败: ${saveError.message}，回退到截断`,
      );
      return JSON.stringify({
        warning: "结果过大且无法保存到文件",
        preview,
        tool_truncated_hint: "请使用 read 工具读取文件，或要求缩小范围",
        token_count: tokenCount,
      });
    }
  }
}
