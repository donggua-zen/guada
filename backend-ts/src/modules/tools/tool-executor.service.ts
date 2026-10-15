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
import type { ToolResultObject, ImageContent } from "../plugins/api/plugin-api";
import { safeTruncate } from "../../common/utils/string.utils";
import { ISessionContext } from "../chat/session-context";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import { AskDeniedError } from "../../common/types/ask.types";

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
   *
   * @param allowLazy 是否允许命中 lazy 工具包的工具。lazy 工具不广告给 LLM，
   *   只能经 tool_use 通道执行；LLM 直接派发（executeBatch）不传此项，故不可达。
   */
  static findTool(
    resolved: ResolvedPluginInfo[],
    toolName: string,
    allowLazy = false,
  ): ToolHandlerDef | undefined {
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      // 第 1 遍：enabledTools（plugin 级 + eager 工具包工具，已通过权限过滤）
      const found = rp.enabledTools.find((t) => t.name === toolName);
      if (found) return found;
      // 第 2 遍：lazy 工具包的工具——仅 tool_use 通道放行
      if (!allowLazy) continue;
      const lazyTool = rp.allTools.find((t) => t.name === toolName);
      if (lazyTool) {
        // loadMode=none 表示"压根不加载"：其工具不可达，不因 kit.enabled 而为真
        const inLazyKit = rp.enabledToolKits.some(
          (tk) =>
            tk.enabled && tk.loadMode !== "none" && tk.id === lazyTool.toolSet,
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
  static toFlatToolDefs(resolved: ResolvedPluginInfo[]): ToolDefinition[] {
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

    // 中止退出（worker 的 break）会留下未认领的空洞槽位。结果数组的契约是
    // 「与 requests 同序、每条请求一条响应」——调用方逐条解引用（读 toolCallId
    // 建 tool 结果消息），空洞会让它抛错并把整个回合拖成"工具结果一条不落"。
    // 因此这里把空洞补齐为显式中断结果（模型据此知道未派发，而非误判为失败重试）。
    for (let index = 0; index < requests.length; index += 1) {
      if (responses[index]) continue;
      const request = requests[index];
      responses[index] = {
        toolCallId: request.id,
        name: request.name,
        content:
          "Error: tool call not executed (request aborted before dispatch). Retry only read-only/idempotent operations.",
        isError: true,
        outcome: "error",
      };
    }

    return responses;
  }

  /**
   * 计划模式工具门：返回拒绝原因（null = 放行）。
   *
   * 放行面只有两条，其余一律硬拒（返回 isError tool-result，不抛错——模型据此调整，
   * 而不是把回合卡在等待人类上）：
   *  1. `readOnly` 工具（声明式能力）；
   *  2. `allowedInPlanMode` 逃生舱（浏览器调研、只读子代理、计划审批工具等）。
   *
   * 子会话对"需要人类应答"的逃生舱工具不享受豁免：子代理没有独立的应答面，
   * 放行 ExitPlanMode 这类工具会把交互卡挂到用户看不见的子会话上、卡死父回合。
   * 只收窄这一条，是为了不连带禁掉子代理的只读命令调研。
   */
  private static checkPlanMode(
    toolEntry: ToolHandlerDef,
    session: ISessionContext,
  ): string | null {
    if (toolEntry.readOnly) return null;

    if (toolEntry.allowedInPlanMode) {
      if (
        session.sessionType === "sub_agent" &&
        toolEntry.requiresUserInteraction
      ) {
        return `Plan mode is active and "${toolEntry.name}" needs a user response, which is not available inside a sub-agent.`;
      }
      return null;
    }

    return `Plan mode is active: only read-only tools are available. "${toolEntry.name}" cannot run until the user approves the plan and exits plan mode.`;
  }

  async executeTool(
    fullToolName: string,
    toolArgs: any,
    toolCallId: string,
    session: ISessionContext,
    abortSignal?: AbortSignal,
    opts?: { allowLazy?: boolean },
  ): Promise<ToolCallResponse> {
    const resolved = session.getResolvedPlugins();
    const allowLazy = opts?.allowLazy === true;
    const toolEntry = ToolExecutor.findTool(resolved, fullToolName, allowLazy);
    if (!toolEntry) {
      if (!allowLazy) {
        // 工具存在但仅可经 tool_use 触达：给出换通道的提示，避免模型重试同名工具
        const lazyEntry = ToolExecutor.findTool(resolved, fullToolName, true);
        if (lazyEntry) {
          throw new Error(
            `Tool ${fullToolName} is a lazy-loaded tool. Call tool_learn("${lazyEntry.toolSet}") to learn its usage, then invoke it via tool_use.`,
          );
        }
      }
      throw new Error(`Tool ${fullToolName} is not available or disabled`);
    }

    // 工具范围锁定（影子轮次等瞬态机制）：仅允许锁定插件的工具
    const toolScope = session.getToolScope?.();
    if (toolScope) {
      const inScope = resolved.some(
        (rp) =>
          rp.plugin.id === toolScope &&
          rp.enabledTools.some((t) => t.name === fullToolName),
      );
      if (!inScope) {
        return {
          toolCallId,
          name: fullToolName,
          content: `The current tool scope only allows the "${toolScope}" plugin tools`,
          isError: true,
        };
      }
    }

    // 计划模式门（协作状态的强制力所在）：开启后只放行只读工具与显式逃生舱。
    // 与安全模式正交——此处不改写 sandboxMode，也不受其档位影响；先于沙盒判定，
    // 避免同一写入被两套机制各拒一次、错误信息互相打架。
    if (session.getPlanEnabled?.()) {
      const planDenied = ToolExecutor.checkPlanMode(toolEntry, session);
      if (planDenied) {
        return {
          toolCallId,
          name: fullToolName,
          content: planDenied,
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

      let result = await toolEntry.handler(
        validatedArgs,
        { session, toolCallId } as PluginContext,
        abortSignal,
      );

      let images: ImageContent[] | undefined;
      let imageRefs: import("../plugins/api/plugin-api").ImageRefContent[] | undefined;
      let meta: Record<string, any> | undefined;
      let followUpUserInput: string | undefined;
      let resultIsError = false;
      let content: string;

      // Distinguish ToolResultObject { content, images, imageRefs, meta, followUpUserInput } from legacy object / string
      if (typeof result === "string") {
        content = result;
      } else if (typeof result === "object" && result !== null) {
        const obj = result as Record<string, any>;
        if (typeof obj["content"] === "string") {
          // ToolResultObject — structured return
          images = (obj as ToolResultObject).images;
          imageRefs = (obj as ToolResultObject).imageRefs;
          meta = (obj as ToolResultObject).meta;
          followUpUserInput = (obj as ToolResultObject).followUpUserInput;
          resultIsError = (obj as ToolResultObject).isError === true;
          content = obj["content"];
        } else {
          // Legacy: plain object → JSON.stringify
          content = JSON.stringify(result);
        }
      } else {
        content = String(result ?? "");
      }

      // 豁免：read 自带上限+续读参数；声明 exemptFromLargeResult 的工具（如 skill_learn）
      // 同样自管长度——它们的正文就是模型要用的内容，被换成预览等于报废。
      if (content && !toolEntry?.exemptFromLargeResult && fullToolName !== "read") {
        const handled = await this.handleLargeResult(
          content,
          fullToolName,
          toolCallId,
          session,
        );
        content = handled.content;
        // 仅当正文真被替换（spill/截断）时才丢弃：替换后 meta 与正文失配。
        // 未超阈值时正文原样返回，meta 与正文仍然对应，必须保留。
        // 例外：meta.link 是"UI 跳转目标"（指向会话等外部对象，与正文无关，不存在失配），
        // spill 后必须留下——否则子代理长报告恰好丢掉"打开子代理面板"入口，
        // 而长报告正是最想点进去回看的场景。
        if (handled.replaced) meta = meta?.link ? { link: meta.link } : undefined;
      }
      return {
        toolCallId,
        name: fullToolName,
        content,
        isError: resultIsError,
        images,
        imageRefs,
        meta,
        // 不随大结果处理丢弃：反馈正文是协作语义载体，与 content 的截断/spill 无关
        ...(followUpUserInput ? { followUpUserInput } : {}),
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing tool ${fullToolName}: ${errorMsg}`);
      // 统一交互拒绝（AskDeniedError）：feedback 携带用户自定义回复/拒绝语义，
      // 原样反馈模型（区别于普通执行错误），模型据此自行调整
      if (error instanceof AskDeniedError) {
        const feedback = error.feedback || errorMsg;
        return {
          toolCallId,
          name: fullToolName,
          content: feedback,
          isError: true,
        };
      }
      return {
        toolCallId,
        name: fullToolName,
        content: `Tool execution failed: ${errorMsg}`,
        isError: true,
      };
    }
  }

  // ── 大结果处理 ──

  /**
   * 大结果处理。
   *
   * 返回值 `replaced` 表示正文是否被替换（spill 到文件或截断）——调用方据此决定
   * 是否丢弃 meta：未超阈值时正文原样返回，meta 与正文仍对应，须保留。
   */
  private async handleLargeResult(
    content: string,
    toolName: string,
    toolCallId: string,
    session: ISessionContext,
  ): Promise<{ content: string; replaced: boolean }> {
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
    if (tokenCount <= MAX_TOKENS) return { content, replaced: false };

    const preview = safeTruncate(content, PREVIEW_BYTES);

    const workspacePath = session.workspacePath;
    if (!workspacePath) {
      return {
        content: JSON.stringify({
          warning: `结果过大（约 ${tokenCount} tokens），且无法保存到工作目录`,
          preview,
          tool_truncated_hint: "请使用 read 工具读取文件，或要求缩小范围",
        }),
        replaced: true,
      };
    }

    try {
      const outputDir = path.join(workspacePath, ".guada", "tools_output");
      await fs.mkdir(outputDir, { recursive: true });
      const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `${safeName}_${toolCallId}.json`;
      await fs.writeFile(path.join(outputDir, fileName), content, "utf-8");
      return {
        content: JSON.stringify({
          message: `结果较大（约 ${tokenCount} tokens），已保存到工作目录`,
          file_path: path.join(".guada", "tools_output", fileName),
          preview,
          tool_truncated_hint: `完整结果已保存至上述文件。如需读取，请使用 read 工具并指定 file_path 参数为 "${path.join(".guada", "tools_output", fileName)}"，可配合 unit/offset/limit 分块读取（unit="char" 按字符偏移读取）。`,
        }),
        replaced: true,
      };
    } catch (saveError: any) {
      this.logger.warn(
        `保存大结果到文件失败: ${saveError.message}，回退到截断`,
      );
      return {
        content: JSON.stringify({
          warning: "结果过大且无法保存到文件",
          preview,
          tool_truncated_hint: "请使用 read 工具读取文件，或要求缩小范围",
          token_count: tokenCount,
        }),
        replaced: true,
      };
    }
  }
}
