/**
 * remote-workspace builtin plugin — registers ssh_* tools via registerToolKit.
 *
 * Tools are lazy-loaded when session has ssh-connection attachments bound.
 * Connection data is resolved via RemoteWorkspaceService (DI-injected).
 */
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import type { PluginApi } from "../api/plugin-api";
import type { PluginContext } from "../types/plugin.types";
import { RemoteWorkspaceService } from "../../remote-workspace/remote-workspace.service";
import { RemoteAgentManager } from "../../remote-workspace/remote-workspace-agent-manager";
import langZh from "./remote-workspace.lang.zh.json";
import langEn from "./remote-workspace.lang.en.json";

@Injectable()
export class RemoteWorkspacePlugin extends PluginBase {
  private manager: RemoteAgentManager;

  manifest = {
    id: "remote-workspace",
    name: "%remoteWorkspace.name%",
    version: "0.3.0",
    description: "%remoteWorkspace.description%",
    category: "extended" as const,
  };

  constructor(private readonly workspaceService: RemoteWorkspaceService) {
    super();
    this.manager = new RemoteAgentManager(workspaceService);
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

    // Prompt: list bound connections by name so AI can identify the target server
    api.registerPrompt({
      frequency: "STATIC",
      description: "Remote SSH connections info",
      content: async (ctx: PluginContext) => {
        const attachments = ctx.session.getSettings?.()?.attachments || {};
        const connectionIds: string[] = attachments["ssh-connection"] || [];
        if (connectionIds.length === 0) return "";
        const connections = await this.workspaceService.getConnections();
        const bound = connections.filter((c) => connectionIds.includes(c.id));
        if (bound.length === 0) return "";
        const lines = ["# Remote SSH Connections"];
        lines.push(
          "Use the connection name to identify which server to operate on:",
        );
        for (const c of bound) {
          lines.push(
            `- "${c.name}": ${c.config.username || "root"}@${c.config.host}:${c.config.port || 22}${c.config.path || ""}`,
          );
        }
        lines.push(
          "",
          "All ssh_* tools require the 'connection' parameter set to the connection name (must match exactly).",
        );
        return lines.join("\n");
      },
    });

    api.registerToolKit({
      id: "ssh-tools",
      name: "%remoteWorkspace.toolkitName%",
      loadMode: "eager",
      activator:
        "Use these tools when the user asks to operate on remote servers via SSH connections.",
      handler: (ctx: PluginContext) => {
        const attachments = ctx.session.getSettings?.()?.attachments || {};
        const sshConns = attachments["ssh-connection"] || [];
        return sshConns.length > 0
          ? { loadMode: "eager" as const }
          : { loadMode: "none" as const };
      },
      onLoad: (tk) => {
        // ssh_read
        tk.registerTool({
          name: "ssh_read",
          description:
            "Read a file from a remote SSH server. Supports line pagination. Line numbers are prepended.",
          inputSchema: z.object({
            connection: z
              .string()
              .describe(
                "Connection name, must match a bound connection name exactly (e.g. 'my-server')",
              ),
            file_path: z
              .string()
              .describe("Absolute path on the remote server"),
            offset: z
              .number()
              .int()
              .optional()
              .describe("Starting line number (default 0)"),
            limit: z
              .number()
              .int()
              .min(1)
              .optional()
              .describe("Max lines to read (default 200)"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            return agent.readFile(
              args.file_path,
              args.offset || 0,
              args.limit || 200,
            );
          },
          display: {
            argsKey: "file_path",
            icon: "read",
            text: {
              executing: "%ssh_read.executing%",
              completed: "%ssh_read.completed%",
            },
          },
          dangerLevel: "safe",
        });

        // ssh_write
        tk.registerTool({
          name: "ssh_write",
          description:
            "Write content to a file on a remote SSH server. Creates directories if needed.",
          inputSchema: z.object({
            connection: z
              .string()
              .describe(
                "Connection name (must match a bound connection exactly)",
              ),
            file_path: z
              .string()
              .describe("Absolute path on the remote server"),
            content: z.string().describe("File content to write"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            await agent.writeFile(args.file_path, args.content);
            return `File written: ${args.file_path} (${args.content.length} chars)`;
          },
          display: {
            argsKey: "file_path",
            icon: "edit",
            text: {
              executing: "%ssh_write.executing%",
              completed: "%ssh_write.completed%",
            },
          },
          dangerLevel: "high",
        });

        // ssh_edit
        tk.registerTool({
          name: "ssh_edit",
          description:
            "Find and replace text in a remote file. old_text must exactly match a contiguous segment.",
          inputSchema: z.object({
            connection: z
              .string()
              .describe(
                "Connection name (must match a bound connection exactly)",
              ),
            file_path: z
              .string()
              .describe("Absolute path on the remote server"),
            old_text: z.string().describe("Text to find (must match exactly)"),
            new_text: z.string().describe("Replacement text"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            const result = await agent.replaceInFile(
              args.file_path,
              args.old_text,
              args.new_text,
            );
            if (!result.matched)
              throw new Error(`No match found: ${args.old_text}`);
            return `File ${args.file_path} modified (${result.count} replacement)`;
          },
          display: {
            argsKey: "file_path",
            icon: "edit",
            text: {
              executing: "%ssh_edit.executing%",
              completed: "%ssh_edit.completed%",
            },
          },
          dangerLevel: "high",
        });

        // ssh_glob
        tk.registerTool({
          name: "ssh_glob",
          description:
            "Search for files on a remote server using glob patterns.",
          inputSchema: z.object({
            connection: z
              .string()
              .describe(
                "Connection name (must match a bound connection exactly)",
              ),
            pattern: z.string().describe("Glob pattern, e.g. **/*.go, *.json"),
            directory: z
              .string()
              .optional()
              .describe("Base directory (defaults to connection's base path)"),
            limit: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Max results (default 100)"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            return agent.glob(args.pattern, args.directory, args.limit || 100);
          },
          display: {
            argsKey: "pattern",
            icon: "search",
            text: {
              executing: "%ssh_glob.executing%",
              completed: "%ssh_glob.completed%",
            },
            aggregate: {
              executing: "%ssh_glob.aggregate.executing%",
              completed: "%ssh_glob.aggregate.completed%",
            },
          },
          dangerLevel: "safe",
        });

        // ssh_grep
        tk.registerTool({
          name: "ssh_grep",
          description:
            "Search file contents on a remote server. Case-insensitive when pattern is all lowercase.",
          inputSchema: z.object({
            connection: z
              .string()
              .describe(
                "Connection name (must match a bound connection exactly)",
              ),
            pattern: z.string().describe("Regex pattern"),
            path: z
              .string()
              .optional()
              .describe("File or directory path (defaults to base path)"),
            max_results: z
              .number()
              .int()
              .min(1)
              .max(50)
              .optional()
              .describe("Max matching lines (default 50)"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            return agent.grep(args.pattern, args.path, args.max_results || 50);
          },
          display: {
            argsKey: "pattern",
            icon: "search",
            text: {
              executing: "%ssh_grep.executing%",
              completed: "%ssh_grep.completed%",
            },
            aggregate: {
              executing: "%ssh_grep.aggregate.executing%",
              completed: "%ssh_grep.aggregate.completed%",
            },
          },
          dangerLevel: "safe",
        });

        // ssh_bash
        tk.registerTool({
          name: "ssh_bash",
          description:
            "Execute a shell command on a remote SSH server. Waits for completion (max 60s).",
          inputSchema: z.object({
            connection: z
              .string()
              .describe(
                "Connection name (must match a bound connection exactly)",
              ),
            command: z.string().describe("Shell command to execute"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            return agent.execute(args.command);
          },
          display: {
            argsKey: "command",
            icon: "terminal",
            text: {
              executing: "%ssh_bash.executing%",
              completed: "%ssh_bash.completed%",
            },
            aggregate: {
              executing: "%ssh_bash.aggregate.executing%",
              completed: "%ssh_bash.aggregate.completed%",
            },
          },
          dangerLevel: "critical",
        });

        // ssh_transfer
        tk.registerTool({
          name: "ssh_transfer",
          description: `Transfer files between local and remote SSH server.
- Upload: {"action":"upload","connection":"xxx","local_path":"...","remote_path":"..."}
- Download: {"action":"download","connection":"xxx","remote_path":"...","local_path":"..."}`,
          inputSchema: z.object({
            action: z.enum(["upload", "download"]),
            connection: z
              .string()
              .describe(
                "Connection name (must match a bound connection exactly)",
              ),
            local_path: z.string().describe("Local file path"),
            remote_path: z.string().describe("Remote file path"),
          }),
          execute: async (args: any, ctx: PluginContext) => {
            const attachments = ctx.session.getSettings?.()?.attachments || {};
            const agent = await this.manager.getAgent(
              args.connection,
              attachments,
            );
            if (args.action === "upload") {
              return agent.upload(args.local_path, args.remote_path);
            } else {
              return agent.download(args.remote_path, args.local_path);
            }
          },
          display: {
            argsKey: "action",
            icon: "edit",
            text: {
              executing: "%ssh_transfer.executing%",
              completed: "%ssh_transfer.completed%",
            },
            aggregate: {
              executing: "%ssh_transfer.aggregate.executing%",
              completed: "%ssh_transfer.aggregate.completed%",
            },
          },
          dangerLevel: "high",
        });
      },
    });
  }
}
