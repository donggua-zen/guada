/**
 * L1 消息变换管线 — provider 无关、按模型能力参数化的上下文变换。
 *
 * 职责边界（见 docs/message-pipeline-normalization-plan.md §3/§4）：
 * - 存储层（L0）只做事件投影，不认识「模型能力」；
 * - 本管线（L1）在「折叠视图 → LLM 请求上下文」之间做一次性归一化，
 *   全部步骤为纯函数（Message[] → Message[]，副本变换，不污染 store 缓存）；
 * - wire 级协议映射留给各 adapter（L3），本层不出现任何协议词汇。
 *
 * 步骤顺序即注册顺序（run() 按 registration order 执行）：
 *   1. image-projection   — 模型不支持图片输入时，image 块 → 含文件路径的英文占位文本
 *                          （纯信息占位，不内联 base64、不暗示调用工具；模型可凭路径调用 image_recognize）
 *   2. reasoning-policy   — 思考模式：最后一轮（currentTurnId）完整携带/填充思考，
 *                          历史轮次剥离；fullReasoningRelay（deepseek-v4 系）例外全量携带；
 *                          非思考模式剥离全部 reasoning 块
 *   3. empty-content-compat — assistant 空 content 兼容（KIMI 等，重建为 '\n' 文本块）
 */

import { Logger } from '@nestjs/common';
import {
  Message,
  ContentBlock,
} from '../../common/types/conversation.types';

// ═══ 上下文 ═══

/** 变换上下文：由会话层从 modelConfig / settings 派生 */
export interface TransformContext {
  /** 模型是否支持图片输入（inputCapabilities 含 'image'） */
  supportsImageInput: boolean;
  /** 是否处于思考模式（thinkingEffort 存在且非 'none'） */
  thinkingMode: boolean;
  /**
   * 当前（最后一轮）回合 id：由会话层在 beginTurn 时记录。
   * 思考模式下仅该回合的 assistant 消息完整携带思考，历史轮次剥离；
   * 缺省/为 null 时全部视为最后一轮（保守回退 = 历史全量携带行为）。
   */
  currentTurnId?: string | null;
  /**
   * 该模型家族要求全部轮次完整回传思考（如 deepseek-v4 系端点）：
   * 思考模式下历史轮次也不剥离（缺失填充）。由会话层依据 modelName 派生。
   */
  fullReasoningRelay?: boolean;
  /** 供应商协议（'openai' | 'anthropic' | 'gemini' ...，仅日志/未来分支用） */
  providerProtocol?: string;
  /** 模型名（仅日志用；能力派生由会话层完成，本层不读模型名） */
  modelName?: string;
}

// ═══ 步骤契约 ═══

export interface TransformStep {
  readonly name: string;
  apply(messages: Message[], ctx: TransformContext): Message[];
}

// ═══ 内置步骤（全部纯函数，导出供单测） ═══

/**
 * 步骤 1：图片投影。
 * 不支持图片输入的模型：image 块 → 确定性占位文本（含文件路径，英文）。
 * 纯信息占位，不内联 base64、不暗示调用工具；模型若要识别图片，
 * 可凭此路径调用 image_recognize 工具（由 image-recognition 插件在纯文本模型上自动加载）。
 * 存储层原样保留 image 块，仅在读取视图投影。
 */
export const imageProjectionStep: TransformStep = {
  name: 'image-projection',
  apply(messages, ctx) {
    if (ctx.supportsImageInput) return messages;
    return messages.map((msg) => {
      if (!msg.content.some((b) => b.type === 'image')) return msg;
      return {
        ...msg,
        content: msg.content.map((block): ContentBlock => {
          if (block.type !== 'image') return block;
          const imagePath = block.attachment.url ?? block.attachment.attachmentId;
          return {
            type: 'text',
            text:
              `[Image omitted: the current model accepts text input only and cannot view images. ` +
              `Image file path: ${imagePath}. To inspect it, call image_recognize with this path.]`,
          };
        }),
      };
    });
  },
};

/**
 * 全量思考回传模型族判定（思考模式下历史轮次也不剥离思考）。
 * 目前仅 deepseek-v4 系：模型名包含 "deepseek-v4" 即命中（不分前后缀，大小写不敏感）。
 */
export function isFullReasoningRelayModel(modelName?: string): boolean {
  if (!modelName) return false;
  return modelName.toLowerCase().includes('deepseek-v4');
}

/**
 * 步骤 2：reasoning 策略（存储原样保留，读取时按当前模式过滤）。
 * - 非思考模式 → 剥离全部 reasoning 块；
 * - 思考模式 + fullReasoningRelay（deepseek-v4 系，端点要求 reasoning 跨轮持续回传）
 *   → 全部 assistant 消息保留/填充（无块补 `{summary:' '}`、空 summary 填 `' '`）；
 * - 思考模式（默认）→ 仅最后一轮（turnId === ctx.currentTurnId 的 assistant 消息）
 *   保留/填充，历史轮次剥离。currentTurnId 缺省时全部视为最后一轮（保守回退）。
 */
export const reasoningPolicyStep: TransformStep = {
  name: 'reasoning-policy',
  apply(messages, ctx) {
    // 逐消息判定是否走「填充」分支；填充策略与历史行为一致
    const shouldFill = (msg: Message): boolean => {
      if (ctx.fullReasoningRelay) return true;
      if (ctx.currentTurnId == null) return true;
      const turnId = (msg as { turnId?: string | null }).turnId ?? null;
      return turnId === ctx.currentTurnId;
    };
    const fillReasoning = (msg: Message): Message => {
      const hasReasoning = msg.content.some((b) => b.type === 'reasoning');
      if (!hasReasoning) {
        return {
          ...msg,
          content: [
            ...msg.content,
            { type: 'reasoning' as const, summary: ' ' },
          ],
        };
      }
      return {
        ...msg,
        content: msg.content.map((b) =>
          b.type === 'reasoning' ? { ...b, summary: b.summary || ' ' } : b,
        ),
      };
    };
    const stripReasoning = (msg: Message): Message => ({
      ...msg,
      content: msg.content.filter((b) => b.type !== 'reasoning'),
    });

    return messages.map((msg) => {
      if (msg.role !== 'assistant') return msg;
      if (!ctx.thinkingMode) return stripReasoning(msg);
      return shouldFill(msg) ? fillReasoning(msg) : stripReasoning(msg);
    });
  },
};

/**
 * 步骤 3：空 content 兼容（所有角色）。
 * 部分端点（OpenAI/KIMI 等）拒绝空 content 数组（400 missing messages.content），
 * 重建为单个 '\n' 文本块。来源：DISABLED 检查点、reasoning 剥离后的 assistant、
 * 空 user 消息等——adapter 序列化边界前必须保证每个消息都有有效 content。
 */
export const emptyContentCompatStep: TransformStep = {
  name: 'empty-content-compat',
  apply(messages) {
    return messages.map((msg) => {
      if (msg.content.length === 0) {
        return { ...msg, content: [{ type: 'text', text: '\n' }] };
      }
      return msg;
    });
  },
};

// ═══ 管线 ═══

export class MessageTransformPipeline {
  private readonly logger = new Logger('MessageTransformPipeline');
  private readonly steps: TransformStep[] = [];

  register(step: TransformStep): this {
    this.steps.push(step);
    return this;
  }

  /** 按注册顺序执行全部步骤。每步在副本上变换，入参数组不被修改。 */
  run(messages: Message[], ctx: TransformContext): Message[] {
    let current = messages;
    for (const step of this.steps) {
      const before = countBlocks(current);
      current = step.apply(current, ctx);
      const after = countBlocks(current);
      if (before !== after) {
        this.logger.debug(
          `step[${step.name}] changed block count: ${before} -> ${after}` +
            ` (model=${ctx.modelName ?? 'unknown'}, protocol=${ctx.providerProtocol ?? 'unknown'})`,
        );
      }
    }
    return current;
  }
}

/** 组装默认管线（顺序即契约：投影 → reasoning → 空 content 兼容） */
export function createDefaultMessageTransformPipeline(): MessageTransformPipeline {
  return new MessageTransformPipeline()
    .register(imageProjectionStep)
    .register(reasoningPolicyStep)
    .register(emptyContentCompatStep);
}

function countBlocks(messages: Message[]): number {
  let n = 0;
  for (const m of messages) n += m.content.length;
  return n;
}
