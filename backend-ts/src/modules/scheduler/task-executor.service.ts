import { Injectable, Logger } from "@nestjs/common";
import { SessionService } from "../chat/session.service";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { EventBusService } from "../../common/events/event-bus.service";
import { TaskStorageService } from "./task-storage.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { AgentFileStore } from "../agents/agent-file.store";
import { DEFAULT_AGENT_ID } from "../agents/agent-file.mapper";
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { ScheduledTask, ScheduledTaskLog } from "./types/scheduler.types";
import { SG_MODELS, SK_MOD_CHAT } from "../../constants/settings.constants";
import { ID_PREFIXES, mintId } from "../../common/utils/id.util";

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
    private eventBus: EventBusService,
    private storage: TaskStorageService,
    private settingsStorage: SettingsStorage,
    private agentStore: AgentFileStore,
    private providerStore: ProviderFileStore,
  ) {}

  /**
   * 执行定时任务（带重试机制）
   */
  async execute(task: ScheduledTask): Promise<void> {
    this.logger.log(`开始执行任务: ${task.name} (${task.id})`);

    const log: ScheduledTaskLog = {
      id: mintId(ID_PREFIXES.taskLog),
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
   * 增加任务执行次数
   *
   * 从存储重读最新计数，避免调度回调闭包捕获的旧 task 引用导致计数不累加。
   * 一次性任务执行完成后自动禁用。
   */
  private async incrementExecutionCount(task: ScheduledTask): Promise<void> {
    const fresh = await this.storage.getTaskById(task.id);
    const newCount = (fresh?.executionCount ?? task.executionCount ?? 0) + 1;
    const scheduleType = fresh?.scheduleType ?? task.scheduleType;

    // 一次性任务执行完成后自动禁用
    const isOnceCompleted = scheduleType === "once";

    if (isOnceCompleted) {
      this.logger.log(`任务 ${task.name} 已完成（一次性），自动禁用`);
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
   *
   * 使用 ChatRunnerService.enqueueMessage() 投递消息，
   * 由 ChatRunnerService 内部队列管理执行时机。
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

    // 投递到 ChatRunnerService 队列（S2：结构化入站消息统一载体，文本即 text 块）
    // 回合的真实终态由 callbacks.onComplete/onError 异步回填（startStream 不阻塞到流结束），
    // 此处不再提前标记 completed，避免"入队即成功"的假象。
    await this.chatRunner.enqueueMessage({
      sessionId,
      blocks: [
        {
          type: "text",
          text: task.prompt,
        },
      ],
      source: { kind: "scheduler", schedulerId: task.id },
      callbacks: {
        onEvent: () => {},
        onComplete: (reason: string) => {
          const ok = reason === "completed";
          this.storage
            .updateLog(log.id, {
              status: ok ? "completed" : "failed",
              error: ok ? null : `回合结束原因: ${reason}`,
              finishedAt: new Date().toISOString(),
            })
            .catch((e) => this.logger.error(`回填执行日志状态失败: ${log.id}`, e));
        },
        onError: (err: any) => {
          this.storage
            .updateLog(log.id, {
              status: "failed",
              error: err?.message || "未知错误",
              finishedAt: new Date().toISOString(),
            })
            .catch((e) => this.logger.error(`回填执行日志状态失败: ${log.id}`, e));
        },
      },
    });

    this.logger.log(`任务已投递到消息队列: ${task.name}`);

    // 更新任务最后执行时间
    await this.storage.updateTask(task.id, {
      lastRunAt: new Date().toISOString(),
    });
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

    // 投递到 ChatRunnerService 队列
    await this.chatRunner.enqueueMessage({
      sessionId,
      blocks: [
        {
          type: "text",
          text: task.prompt,
        },
      ],
      source: { kind: "scheduler", schedulerId: task.id, dryRun: true },
    });

    this.logger.log(`测试任务已投递到消息队列: ${task.name}`);
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
   * 解析有效智能体 ID：
   * 未指定、或指定的智能体已被删除时，回退到固定默认智能体（DEFAULT_AGENT_ID）。
   */
  private async resolveAgentId(task: ScheduledTask): Promise<string> {
    if (!task.agentId) {
      this.logger.warn(`任务 ${task.name} 未指定智能体，回退默认智能体 ${DEFAULT_AGENT_ID}`);
      return DEFAULT_AGENT_ID;
    }
    const agent = await this.agentStore.findById(task.agentId);
    if (!agent) {
      this.logger.warn(
        `任务 ${task.name} 的智能体 ${task.agentId} 已不存在，回退默认智能体 ${DEFAULT_AGENT_ID}`,
      );
      return DEFAULT_AGENT_ID;
    }
    return task.agentId;
  }

  /**
   * 解析任务模型ID（三级回退）
   *
   * 1. 任务显式指定的 modelId
   * 2. 智能体的 modelId
   * 3. 全局默认对话模型
   *
   * 最终必须验证模型存在，否则抛出错误。
   */
  private async resolveModelId(task: ScheduledTask, agentId: string): Promise<string> {
    let modelId: string | null = null;

    // 第一优先级：任务显式指定的 modelId
    if (task.modelId) {
      modelId = task.modelId;
    }

    // 第二优先级：智能体的 modelId
    if (!modelId && agentId) {
      const agent = await this.agentStore.findById(agentId);
      if (agent?.modelId) {
        modelId = agent.modelId;
      }
    }

    // 第三优先级：全局默认对话模型
    if (!modelId) {
      modelId = await this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
        null,
      );
    }

    // 最终必须有效
    if (!modelId) {
      throw new Error(
        "无法解析模型ID：任务未指定模型，智能体未配置模型，且全局默认对话模型未设置",
      );
    }

    // 验证模型是否存在
    const model = this.providerStore.findModel(modelId);
    if (!model) {
      throw new Error(`模型不存在：${modelId}，请检查模型配置`);
    }

    return modelId;
  }

  private async prepareSession(
    task: ScheduledTask,
  ): Promise<{ sessionId: string } | null> {
    if (task.targetMode === "new_session") {
      // 合并输出：若已记住会话且仍存在，直接复用，不再新建
      if (task.outputMode === "merged" && task.mergedSessionId) {
        const existing = await this.sessionService.getSessionById(task.mergedSessionId);
        if (existing) {
          this.logger.log(`复用合并会话: ${existing.id}`);
          return { sessionId: existing.id };
        }
        this.logger.warn(`合并会话已失效，将重新新建: ${task.mergedSessionId}`);
      }

      // 解析有效智能体（缺失/已删除时回退默认智能体）
      const agentId = await this.resolveAgentId(task);

      // 解析模型ID（三级回退）
      const finalModelId = await this.resolveModelId(task, agentId);

      // 组装会话设置：并入附加工作目录（attachments）与无人值守沙盒模式
      const sessionSettings: Record<string, any> = { ...(task.settings || {}) };
      if (task.attachments && Object.keys(task.attachments).length > 0) {
        sessionSettings.attachments = task.attachments;
      }
      // 无人值守：注入 danger-full-access 沙盒模式，使命中提权的工具审批在触发前即被放行，
      // 回合不会卡在等待人工确认（仅对 new_session 生效）
      if (task.unattended) {
        sessionSettings.sandboxMode = "danger-full-access";
      }

      const session = await this.sessionService.createSession({
        agentId,
        modelId: finalModelId,
        title: `[定时] ${task.name}`,
        settings: Object.keys(sessionSettings).length > 0 ? sessionSettings : undefined,
        workspacePath: task.workspacePath ?? null,
      });
      this.logger.log(`已创建新会话: ${session.id}`);

      // 合并输出：回存 mergedSessionId，供后续执行复用
      if (task.outputMode === "merged") {
        await this.storage.updateTask(task.id, { mergedSessionId: session.id });
      }

      // 广播会话创建事件，让前端会话列表刷新
      this.eventBus.emit("session.created", {
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
      );
      if (!session) {
        throw new Error(`目标会话不存在: ${task.targetSessionId}`);
      }
      return { sessionId: session.id };
    }
  }
}
