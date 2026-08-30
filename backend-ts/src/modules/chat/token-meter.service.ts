/**
 * 会话级 Token 计量服务（对齐 deepseek-harness token-meter）
 *
 * 统一消息级 token 估算入口：
 * - 会话级块缓存（按 contentId，LRU 会话上限）——压缩流程多次估算（触发/裁剪后/保留预算/收敛校验）
 *   时避免重复 tiktoken 计数
 * - 精确真值仍由 provider usage 驱动（JsonlSessionContext.usageAnchor），本服务仅作估算/投影
 * - estimatePerMessage 输出逐消息 token（供上下文占用率/UI 展示扩展）
 *
 * 缓存失效契约：任何就地修改消息内容的操作（prune 改写 tool-result / compaction / 删除 / 重载）
 * 之后必须调用 invalidate(sessionId)，否则 contentId 不变但内容已变的块会返回过期估算。
 */
import { Injectable } from '@nestjs/common';
import { TokenizerService } from '../../common/utils/tokenizer.service';
import type {
  Message,
  Turn,
  ContentBlock,
} from '../../common/types/conversation.types';

@Injectable()
export class TokenMeterService {
  /** sessionId → (contentId → tokens)，块级会话缓存 */
  private readonly sessionCaches = new Map<string, Map<string, number>>();
  /** 会话缓存上限（LRU：超限驱逐最早插入的会话） */
  private static readonly MAX_SESSIONS = 200;

  constructor(private readonly tokenizer: TokenizerService) {}

  /** 失效会话缓存（prune/compaction/删除/重载后调用） */
  invalidate(sessionId: string): void {
    this.sessionCaches.delete(sessionId);
  }

  /** 估算一组消息的 token 数（会话级块缓存） */
  async estimateMessages(
    sessionId: string,
    modelName: string,
    messages: Message[],
  ): Promise<number> {
    let total = 0;
    for (const msg of messages) {
      total += await this.estimateMessage(sessionId, modelName, msg);
    }
    return total;
  }

  /** 估算一组回合的 token 数（只算可见回合，含 visible/hidden 过滤） */
  async estimateTurns(
    sessionId: string,
    modelName: string,
    turns: Turn[],
  ): Promise<number> {
    let total = 0;
    for (const turn of turns) {
      if (!turn.visible) continue;
      if (turn.metadata?.hidden === true) continue;
      for (const msg of turn.messages) {
        total += await this.estimateMessage(sessionId, modelName, msg);
      }
    }
    return total;
  }

  /** 逐消息估算（返回每消息 token，供上下文占用率/UI 展示） */
  async estimatePerMessage(
    sessionId: string,
    modelName: string,
    messages: Message[],
  ): Promise<Array<{ id: string; tokens: number }>> {
    const out: Array<{ id: string; tokens: number }> = [];
    for (const msg of messages) {
      out.push({
        id: msg.id,
        tokens: await this.estimateMessage(sessionId, modelName, msg),
      });
    }
    return out;
  }

  /**
   * 纯文本 token 估算（委托 tokenizer）。
   * useCache 默认 false：本服务已有会话级缓存，避免一次性文本挤占全局文本缓存名额。
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
    sessionId: string,
    modelName: string,
    msg: Message,
  ): Promise<number> {
    if (!Array.isArray(msg.content) || msg.content.length === 0) return 0;
    let total = 0;
    for (const block of msg.content) {
      total += await this.estimateBlock(sessionId, modelName, block);
    }
    return total;
  }

  /** 单块估算（按 contentId 缓存；无 contentId 的块直接计数） */
  private async estimateBlock(
    sessionId: string,
    modelName: string,
    block: ContentBlock,
  ): Promise<number> {
    const contentId = (block as { contentId?: string }).contentId;
    if (typeof contentId === 'string' && contentId) {
      const sessionCache = this.getOrCreateSession(sessionId);
      const cached = sessionCache.get(contentId);
      if (cached !== undefined) return cached;
      const tokens = await this.countBlock(modelName, block);
      if (contentId) sessionCache.set(contentId, tokens);
      return tokens;
    }
    return this.countBlock(modelName, block);
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
        return this.tokenizer.countTextTokens(modelName, block.content, false);
      case 'image':
        return 1500;
      case 'file':
        return this.tokenizer.countTextTokens(
          modelName,
          block.inline ?? block.attachment.name ?? block.attachment.url ?? '',
          false,
        );
    }
  }

  private getOrCreateSession(sessionId: string): Map<string, number> {
    let cache = this.sessionCaches.get(sessionId);
    if (!cache) {
      if (this.sessionCaches.size >= TokenMeterService.MAX_SESSIONS) {
        const oldest = this.sessionCaches.keys().next().value;
        if (oldest !== undefined) this.sessionCaches.delete(oldest);
      }
      cache = new Map();
      this.sessionCaches.set(sessionId, cache);
    }
    return cache;
  }
}