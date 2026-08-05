/**
 * 会话级 Token 使用量追踪器
 *
 * 负责在内存中累加每次 LLM 调用的 token 使用量，
 * 并持久化到 .guada/tokens.json，支持会话恢复时重载。
 *
 * 主会话与子 agent 全部汇总到同一个文件，不区分 sessionId。
 *
 * 文件格式（JSON）：
 * {
 *   "promptTokens": 15420,
 *   "completionTokens": 8931,
 *   "totalTokens": 24351,
 *   "promptTokensReadable": "15.4K",
 *   "completionTokensReadable": "8.9K",
 *   "totalTokensReadable": "24.4K",
 *   "cachedTokens": 8192,
 *   "cachedTokensReadable": "8.2K",
 *   "updatedAt": "2026-06-22T03:00:00.000Z"
 * }
 */
import { Injectable } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";

export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTokensReadable: string;
  completionTokensReadable: string;
  totalTokensReadable: string;
  /** 累计缓存命中的 token 数（OpenAI cached_tokens / DeepSeek hit / Anthropic read / Gemini cached） */
  cachedTokens: number;
  cachedTokensReadable: string;
  updatedAt: string;
}

/**
 * 将 token 数格式化为人类可读形式（如 15320 → "15.3K"）
 */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + "M";
  if (count >= 1_000) return (count / 1_000).toFixed(1) + "K";
  return String(count);
}

@Injectable()
export class SessionTokenTracker {
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * 从文件读取当前记录，文件不存在则返回零值
   */
  private async readRecord(filePath: string): Promise<TokenUsageRecord> {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const record = JSON.parse(data);
      // 兼容旧文件（不含 readable / cache 字段）
      record.promptTokensReadable = record.promptTokensReadable || formatTokens(record.promptTokens || 0);
      record.completionTokensReadable = record.completionTokensReadable || formatTokens(record.completionTokens || 0);
      record.totalTokensReadable = record.totalTokensReadable || formatTokens(record.totalTokens || 0);
      record.cachedTokens = record.cachedTokens || 0;
      record.cachedTokensReadable = record.cachedTokensReadable || formatTokens(record.cachedTokens || 0);
      return record;
    } catch {
      return {
        promptTokens: 0, completionTokens: 0, totalTokens: 0,
        promptTokensReadable: "0", completionTokensReadable: "0", totalTokensReadable: "0",
        cachedTokens: 0, cachedTokensReadable: "0",
        updatedAt: "",
      };
    }
  }

  /**
   * 累加一次 LLM 调用的 token 使用量并持久化。
   *
   * 每次写入前先读取文件中的最新值再合并，
   * 避免并发运行时（如多个子 agent 同时写入）相互覆盖。
   *
   * @param workspacePath 会话工作目录
   * @param promptTokens 输入 token 数
   * @param completionTokens 输出 token 数
   * @param cachedTokens 缓存命中的 token 数（可选）
   */
  async addUsage(
    workspacePath: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens?: number,
  ): Promise<void> {
    const filePath = path.join(workspacePath, ".guada", "tokens.json");
    const doWrite = async () => {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const current = await this.readRecord(filePath);
        current.promptTokens += promptTokens;
        current.completionTokens += completionTokens;
        current.totalTokens = current.promptTokens + current.completionTokens;
        if (cachedTokens) {
          current.cachedTokens += cachedTokens;
        }
        current.promptTokensReadable = formatTokens(current.promptTokens);
        current.completionTokensReadable = formatTokens(current.completionTokens);
        current.totalTokensReadable = formatTokens(current.totalTokens);
        current.cachedTokensReadable = formatTokens(current.cachedTokens);
        current.updatedAt = new Date().toISOString();
        await fs.writeFile(filePath, JSON.stringify(current, null, 2), "utf-8");
      } catch {
        // 写入失败不应影响主流程，静默忽略
      }
    };
    this.writeQueue = this.writeQueue.then(() => doWrite(), () => doWrite());
    return this.writeQueue;
  }

  /**
   * 获取当前累计的 token 统计（从文件读取最新数据）
   *
   * @param workspacePath 会话工作目录
   */
  async getStats(workspacePath: string): Promise<TokenUsageRecord> {
    const filePath = path.join(workspacePath, ".guada", "tokens.json");
    return this.readRecord(filePath);
  }
}
