import * as fs from "fs";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";

export interface PruningMetadata {
  contentId: string;
  messageId?: string;
  originalLength: number;
  prunedLength: number;
  prunedContent?: string; // 存储裁剪后的内容片段
}

export interface CompressionState {
  // ========== 两级压缩核心字段 ==========
  
  /**
   * 数据库查询游标：标记最后一条被“摘要化”的 Message ID。
   * 作用：在 loadRawTurnsFromDB 时用于 SQL 过滤，确保已消化的旧消息不再从数据库加载。
   */
  lastCompactedMessageId?: string;

  /**
   * 内存过滤边界：标记最后一条被“摘要化”的 Content ID。
   * 作用：在数据库加载后，用于内存中精准剔除该 ID 及之前的残留 Content，确保 LLM 不看到已摘要的内容。
   */
  lastCompactedContentId?: string;

  /** 历史对话生成的语义摘要内容 */
  summaryContent?: string;

  /** 当前生效的压缩策略：'pruned_only' (仅裁剪) | 'summarized' (已摘要) */
  cleaningStrategy?: string;
  
  /**
   * 增量裁剪游标：标记最后一条执行过“字符串截断”的 Content ID。
   * 作用：在 pruneMessages 时传入，跳过已处理过的消息，避免重复裁剪，提高性能。
   * 注意：这些消息依然存在于上下文中（只是变短了），不应被物理删除。
   */
  lastPrunedContentId?: string;

  /** 裁剪元数据映射表：ContentId -> { prunedContent, originalLength, ... }，用于在内存中应用覆盖层 */
  pruningMetadata?: Record<string, PruningMetadata>;
  
  version?: number;
}

@Injectable()
export class FileBasedStateStorage {
  private readonly logger = new Logger(FileBasedStateStorage.name);
  private readonly storageDir: string;

  constructor() {
    // 使用项目根目录下的 data 文件夹
    this.storageDir = path.join(process.cwd(), "data", "compression-states");
    this.ensureDirectoryExists();
  }

  /**
   * 确保存储目录存在
   */
  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
      this.logger.log(`Created compression state storage directory: ${this.storageDir}`);
    }
  }

  /**
   * 获取指定会话的压缩状态
   */
  async getState(sessionId: string): Promise<CompressionState | null> {
    const filePath = this.getFilePath(sessionId);
    try {
      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath, "utf-8");
        return JSON.parse(content) as CompressionState;
      }
      return null;
    } catch (error) {
      this.logger.error(`Failed to read state for session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * 保存指定会话的压缩状态
   */
  async saveState(sessionId: string, state: CompressionState): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
      this.logger.debug(`Saved compression state for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to save state for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * 删除指定会话的压缩状态
   */
  async deleteState(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.debug(`Deleted compression state for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete state for session ${sessionId}:`, error);
    }
  }

  /**
   * 获取文件路径
   */
  private getFilePath(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.json`);
  }
}
