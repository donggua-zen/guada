/**
 * 工具结果图片的 wire 视图派生（provider 无关）
 *
 * 存储层把图片引用挂在 `tool-result.images`（与 name/toolCallId 同块，归属可追溯）；
 * 本模块在请求组装边界把它们展开为一条隐藏 user 消息——多模态协议普遍不允许
 * tool 结果消息承载图片（OpenAI tool / Gemini functionResponse 均为纯文本），
 * 图片只能以 user 消息的 image part 送给模型。
 *
 * 为什么不在 L1 管线（message-transform.pipeline）做：
 * 管线输出必须与 store 折叠列表 1:1，压缩记账（shadowedCount + splice）依赖该性质；
 * 在管线里增删消息会让压缩切点错位（见 tool-pairing.guard.ts 顶部说明）。
 * 本模块与 ensureToolPairing 同层：只改本次 wire 视图，不写回存储。
 *
 * 顺序契约：连续的工具结果保持连续（OpenAI/Anthropic 要求 assistant 声明的
 * 每条 tool_call 紧随其 tool 结果），派生消息统一插在整组工具结果之后。
 */
import type {
  ContentBlock,
  Message,
  ToolResultBlock,
} from '../../common/types/conversation.types';
import { resolveModelVisiblePath } from './utils/attachment.util';

export interface ToolImageExpansionContext {
  /** 模型是否支持图片输入；false 时不做任何展开（由 L1 管线投影为文本） */
  supportsImageInput: boolean;
  /** 会话工作目录绝对路径（图片只读路径注解用） */
  workspaceDir?: string | null;
}

interface ImageGroup {
  toolCallId: string;
  name: string;
  images: NonNullable<ToolResultBlock['images']>;
}

/**
 * 把连续工具结果里的 `tool-result.images` 展开为整组之后的一条隐藏 user 消息。
 *
 * 每个带图工具先输出 `[Image returned by <toolName>]` 标签，再逐个输出 image 块
 * 与只读绝对路径注解（与 imagePathAnnotationStep 同文案），使模型能把图片与
 * 具体工具对应起来。无图片时原样返回入参（零拷贝）。
 */
export function expandToolResultImages(
  messages: readonly Message[],
  ctx: ToolImageExpansionContext,
): Message[] {
  if (!ctx.supportsImageInput) return messages as Message[];

  let changed = false;
  const out: Message[] = [];
  let i = 0;

  while (i < messages.length) {
    const message = messages[i];
    // 与 adapter 判定同口径：只有 source.kind === 'tool' 的消息会被映射为
    // 协议级 tool 结果（role='tool' 但 source 非 tool 的历史脏形态不在此展开）。
    if (message.source.kind !== 'tool') {
      out.push(message);
      i += 1;
      continue;
    }

    // 收集连续工具结果（保持原顺序），派生消息统一插在整组之后
    const groups: ImageGroup[] = [];
    let lastToolMessage: Message | undefined;
    while (i < messages.length && messages[i].source.kind === 'tool') {
      const toolMessage = messages[i];
      out.push(toolMessage);
      lastToolMessage = toolMessage;
      const block = toolMessage.content.find(
        (b): b is ToolResultBlock => b.type === 'tool-result',
      );
      if (block?.images?.length) {
        groups.push({
          toolCallId: block.toolCallId,
          name: block.name,
          images: block.images,
        });
      }
      i += 1;
    }

    if (groups.length === 0) continue;
    changed = true;
    out.push(buildDerivedImageMessage(groups, lastToolMessage, ctx));
  }

  return changed ? out : (messages as Message[]);
}

/** 一组工具结果 → 一条隐藏 user 消息（标签 + image 块 + 只读路径注解） */
function buildDerivedImageMessage(
  groups: ImageGroup[],
  lastToolMessage: Message | undefined,
  ctx: ToolImageExpansionContext,
): Message {
  const content: ContentBlock[] = [];
  for (const group of groups) {
    content.push({
      type: 'text',
      text: `[Image returned by ${group.name || 'tool'}]`,
    });
    for (const image of group.images) {
      content.push({ type: 'image', attachment: image });
      const imagePath = resolveModelVisiblePath(image, {
        workspaceDir: ctx.workspaceDir,
      });
      if (imagePath) {
        content.push({
          type: 'text',
          text: `[Image attachment (read-only): ${imagePath}. ]`,
        });
      }
    }
  }

  return {
    id: `${lastToolMessage?.id ?? 'tool'}:tool-images`,
    role: 'user',
    kind: 'model',
    source: { kind: 'plugin', plugin: 'image' },
    metadata: {
      hidden: true,
      // 调试/审计：派生消息对应的工具调用（不落库，仅 wire 视图）
      derivedFromToolResults: groups.map((group) => ({
        toolCallId: group.toolCallId,
        name: group.name,
      })),
    },
    content,
    ...(lastToolMessage?.createdAt
      ? { createdAt: lastToolMessage.createdAt }
      : {}),
  };
}
