/**
 * remote-workspace builtin plugin — 附加（远程）工作目录支持。
 *
 * 职责：
 * 1. 注册 ssh-connection 附件类型（会话绑定远程连接的入口）；
 * 2. 注册 ssh-tools 工具包：条件注入连接清单 prompt（说明 workspace 参数用法）
 *    + remote_transfer 工具（本地 ↔ 远端文件传输）；
 * 3. 提供 SshWorkspaceProvider / WorkspaceToolRouter（经 file/shell 工具的
 *    workspace 参数操作远端，见 workspace-router.ts）。
 *
 * 历史：本插件曾注册 remote_read/write/edit/grep/bash 五个独立工具，
 * 已合并进标准文件与命令工具（workspace 参数路由），历史会话中的
 * remote_* 工具调用块由 plugins.controller 的 legacy display 映射继续渲染。
 */
import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { z } from "zod";
import { HOOKS } from "../chat/types/hooks.contract";
import { RemoteBindingStateService } from "./remote-binding-state.service";
import { PluginBase } from "../plugins/base-plugin";
import type { PluginApi } from "../plugins/api/plugin-api";
import type { PluginContext } from "../plugins/types/plugin.types";
import { RemoteWorkspaceService } from "./remote-workspace.service";
import { RemoteAgentManager } from "./remote-workspace-agent-manager";
import langZh from "./remote-workspace.lang.zh.json";
import langEn from "./remote-workspace.lang.en.json";

@Injectable()
export class RemoteWorkspacePlugin extends PluginBase {
  manifest = {
    id: "remote-workspace",
    name: "%remoteWorkspace.name%",
    version: "0.4.0",
    description: "%remoteWorkspace.description%",
    category: "system" as const,
    essential: true,
  };

  constructor(
    private readonly workspaceService: RemoteWorkspaceService,
    private readonly manager: RemoteAgentManager,
    private readonly bindingState: RemoteBindingStateService,
  ) {
    super();
  }

  /**
   * 压缩后刷新绑定快照：systemPromptIds 对齐当前绑定，
   * 下回合系统提示词反映最新绑定（历史已重写，缓存本就重建）。
   */
  @OnEvent(HOOKS.MEMORY_COMPACTED)
  async handleMemoryCompacted(payload: {
    sessionId: string;
    sessionContext?: import("../chat/session-context").ISessionContext;
  }) {
    try {
      const liveIds: string[] =
        payload?.sessionContext?.getSettings?.()?.attachments?.[
          "ssh-connection"
        ] || [];
      await this.bindingState.refreshOnCompaction(payload?.sessionId, liveIds);
    } catch {
      // 快照刷新失败不影响压缩流程
    }
  }

  async onLoad(api: PluginApi) {
    // 工具展示文案语言包(display.text/aggregate 的 %key% 引用在此解析)
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);

    // Register attachment type so AttachmentPopover can list connections
    api.registerAttachmentType({
      id: "ssh-connection",
      label: "%remoteWorkspace.name%",
      icon: "cloud",
      list: async () => {
        const connections = await this.workspaceService.getConnections();
        return connections.map((c) => ({
          id: c.id,
          name: c.name,
          description: `${c.config.username}@${c.config.host}`,
          meta: c.config,
        }));
      },
    });

    // 恒 eager：工具列表与提示词 piece 恒定（不随绑定出现/消失），
    // 避免绑定变更引发 LLM 前缀缓存失效；连接清单由提示词按冻结快照渲染。
    const sshKit = api.registerToolKit({
      id: "ssh-tools",
      name: "%remoteWorkspace.toolkitName%",
      description: "%remoteWorkspace.toolkitDescription%",
      loadMode: "eager",
      activator:
        "Use these tools when the user asks to operate on remote servers via SSH connections.",
    });
    // 提示词按冻结快照渲染（RemoteBindingStateService 两态状态机）：
    // 绑定变更以注入块跟随下一条用户消息，系统提示词仅冷启动/压缩后刷新 → 前缀缓存稳定。
    sshKit.registerPrompt({
      frequency: "STATIC",
      description: "Remote SSH connections info",
      content: async (ctx: PluginContext) => {
        const liveIds: string[] =
          ctx.session.getSettings?.()?.attachments?.["ssh-connection"] || [];
        const list = await this.bindingState.renderSnapshotList(
          ctx.session.sessionId,
          liveIds,
        );
        if (!list) {
          return [
            "# Additional Workspaces (Remote)",
            "No remote workspaces are currently bound to this session.",
            'If the user binds one, the connection list will be provided via a follow-up reminder; operate on it with workspace="<connection name>" on the standard file tools.',
          ].join("\n");
        }
        return [
          "# Remote SSH Connections (Additional Workspaces)",
          "The following remote connections are bound to this session as additional workspaces:",
          list,
          "",
          'To operate on a remote workspace, pass workspace="<connection name>" (must match exactly) to the standard file tools (read/glob/write/edit/grep) and run_command.',
          'Paths are then relative to that remote workspace\'s directory. Omit workspace (or use "main") for the primary local workspace.',
          "remote_transfer keeps its own 'connection' parameter to move files between local and remote.",
          "If bindings change mid-session, an updated list arrives as a follow-up reminder (it supersedes this list).",
        ].join("\n");
      },
    });

    // ── remote_transfer：本地 ↔ 远端文件传输（分块，1MB/块）──
    sshKit.registerTool({
      name: "remote_transfer",
      description: `Transfer files between local and remote SSH server.
- Upload: {"action":"upload","connection":"xxx","local_path":"...","remote_path":"..."}
- Download: {"action":"download","connection":"xxx","remote_path":"...","local_path":"..."}`,
      inputSchema: z.object({
        action: z.enum(["upload", "download"]),
        connection: z
          .string()
          .describe("Connection name (must match a bound connection exactly)"),
        local_path: z.string().describe("Local file path"),
        remote_path: z.string().describe("Remote file path"),
      }),
      execute: async (args: any, ctx: PluginContext, signal?: AbortSignal) => {
        const attachments = ctx.session.getSettings?.()?.attachments || {};
        const agent = await this.manager.getAgent(
          args.connection,
          ctx.session.sessionId,
          attachments,
        );
        if (args.action === "upload") {
          return agent.upload(args.local_path, args.remote_path, signal);
        } else {
          return agent.download(args.remote_path, args.local_path, signal);
        }
      },
      display: {
        argsKey: "action",
        icon: "edit",
        text: {
          executing: "%remote_transfer.executing%",
          completed: "%remote_transfer.completed%",
        },
        aggregate: {
          executing: "%remote_transfer.aggregate.executing%",
          completed: "%remote_transfer.aggregate.completed%",
        },
      },
      dangerLevel: "high",
    });
  }
}
