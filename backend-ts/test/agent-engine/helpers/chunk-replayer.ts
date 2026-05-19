import { LLMResponseChunk } from '../../../src/modules/llm-core/types/llm.types';
import * as fs from 'fs';

/**
 * 从 JSONL 文件加载 chunk 数据
 * 
 * @param filePath JSONL 文件路径
 * @returns LLMResponseChunk 数组(已过滤空 chunk)
 */
export function loadChunksFromJsonl(filePath: string): LLMResponseChunk[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return lines.map(line => {
    try {
      const parsed = JSON.parse(line);
      // 处理可能的嵌套结构 { timestamp, chunk } 或直接是 chunk
      const chunk = parsed.chunk || parsed;
      return chunk;
    } catch (error) {
      console.warn(`Failed to parse line: ${line.substring(0, 100)}`);
      return null;
    }
  }).filter((chunk): chunk is LLMResponseChunk => 
    chunk !== null && Object.keys(chunk).length > 0
  );
}

/**
 * 异步迭代器重放器
 * 用于在测试中模拟 LLM 流式输出
 */
export class ChunkReplayer {
  constructor(private chunks: LLMResponseChunk[]) {}

  async *[Symbol.asyncIterator]() {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}
