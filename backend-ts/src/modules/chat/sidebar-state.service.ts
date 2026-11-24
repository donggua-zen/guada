import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { EventBusService } from "../../common/events/event-bus.service";
import { APP_BOOT_ID } from "../../common/utils/boot-id.util";

/**
 * 侧栏状态修订号（进程内）。
 *
 * 侧栏里有一批结构性变更没有逐条事件：分组/目录分组的改名、换图标、排序、
 * 归档、删除，以及自动标题。给它们逐个设计事件既繁琐又容易漏字段；这里只
 * 维护一个粗粒度修订号，变更后经 WS 广播，客户端收到后重拉现有侧栏快照做
 * 对账（见前端 sidebarSnapshot.ts）。
 *
 * 只覆盖“没有事件通道”的变更：会话 CRUD/重命名/置顶继续走现有
 * session_created/updated/deleted 事件，不在这里 touch。
 *
 * 不落库：进程重启后 bootId 变化，客户端据此判定需要全量对账。
 */
export const SIDEBAR_STATE_CHANGED = "sidebar.state_changed";

/** 合并同一次用户操作产生的多次 touch（例如分组归档会批量改会话） */
const SIDEBAR_STATE_DEBOUNCE_MS = 300;

export interface SidebarStateSnapshot {
  scope: "sidebar";
  bootId: string;
  revision: number;
  updatedAt: string;
}

export interface SidebarStateChangedEvent extends SidebarStateSnapshot {
  reason: string;
}

@Injectable()
export class SidebarStateService implements OnModuleDestroy {
  private revision = 0;
  private updatedAt = new Date().toISOString();
  private pendingReason = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly eventBus: EventBusService) {}

  /** 当前修订号快照（ready 帧与 state/ping 回包用） */
  snapshot(): SidebarStateSnapshot {
    return {
      scope: "sidebar",
      bootId: APP_BOOT_ID,
      revision: this.revision,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 标记侧栏结构发生变化。
   *
   * 300ms 内多次调用只广播一次，payload 取最后一次 touch 时的修订号；
   * 客户端只比较 bootId+revision，不关心具体操作。
   */
  touch(reason: string): void {
    this.revision += 1;
    this.updatedAt = new Date().toISOString();
    this.pendingReason = reason;
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const event: SidebarStateChangedEvent = {
        ...this.snapshot(),
        reason: this.pendingReason,
      };
      this.pendingReason = "";
      this.eventBus.emit(SIDEBAR_STATE_CHANGED, event);
    }, SIDEBAR_STATE_DEBOUNCE_MS);
    // 仅在无人监听时也不阻止进程退出（生产常驻进程无影响，测试更干净）
    (this.flushTimer as { unref?: () => void }).unref?.();
  }

  onModuleDestroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
