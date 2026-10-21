/**
 * 会话级 Token 计量服务（对齐 deepseek-harness token-meter）
 *
 * 统一消息级 token 估算入口：
 * - **无缓存**：每次估算直接委托 TokenizerService 计数，不持有任何会话状态。
 *   历史包袱（v1.4 移除）：曾按 contentId 做块级会话缓存，要求"任何就地改写消息内容的
 *   操作之后必须精确失效对应块"。而 prune / compaction 的改写点分散在多个层级，
 *   该契约被绕过时不会报错，只会静默返回过期估算并直接扭曲压缩判据
 *   （典型后果：一级裁剪后的重测读到裁剪前的数值 → 级联触发本不必要的二级摘要）。
 *   缓存的收益（省 tiktoken 计数）远小于它给架构带来的隐性约束，故整体移除；
 *   待写路径完全收敛到会话层、快照增量更新稳定后，再重新设计缓存层。
 * - 精确真值仍由 provider usage 驱动（JsonlSessionContext.usageAnchor），本服务仅作估算/投影
 * - estimatePerMessage 输出逐消息 token（供上下文占用率/UI 展示扩展）
 *
 * 无状态：本服务为纯计算服务，方法首参 sessionId 仅为兼容既有调用签名而保留，
 * 不参与任何计算，将来重新引入会话级缓存时可零改动恢复。
 */
import { Injectable } from '@nestjs/common';
import { TokenizerService } from '../../common/utils/tokenizer.service';
import { kbRefsToText } from '../../common/utils/kb-ref.util';
import type {
  Message,
  Turn,
  ContentBlock,
} from '../../common/types/conversation.types';

@Injectable()
export class TokenMeterService {
  constructor(private readonly tokenizer: TokenizerService) {}

  /** 估算一组消息的 token 数 */
  async estimateMessages(
    _sessionId: string,
    modelName: string,
    messages: Message[],
  ): Promise<number> {
    let total = 0;
    for (const msg of messages) {
      total += await this.estimateMessage(modelName, msg);
    }
    return total;
  }

  /** 估算一组回合的 token 数（只算可见回合，含 visible/hidden 过滤） */
  async estimateTurns(
    _sessionId: string,
    modelName: string,
    turns: Turn[],
  ): Promise<number> {
    let total = 0;
    for (const turn of turns) {
      if (!turn.visible) continue;
      if (turn.metadata?.hidden === true) continue;
      for (const msg of turn.messages) {
        total += await this.estimateMessage(modelName, msg);
      }
    }
    return total;
  }

  /** 逐消息估算（返回每消息 token，供上下文占用率/UI 展示） */
  async estimatePerMessage(
    _sessionId: string,
    modelName: string,
    messages: Message[],
  ): Promise<Array<{ id: string; tokens: number }>> {
    const out: Array<{ id: string; tokens: number }> = [];
    for (const msg of messages) {
      out.push({
        id: msg.id,
        tokens: await this.estimateMessage(modelName, msg),
      });
    }
    return out;
  }

  /**
   * 纯文本 token 估算（委托 tokenizer）。
   * useCache 默认 false：本服务无缓存，避免一次性文本挤占全局文本缓存名额。
   */
  estimateTextTokens(
    modelName: string,
    text: string,
    useCache = false,
  ): Promise<number> {
    return this.tokenizer.countTextTokens(modelName, text, useCache);
  }

  /** 单消息估算（逐块累计） */
  private async estimateMessage(
    modelName: string,
    msg: Message,
  ): Promise<number> {
    if (!Array.isArray(msg.content) || msg.content.length === 0) return 0;
    let total = 0;
    for (const block of msg.content) {
      total += await this.countBlock(modelName, block);
    }
    return total;
  }

  /** 块级计数（与 TokenizerService.countMessageBlocks 同规则，图像统一 1500） */
  private async countBlock(
    modelName: string,
    block: ContentBlock,
  ): Promise<number> {
    switch (block.type) {
      case 'text':
        return this.tokenizer.countTextTokens(modelName, block.text, false);
      case 'reasoning':
        return this.tokenizer.countTextTokens(modelName, block.summary, false);
      case 'tool-call':
        return this.tokenizer.countTextTokens(
          modelName,
          `${block.name}\n${block.arguments}`,
          false,
        );
      case 'tool-result':
        // 工具结果内嵌图片与 image 块同口径（图像统一按 1500 估算）
        return (
          (await this.tokenizer.countTextTokens(
            modelName,
            block.content,
            false,
          )) + (block.images?.length ?? 0) * 1500
        );
      case 'image':
        return 1500;
      case 'kb-ref':
        // 与请求视图投影后的清单文本同口径（kbRefProjectionStep）
        return this.tokenizer.countTextTokens(
          modelName,
          kbRefsToText(block.kbRefs),
          false,
        );
      case 'file':
        return this.tokenizer.countTextTokens(
          modelName,
          block.inline ?? block.attachment.name ?? block.attachment.url ?? '',
          false,
        );
    }
  }
}
