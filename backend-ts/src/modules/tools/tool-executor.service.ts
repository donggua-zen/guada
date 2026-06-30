import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
} from "./interfaces/tool-provider.interface";
import { PluginManager } from "../plugins/plugin.manager";
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
      const found = rp.enabledTools.find((t) => t.name === toolName);
      if (found) return found;
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
    const toDef = (t: ToolHandlerDef) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
      action: t.action,
      icon: t.icon,
      argsKey: t.argsKey,
    });

    const result: ToolDefinition[] = [];
    let hasLazyKit = false;
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      for (const tk of rp.toolKits) {
        if (tk.loadMode === "lazy" && tk.enabled) {
          hasLazyKit = true;
          break;
        }
      }
      if (hasLazyKit) break;
    }

    for (const rp of resolved) {
      if (!rp.enabled) continue;
      for (const tool of rp.enabledTools) {
        // 无懒加载工具包时排除 tool_learn / tool_use
        if (!hasLazyKit && (tool.name === "tool_learn" || tool.name === "tool_use")) continue;
        const loadMode = tool.toolSet
          ? (rp.toolKits.find((tk) => tk.id === tool.toolSet)?.loadMode ??
            "eager")
          : "eager";
        if (loadMode === "lazy" && !includeLazy) continue;
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
