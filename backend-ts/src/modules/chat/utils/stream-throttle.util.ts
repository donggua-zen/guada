import { LLMResponseChunk } from "../../llm-core/types/llm.types";

/**
 * 流式输出限流器
 *
 * 包装原始 LLM 流，在指定时间窗口内合并同类 chunk，降低前端渲染压力。
 * 合并规则：content 和 reasoningContent 分别累加，toolCalls 按 index 累加 arguments。
 * 刷新触发：定时器到期、finishReason 到达、流结束、abort 信号触发。
 *
 * @param stream 原始 LLM 流式生成器
 * @param throttleMs 限流间隔（毫秒）
 * @param abortSignal 中断信号
 * @yields 合并后的 LLMResponseChunk
 */
export async function* throttledStream(
  stream: AsyncGenerator<LLMResponseChunk>,
  throttleMs: number,
  abortSignal?: AbortSignal,
): AsyncGenerator<LLMResponseChunk> {
  // 当前缓存的合并 chunk
  let buffer: LLMResponseChunk | null = null;
  // 定时器句柄
  let flushTimer: NodeJS.Timeout | null = null;
  // 流是否已结束
  let streamDone = false;
  // 获取流的异步迭代器
  const iterator = stream[Symbol.asyncIterator]();

  /**
   * 立即刷新缓存并返回 chunk，同时清除定时器
   */
  const flush = (): LLMResponseChunk | null => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buffer) {
      const chunk = buffer;
      buffer = null;
      return chunk;
    }
    return null;
  };

  /**
   * 调度一次定时刷新，返回一个 Promise，超时后 resolve
   */
  const scheduleFlush = (): Promise<void> => {
    return new Promise((resolve) => {
      flushTimer = setTimeout(() => {
        resolve();
      }, throttleMs);
    });
  };

  /**
   * 判断 chunk 的事件类型（用于区分不同类型的 chunk 是否能合并）
   */
  const getChunkEventType = (chunk: LLMResponseChunk): string => {
    if (chunk.finishReason) return "finish";
    if (chunk.reasoningContent) return "think";
    if (chunk.content) return "text";
    if (chunk.toolCalls && chunk.toolCalls.length > 0) return "tool_call";
    if (chunk.usage) return "usage";
    return "unknown";
  };

  /**
   * 深拷贝工具调用数组
   */
  const cloneToolCalls = (toolCalls: any[]): any[] => {
    return toolCalls.map((tc) => ({
      id: tc.id,
      index: tc.index,
      type: tc.type,
      name: tc.name,
      arguments: tc.arguments,
    }));
  };

  /**
   * 将新 chunk 合并到缓存中
   * 注意：不同类型的事件不能合并，会先刷新旧缓存
   * @returns 如果因为类型冲突而刷新了旧缓存，返回被刷新的 chunk；否则返回 null
   */
  const mergeChunk = (chunk: LLMResponseChunk): LLMResponseChunk | null => {
    const newType = getChunkEventType(chunk);

    if (!buffer) {
      // 首次缓存，创建副本避免修改原始对象
      buffer = {
        content: chunk.content || null,
        reasoningContent: chunk.reasoningContent || null,
        finishReason: chunk.finishReason || null,
        toolCalls: chunk.toolCalls
          ? cloneToolCalls(chunk.toolCalls)
          : undefined,
        usage: chunk.usage || null,
      };
      return null;
    }

    // 判断当前 buffer 的类型
    const bufferType = getChunkEventType(buffer);

    // 不同类型不能合并：先刷新旧缓存，再开始新缓存
    if (bufferType !== newType && bufferType !== "unknown") {
      const flushedChunk = flush();
      // 开始新缓存
      buffer = {
        content: chunk.content || null,
        reasoningContent: chunk.reasoningContent || null,
        finishReason: chunk.finishReason || null,
        toolCalls: chunk.toolCalls
          ? cloneToolCalls(chunk.toolCalls)
          : undefined,
        usage: chunk.usage || null,
      };
      return flushedChunk;
    }

    // 同类型可以合并
    // 累加文本内容
    if (chunk.content) {
      buffer.content = (buffer.content || "") + chunk.content;
    }

    // 累加思考内容
    if (chunk.reasoningContent) {
      buffer.reasoningContent =
        (buffer.reasoningContent || "") + chunk.reasoningContent;
    }

    // 累加工具调用（按 index 分组，合并 arguments）
    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      if (!buffer.toolCalls) {
        buffer.toolCalls = [];
      }
      for (const tc of chunk.toolCalls) {
        const existing = buffer.toolCalls.find((t) => t.index === tc.index);
        if (existing) {
          // 同一工具调用的增量分片，累加 arguments
          if (tc.arguments) {
            existing.arguments = (existing.arguments || "") + tc.arguments;
          }
          // 更新 name（可能后续才到达）
          if (tc.name && !existing.name) {
            existing.name = tc.name;
          }
        } else {
          // 新的工具调用
          buffer.toolCalls.push({ ...tc });
        }
      }
    }

    // 更新 finishReason（通常只在最后一个 chunk 中出现）
    if (chunk.finishReason) {
      buffer.finishReason = chunk.finishReason;
    }

    // 更新 usage（通常只在最后一个 chunk 中出现）
    if (chunk.usage) {
      buffer.usage = chunk.usage;
    }

    return null;
  };

  try {
    let chunkPromise: Promise<IteratorResult<LLMResponseChunk>> | undefined =
      undefined;
    let chunkPromiseWait:
      | Promise<{ type: "chunk"; value: IteratorResult<LLMResponseChunk> }>
      | undefined = undefined;

    while (!streamDone) {
      // 检查 abort 信号
      if (abortSignal?.aborted) {
        const finalChunk = flush();
        if (finalChunk) {
          yield finalChunk;
        }
        throw new Error("AbortError");
      }

      // 竞争：等待下一个 chunk 或定时器到期
      if (chunkPromise == undefined) {
        chunkPromise = iterator.next();
        chunkPromiseWait = chunkPromise.then((r) => ({
          type: "chunk" as const,
          value: r,
        }));
      }
      const timerPromise = scheduleFlush();

      const result = await Promise.race([
        chunkPromiseWait,
        timerPromise.then(() => ({ type: "timer" as const, value: null })),
      ]);

      if (result.type === "chunk") {
        const { value, done } = result.value;
        chunkPromise = undefined;
        if (done) {
          streamDone = true;
          // 流结束，刷新剩余缓存
          const finalChunk = flush();
          if (finalChunk) {
            yield finalChunk;
          }
          break;
        }

        const chunk = value as LLMResponseChunk;

        // 合并到缓存（包含 finishReason、usage 等）
        // 如果类型冲突，会返回需要立即刷新的旧缓存
        const flushed = mergeChunk(chunk);
        if (flushed) {
          yield flushed;
        }

        // finishReason 存在时立即刷新合并后的缓存
        if (chunk.finishReason) {
          const finishedChunk = flush();
          if (finishedChunk) {
            yield finishedChunk;
          }
          continue;
        }

        // 重置定时器：清除旧的，让下次循环重新调度
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
      } else {
        // 定时器到期，刷新缓存
        const flushedChunk = flush();
        if (flushedChunk) {
          yield flushedChunk;
        }
      }
    }
  } finally {
    // 清理资源
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }
}
