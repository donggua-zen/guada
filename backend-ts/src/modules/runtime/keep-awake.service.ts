import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { BridgeClient } from "../bridge/bridge-client";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { JobRegistryService } from "../jobs/job-registry.service";

/**
 * keep-awake 忙碌上报：告诉 Electron 主进程「后端现在有没有在执行任务」。
 *
 * 判据只看 ChatRunner 队列——所有执行入口（用户对话、定时任务派发、子 Agent、
 * 工作流、Bot 入站消息）都经它排队，且它是后端权威状态，不依赖任何前端心跳。
 *
 * 上报方式为幂等：每 tick 都发当前真值，而不是只在变化时发。宿主侧（Electron）
 * 断线会把状态复位，重连后无需任何补偿逻辑，下一个 tick 自然把真值带过去。
 */
const POLL_INTERVAL_MS = 5_000;

@Injectable()
export class KeepAwakeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeepAwakeService.name);
  private timer: NodeJS.Timeout | null = null;
  /** 仅用于抑制日志噪声，不参与上报判据 */
  private lastLogged: boolean | null = null;

  constructor(
    private readonly chatRunner: ChatRunnerService,
    private readonly bridgeClient: BridgeClient,
    // 后台 shell/remote/subagent/workflow/scheduler job；测试可直接 new 两参。
    @Optional() private readonly jobRegistry?: JobRegistryService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.report(), POLL_INTERVAL_MS);
    // Web 部署（无 Electron 宿主）下 bridge 永远连不上，这里只是空转一个 5s 定时器
    this.timer.unref?.();
    this.report();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 当前是否有任务在执行（供诊断与测试直接调用） */
  isBusy(): boolean {
    return (
      this.chatRunner.hasActiveWork() ||
      (this.jobRegistry?.hasActiveJobs() ?? false)
    );
  }

  private report(): void {
    if (!this.bridgeClient.isConnected) return;
    const busy = this.isBusy();
    this.bridgeClient.emit("keep_awake_state", { busy });
    if (busy !== this.lastLogged) {
      this.lastLogged = busy;
      this.logger.log(`keep-awake busy=${busy}`);
    }
  }
}
