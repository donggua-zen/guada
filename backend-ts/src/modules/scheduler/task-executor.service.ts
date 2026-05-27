import { Injectable, Logger } from "@nestjs/common";
import { SessionService } from "../chat/session.service";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { SessionEventsService } from "../chat/session-events.service";
import { TaskStorageService } from "./task-storage.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { PrismaService } from "../../common/database/prisma.service";
import { ScheduledTask, ScheduledTaskLog } from "./types/scheduler.types";
import { SG_MODELS, SK_MOD_CHAT } from "../../constants/settings.constants";
import { randomUUID } from "crypto";

/**
 * 可重试的错误类型
 * 会话忙碌等临时性问题可以重试
 */
const RETRYABLE_ERROR_CODES = new Set([
  "SESSION_BUSY",
  "STREAM_START_FAILED",
  "SUBSCRIBE_FAILED",
]);

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: any): boolean {
  if (!error) return false;
  // HttpException 的响应体中包含 code
  const code = error?.response?.code || error?.code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  // 根据错误消息判断
  const msg = error?.message || "";
  if (msg.includes("会话正在处理") || msg.includes("busy")) return true;
  return false;
}

/**
 * 定时任务执行引擎
 *
 * 负责实际执行定时任务：
 * 1. 根据任务配置创建新会话或复用现有会话
 * 2. 将任务提示词作为用户消息写入会话
 * 3. 调用 AgentEngine 生成 AI 回复（后台非流式执行）
 * 4. 记录执行日志
 */
@Injectable()
export class TaskExecutorService {
  private readonly logger = new Logger(TaskExecutorService.name);

  constructor(
    private sessionService: SessionService,
    private chatRunner: ChatRunnerService,
    private sessionEventsService: SessionEventsService,
    private storage: TaskStorageService,
    private settingsStorage: SettingsStorage,
    private prisma: PrismaService,
  ) {}

  /**
   * 执行定时任务（带重试机制）
   */
  async execute(task: ScheduledTask): Promise<void> {
    this.logger.log(`开始执行任务: ${task.name} (${task.id})`);

    const log: ScheduledTaskLog = {
      id: randomUUID(),
      taskId: task.id,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await this.storage.createLog(log);

    const maxRetries = task.maxRetries ?? 0;
    const retryInterval = (task.retryInterval ?? 60) * 1000;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        this.logger.log(
          `任务 ${task.name} 第 ${attempt}/${maxRetries} 次重试，等待 ${retryInterval}ms...`,
        );
        await this.sleep(retryInterval);
      }

      try {
        await this.runOnce(task, log);
        // 执行成功，更新执行次数并检查是否达到上限
        await this.incrementExecutionCount(task);
        return;
      } catch (error: any) {
        lastError = error;
        const isRetryable = isRetryableError(error);

        if (!isRetryable || attempt >= maxRetries) {
          // 不可重试或已达到最大重试次数
          this.logger.error(
            `任务 ${task.name} 执行失败${attempt > 0 ? `（已重试 ${attempt} 次）` : ""}:`,
            error,
          );
          await this.storage.updateLog(log.id, {
            status: "failed",
            error: error.message || "未知错误",
            finishedAt: new Date().toISOString(),
          });
          return;
        }

        this.logger.warn(
          `任务 ${task.name} 第 ${attempt + 1} 次执行失败，将在 ${retryInterval}ms 后重试: ${error.message}`,
        );
      }
    }

    // 清理过期日志
    await this.storage.cleanupOldLogs(200);
  }

  /**
   * 增加任务执行次数，达到上限时自动禁用
   */
  private async incrementExecutionCount(task: ScheduledTask): Promise<void> {
    const newCount = (task.executionCount ?? 0) + 1;
    const maxExecutions = task.maxExecutions;

    // 检查是否达到最大执行次数上限
    const reachedMaxExecutions =
      maxExecutions !== null &&
      maxExecutions !== undefined &&
      newCount >= maxExecutions;

    // 一次性任务执行完成后自动禁用
    const isOnceCompleted = task.scheduleType === "once";

    if (reachedMaxExecutions || isOnceCompleted) {
      this.logger.log(
        `任务 ${task.name} ${reachedMaxExecutions ? `已达到最大执行次数 (${newCount}/${maxExecutions})` : "已完成"}，自动禁用`,
      );
      await this.storage.updateTask(task.id, {
        executionCount: newCount,
        enabled: false,
      });
    } else {
      await this.storage.updateTask(task.id, {
        executionCount: newCount,
      });
    }
  }

  /**
   * 单次执行任务
   */
  private async runOnce(
    task: ScheduledTask,
    log: ScheduledTaskLog,
  ): Promise<void> {
    const { sessionId } = await this.prepareSession(task);
    if (!sessionId) {
      throw new Error("无法准备会话");
    }

    // 更新日志中的会话 ID
    await this.storage.updateLog(log.id, { sessionId });

    // 使用 ChatRunnerService 启动流式对话（不传 callbacks，后台执行）
    await this.chatRunner.startStream(
      {
        sessionId,
        userId: task.userId,
        userMessage: {
          content: task.prompt,
        },
        regenerationMode: "overwrite",
        source: { type: "scheduler", schedulerId: task.id },
      },
      undefined, // 不传 callbacks，后台执行
    );

    this.logger.log(`已启动流式对话: ${task.name}`);

    // 更新任务最后执行时间
    await this.storage.updateTask(task.id, {
      lastRunAt: new Date().toISOString(),
    });

    // 标记日志为完成（流是异步运行的，这里只表示启动成功）
    await this.storage.updateLog(log.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });

    this.logger.log(`任务执行完成: ${task.name}`);
  }

  /**
   * 测试执行任务（无任何副作用）
   *
   * 特性：
   * - 失败不重试
   * - 不增加 executionCount
   * - 不自动禁用任务
   * - 不更新 lastRunAt
   * - 不创建执行日志
   * - 仅执行任务本身的对话逻辑
   */
  async dryRun(task: ScheduledTask): Promise<void> {
    this.logger.log(`开始测试执行任务: ${task.name} (${task.id})`);

    const { sessionId } = await this.prepareSession(task);
    if (!sessionId) {
      throw new Error("无法准备会话");
    }

    // 使用 ChatRunnerService 启动流式对话（不传 callbacks，后台执行）
    await this.chatRunner.startStream(
      {
        sessionId,
        userId: task.userId,
        userMessage: {
          content: task.prompt,
        },
        regenerationMode: "overwrite",
        source: { type: "scheduler", schedulerId: task.id },
      },
      undefined, // 不传 callbacks，后台执行
    );

    this.logger.log(`测试任务执行完成: ${task.name}`);
  }

  /**
   * 延迟等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 准备会话：创建新会话或复用现有会话
   * @returns 会话 ID
   */
  /**
   * 解析任务模型ID（三级回退）
   *
   * 1. 任务显式指定的 modelId
   * 2. 角色的 modelId
   * 3. 全局默认对话模型
   *
   * 最终必须验证模型存在，否则抛出错误。
   */
  private async resolveModelId(task: ScheduledTask): Promise<string> {
    let modelId: string | null = null;

    // 第一优先级：任务显式指定的 modelId
    if (task.modelId) {
      modelId = task.modelId;
    }

    // 第二优先级：角色的 modelId
    if (!modelId && task.characterId) {
      const character = await this.prisma.character.findUnique({
        where: { id: task.characterId },
      });
      if (!character) {
        throw new Error(`角色不存在：${task.characterId}`);
      }
      if (character.modelId) {
        modelId = character.modelId;
      }
    }

    // 第三优先级：全局默认对话模型
    if (!modelId) {
      modelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
        null,
      );
    }

    // 最终必须有效
    if (!modelId) {
      throw new Error(
        "无法解析模型ID：任务未指定模型，角色未配置模型，且全局默认对话模型未设置",
      );
    }

    // 验证模型是否存在
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
    });
    if (!model) {
      throw new Error(`模型不存在：${modelId}，请检查模型配置`);
    }

    return modelId;
  }

  private async prepareSession(
    task: ScheduledTask,
  ): Promise<{ sessionId: string } | null> {
    if (task.targetMode === "new_session") {
      // 创建新会话，必须指定角色ID
      if (!task.characterId) {
        throw new Error("新建会话模式必须设置 characterId");
      }

      // 解析模型ID（三级回退）
      const finalModelId = await this.resolveModelId(task);

      const session = await this.sessionService.createSession(task.userId, {
        characterId: task.characterId,
        modelId: finalModelId,
        title: `[定时] ${task.name}`,
        settings: task.settings || undefined,
      });
      this.logger.log(`已创建新会话: ${session.id}`);

      // 广播会话创建事件，让前端会话列表刷新
      this.sessionEventsService.broadcastToUser(task.userId, {
        type: "session_created",
        userId: task.userId,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        payload: { session },
      });

      return { sessionId: session.id };
    } else {
      // 复用现有会话
      if (!task.targetSessionId) {
        throw new Error("目标会话模式未指定会话 ID");
      }
      const session = await this.sessionService.getSessionById(
        task.targetSessionId,
        task.userId,
      );
      if (!session) {
        throw new Error(`目标会话不存在: ${task.targetSessionId}`);
      }
      return { sessionId: session.id };
    }
  }
}
