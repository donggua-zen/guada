/**
 * 会话级 Token 使用量追踪器
 *
 * 负责在内存中累加每次 LLM 调用的 token 使用量，
 * 并持久化到 .guada/tokens.json，支持会话恢复时重载。
 *
 * 文件格式（JSON）：
 * {
 *   "sessionId": "abc123",
 *   "promptTokens": 15420,
 *   "completionTokens": 8931,
 *   "totalTokens": 24351,
 *   "updatedAt": "2026-06-22T03:00:00.000Z"
 * }
 */
import * as path from "path";
import * as fs from "fs/promises";

export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  updatedAt: string;
}

export class SessionTokenTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private filePath: string;
  private loaded = false;

  constructor(
    workspacePath: string,
    sessionId: string,
  ) {
    this.filePath = path.join(workspacePath, ".guada", `${sessionId}.tokens.json`);
  }

  /**
   * 从文件加载已有记录（如果存在）
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const record: TokenUsageRecord = JSON.parse(data);
      this.promptTokens = record.promptTokens || 0;
      this.completionTokens = record.completionTokens || 0;
      this.totalTokens = record.totalTokens || 0;
    } catch {
      // 文件不存在或解析失败，从零开始
    }
  }

  /**
   * 累加一次 LLM 调用的 token 使用量并持久化
   */
  async addUsage(promptTokens: number, completionTokens: number): Promise<void> {
    this.promptTokens += promptTokens;
    this.completionTokens += completionTokens;
    this.totalTokens = this.promptTokens + this.completionTokens;
    await this.save();
  }

  /**
   * 获取当前累计的 token 统计
   */
  getStats(): TokenUsageRecord {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 持久化到文件
   */
  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.getStats(), null, 2), "utf-8");
    } catch (error) {
      // 写入失败不应影响主流程，静默忽略
    }
  }
}
