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
 *   0. kb-ref-projection  — KB 引用块 → 引用清单文本（结构化块不进协议层；
 *                          存储原样保留，前端按 chips 渲染 kbRefs）
 *   1. image-projection   — 模型不支持图片输入时，image 块 → 含文件路径（请求时桥接的
 *                          绝对物理路径）的英文占位文本（纯信息占位，不内联 base64、
 *                          不暗示调用工具；模型可凭路径调用 image_recognize）
 *   2. image-path-annotation — 多模态模型：image 块后追加只读绝对路径注解文本块
 *                          （DSH 同款 normalized-copy 文案，模型可用工具二次处理图片）
 *   3. file-path-bridge   — 'workspace' 形态的 file 块引用（会话工作目录相对路径）
 *                          → 绝对路径副本，使 adapter 侧的 fileBlockToText 无需会话上下文；
 *                          存储层仍保留相对引用（工作目录迁移后仍可重新桥接）
 *   4. reasoning-policy   — 思考模式：最后一轮（currentTurnId）完整携带/填充思考，
 *                          历史轮次剥离；fullReasoningRelay（deepseek-v4 系）例外全量携带；
 *                          非思考模式剥离全部 reasoning 块
 *                          （剥离含 metadata 中的 signature/redactedData 思考私有元数据）
 *   5. empty-content-compat — assistant 空 content 兼容（KIMI 等，重建为 '\n' 文本块）
 */

import { Logger } from '@nestjs/common';
import {
  Message,
  ContentBlock,
} from '../../common/types/conversation.types';
import { resolveModelVisiblePath, resolveRefPhysicalPath, normalizeRefType } from '../llm-core/utils/attachment.util';
import { kbRefsToText } from '../../common/utils/kb-ref.util';

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
  /**
   * 会话工作目录的绝对路径。'workspace' 形态的附件引用（会话工作目录内的相对引用）
   * 需要它才能桥接为工具可读的绝对路径；缺省时该类引用按「无法桥接」降级（只给文件名）。
   * 它参与缓存指纹（见 transformKey），改变会使管线快照失效重建。
   */
  workspaceDir?: string | null;
}

// ═══ 步骤契约 ═══

export interface TransformStep {
  readonly name: string;
  apply(messages: Message[], ctx: TransformContext): Message[];
}

// ═══ 内置步骤（全部纯函数，导出供单测） ═══

/**
 * 步骤 0：KB 引用投影。
 * kb-ref 块（结构化引用，随用户消息落库）→ 引用清单文本。所有模型统一投影
 * （无协议原生支持该块类型，无能力参数）。存储层原样保留 kb-ref 块
 * （前端按 chips 渲染 kbRefs），仅在读取视图投影——与 image-projection 同构。
 */
export const kbRefProjectionStep: TransformStep = {
  name: 'kb-ref-projection',
  apply(messages) {
    return messages.map((msg) => {
      if (!msg.content.some((b) => b.type === 'kb-ref')) return msg;
      return {
        ...msg,
        content: msg.content.map((block): ContentBlock => {
          if (block.type !== 'kb-ref') return block;
          return { type: 'text', text: kbRefsToText(block.kbRefs) };
        }),
      };
    });
  },
};

/**
 * 步骤 1：图片投影。
 * 不支持图片输入的模型：image 块 → 确定性占位文本（含文件路径，英文）。
 * 路径经请求时桥接为模型工具可读的绝对物理路径（存储层只存相对引用，引用不当路径用）；
 * 无法桥接（data: 内联图/未配置上传目录）时明确告知无可用文件路径。
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
          // 仅存储锚点 url 可桥接（attachmentId 是旧数据标识，不是路径）
          const imagePath = resolveModelVisiblePath(block.attachment, {
            workspaceDir: ctx.workspaceDir,
          });
          const pathInfo = imagePath
            ? `Image file path: ${imagePath}. To inspect it, call image_recognize with this path.`
            : 'No readable file path is available for this image (it was provided inline).';
          return {
            type: 'text',
            text:
              `[Image omitted: the current model accepts text input only and cannot view images. ` +
              `${pathInfo}]`,
          };
        }),
      };
    });
  },
};

/**
 * 步骤 1b：多模态路径注解。
 * 支持图片输入的模型：image 块后追加同消息 text 块，附上桥接后的绝对路径（只读语义），
 * 使模型能用工具（image_recognize / read / run_command）直接处理图片，不必向用户询问路径。
 * data: 内联图（工具产出）无物理路径，跳过。存储层不受影响。
 */
export const imagePathAnnotationStep: TransformStep = {
  name: 'image-path-annotation',
  apply(messages, ctx) {
    if (!ctx.supportsImageInput) return messages;
    let changed = false;
    const out = messages.map((msg) => {
      if (!msg.content.some((b) => b.type === 'image')) return msg;
      const content: ContentBlock[] = [];
      for (const block of msg.content) {
        content.push(block);
        if (block.type !== 'image') continue;
        // 仅存储锚点 url 可桥接（attachmentId 是旧数据标识，不是路径）
        const imagePath = resolveModelVisiblePath(block.attachment, {
          workspaceDir: ctx.workspaceDir,
        });
        if (!imagePath) continue;
        changed = true;
        content.push({
          type: 'text',
          text:
            `[Image attachment (read-only): ${imagePath}. ]`,
        });
      }
      return { ...msg, content };
    });
    return changed ? out : messages;
  },
};

/**
 * 步骤 1c：文件块引用桥接（'workspace' 引用 → 绝对路径副本）。
 *
 * 'workspace' 引用存的是会话工作目录内的相对路径（uploads/20260915/报告_ab12cd.pdf），
 * 而 adapter 侧的 fileBlockToText 只做纯文本投影、拿不到会话上下文。故在此把它改写成
 * 绝对路径形态的**块副本**（refType='local' = 本机绝对路径语义），使「引用 → 路径」
 * 的文案只在 fileBlockToText 一处实现——否则路径文案要在本层和 4 个 adapter 各写一遍。
 *
 * 存储层不受影响：被改写的是请求视图的副本，JSONL 里的引用仍是相对形态，
 * 工作目录改名/迁移后历史附件照样能重新桥接。
 * 无法桥接（无 workspaceDir / 引用越出工作目录）时不改写，下游退化为只给文件名。
 */
export const filePathBridgeStep: TransformStep = {
  name: 'file-path-bridge',
  apply(messages, ctx) {
    if (!ctx.workspaceDir) return messages;
    let anyChanged = false;
    const out = messages.map((msg) => {
      if (!msg.content.some((b) => b.type === 'file')) return msg;
      let msgChanged = false;
      const content = msg.content.map((block): ContentBlock => {
        if (block.type !== 'file') return block;
        const att = block.attachment;
        if (normalizeRefType(att.refType) !== 'workspace') return block;
        const absPath = resolveRefPhysicalPath(att, { workspaceDir: ctx.workspaceDir });
        if (!absPath) return block;
        msgChanged = true;
        return { ...block, attachment: { ...att, url: absPath, refType: 'local' } };
      });
      if (!msgChanged) return msg;
      anyChanged = true;
      return { ...msg, content };
    });
    return anyChanged ? out : messages;
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
 *   → 全部 assistant 消息保留/填充（无块补 `{summary:''}`、空 summary 填 `''`）；
 * - 思考模式（默认）→ 仅最后一轮（turnId === ctx.currentTurnId 的 assistant 消息）
 *   保留/填充，历史轮次剥离。currentTurnId 缺省时全部视为最后一轮（保守回退）。
 *
 * 填充值用空串而非空格（对齐 DSH/pi-ai）：端点要求该字段存在时，pi-ai 对缺失思考
 * 填 `reasoning_content: ""`；空格是非空字符串，会被取思维链哈希的网关当成真实思考
 * 内容参与重建、也可能被模型当作一段（空白）思考。空串语义为"有字段、无思考"。
 *
 * 剥离时同步清理消息 metadata 中的思考私有元数据（signature/redactedData）：
 * 二者是产生该思考的模型私有凭证，仅对其来源模型有效；若残留，
 * anthropic.adapter 会依据 metadata 仍注入 thinking/redacted_thinking，
 * 导致已被策略剥离的消息继续向（可能已切换的）新模型回传。
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
            { type: 'reasoning' as const, summary: '' },
          ],
        };
      }
      return {
        ...msg,
        content: msg.content.map((b) =>
          b.type === 'reasoning' ? { ...b, summary: b.summary || '' } : b,
        ),
      };
    };
    // 剥离 = content 块 + 思考私有元数据一并清理；无思考元数据时不复制 metadata
    const stripReasoning = (msg: Message): Message => {
      const { signature, redactedData, ...restMetadata } = msg.metadata ?? {};
      return {
        ...msg,
        metadata:
          signature === undefined && redactedData === undefined
            ? msg.metadata
            : restMetadata,
        content: msg.content.filter((b) => b.type !== 'reasoning'),
      };
    };

    return messages.map((msg) => {
      if (msg.role !== 'assistant') return msg;
      if (!ctx.thinkingMode) return stripReasoning(msg);
      return shouldFill(msg) ? fillReasoning(msg) : stripReasoning(msg);
    });
  },
};

/**
 * 步骤 3：空 content 兼容（所有消息角色）。
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

/** 组装默认管线（顺序即契约：KB 引用投影 → 图片投影 → 图片路径注解 → 文件块引用桥接 → reasoning → 空 content 兼容） */
export function createDefaultMessageTransformPipeline(): MessageTransformPipeline {
  return new MessageTransformPipeline()
    .register(kbRefProjectionStep)
    .register(imageProjectionStep)
    .register(imagePathAnnotationStep)
    .register(filePathBridgeStep)
    .register(reasoningPolicyStep)
    .register(emptyContentCompatStep);
}

function countBlocks(messages: Message[]): number {
  let n = 0;
  for (const m of messages) n += m.content.length;
  return n;
}
