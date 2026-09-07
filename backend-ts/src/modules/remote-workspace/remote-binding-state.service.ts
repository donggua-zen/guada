/**
 * RemoteBindingStateService — 远程连接绑定的"冻结快照 + 增量注入"状态机。
 *
 * 解决的问题：ssh-tools 提示词清单随会话绑定实时变化 → 系统提示词前缀变化 → LLM KV 缓存整体失效。
 *
 * 语义（两态）：
 * - systemPromptIds：当前系统提示词所反映的绑定（冻结）。仅两处更新：冷启动（无记录时初始化）与压缩后（MEMORY_COMPACTED）。
 * - lastInjectedIds：历史注入块已告知模型的绑定。每次检测发现变更时更新。
 *
 * 变更通道：绑定变更不进系统提示词，而是以 origin='system' 注入块跟随下一条用户消息
 * （chat-runner.startStream 检测 → userMessage.injectedBlocks → addUserMessage 落库），
 * 追加式不改前缀，KV 缓存零损失。
 *
 * 存储：SettingsStorage group `chat-session-state:<sessionId>`（JSON 文件，非 session.settings
 * ——前端整对象 PUT 会覆盖 settings 内部字段，故状态独立存放）。
 */
import { Injectable, Logger } from "@nestjs/common";
import type { ContentBlock } from "../../common/types/conversation.types";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { RemoteWorkspaceService } from "./remote-workspace.service";

/** ssh 连接绑定状态（按会话存储） */
interface BindingState {
  /** 系统提示词当前反映的连接 id（冻结，仅冷启动/压缩后更新） */
  systemPromptIds: string[];
  /** 最近一次注入块已告知的连接 id */
  lastInjectedIds: string[];
}

const STATE_KEY = "ssh-bindings";

@Injectable()
export class RemoteBindingStateService {
  private readonly logger = new Logger(RemoteBindingStateService.name);

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly workspaceService: RemoteWorkspaceService,
  ) {}

  private group(sessionId: string): string {
    return `chat-session-state:${sessionId}`;
  }

  private async loadState(sessionId: string): Promise<BindingState | null> {
    const state = await this.settingsStorage.getSettingValue(
      this.group(sessionId),
      STATE_KEY,
      null,
    );
    if (
      !state ||
      !Array.isArray(state.systemPromptIds) ||
      !Array.isArray(state.lastInjectedIds)
    ) {
      return null;
    }
    return state as BindingState;
  }

  private async saveState(sessionId: string, state: BindingState): Promise<void> {
    await this.settingsStorage.updateSettings(this.group(sessionId), {
      [STATE_KEY]: state,
    });
  }

  /**
   * 回合开始检测：绑定相对"已注入状态"发生变更 → 生成注入块并更新 lastInjectedIds。
   * - 无记录（冷启动）→ 初始化两态为 live，返回空（系统提示词将直接渲染 live）；
   * - 无变化 → 返回空；
   * - systemPromptIds 冻结不动（缓存保持）。
   */
  async detectAndBuildInjection(
    sessionId: string,
    liveIds: string[],
  ): Promise<ContentBlock[]> {
    const live = this.normalize(liveIds);
    const state = await this.loadState(sessionId);
    if (!state) {
      await this.saveState(sessionId, {
        systemPromptIds: live,
        lastInjectedIds: live,
      });
      return [];
    }
    if (this.sameIds(state.lastInjectedIds, live)) {
      return [];
    }
    const text = await this.renderChangeText(state.lastInjectedIds, live);
    await this.saveState(sessionId, { ...state, lastInjectedIds: live });
    this.logger.log(
      `Remote binding change detected (session ${sessionId}), injecting reminder block`,
    );
    return [
      {
        type: "text",
        text: `<system_reminder>\n${text}\n</system_reminder>`,
        origin: "system",
      } as ContentBlock,
    ];
  }

  /**
   * 供 ssh-tools 提示词 handler：按 systemPromptIds（冻结快照）渲染连接清单。
   * 无记录（首次）→ 以 live 初始化两态。返回空串表示快照为空（未绑定）。
   */
  async renderSnapshotList(sessionId: string, liveIds: string[]): Promise<string> {
    let state = await this.loadState(sessionId);
    if (!state) {
      const live = this.normalize(liveIds);
      state = { systemPromptIds: live, lastInjectedIds: live };
      await this.saveState(sessionId, state);
    }
    return this.renderList(state.systemPromptIds);
  }

  /** 压缩后刷新：两态都对齐 live（缓存本就因历史重写而重建，提示词可安全反映最新绑定） */
  async refreshOnCompaction(sessionId: string, liveIds: string[]): Promise<void> {
    const live = this.normalize(liveIds);
    await this.saveState(sessionId, {
      systemPromptIds: live,
      lastInjectedIds: live,
    });
  }

  // ── 渲染 ──

  private async renderList(ids: string[]): Promise<string> {
    if (ids.length === 0) return "";
    const connections = await this.workspaceService.getConnections();
    const byId = new Map(connections.map((c) => [c.id, c]));
    const lines: string[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) {
        // 已删除的连接：保留占位（冻结语义），注入块会另行告知变更
        lines.push(`- (removed connection: ${id})`);
        continue;
      }
      lines.push(
        `- "${c.name}": ${c.config.username || "root"}@${c.config.host}:${c.config.port || 22}${c.config.path || ""}`,
      );
    }
    return lines.join("\n");
  }

  private async renderChangeText(before: string[], after: string[]): Promise<string> {
    const connections = await this.workspaceService.getConnections();
    const byId = new Map(connections.map((c) => [c.id, c]));
    const describe = (id: string): string => {
      const c = byId.get(id);
      return c ? `"${c.name}" (${c.config.username || "root"}@${c.config.host})` : `"${id}" (removed)`;
    };
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const added = after.filter((id) => !beforeSet.has(id));
    const removed = before.filter((id) => !afterSet.has(id));

    const lines: string[] = ["# Remote Workspace Bindings Changed"];
    lines.push(
      "(This supersedes the connection list shown in the system prompt. Current bindings:)",
    );
    if (after.length === 0) {
      lines.push("- (none — no remote workspaces are bound now)");
    } else {
      for (const id of after) lines.push(`- ${describe(id)}`);
    }
    if (added.length > 0) {
      lines.push(`Newly bound: ${added.map(describe).join(", ")}`);
    }
    if (removed.length > 0) {
      lines.push(`Unbound: ${removed.map(describe).join(", ")}`);
    }
    lines.push(
      'Operate on a remote workspace by passing workspace="<connection name>" to the standard file tools (read/glob/write/edit/grep) and run_command.',
    );
    return lines.join("\n");
  }

  // ── 工具 ──

  private normalize(ids: string[] | undefined | null): string[] {
    return Array.from(new Set(ids || []));
  }

  private sameIds(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
}
