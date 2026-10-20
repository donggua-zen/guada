import { Injectable, Logger } from "@nestjs/common";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";
import { BridgeClient } from "../../bridge/bridge-client";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { AskService } from "../../../common/services/ask.service";
import { supportsMultimodal } from "../utils/vision-utils";
import { ComputerLeaseRegistry } from "./computer-use/lease";
import {
  ComputerPolicy,
  ComputerPolicyKey,
  normalizeComputerPolicy,
} from "./computer-use/policy";
import langZh from "./computer.lang.zh.json";
import langEn from "./computer.lang.en.json";

const COMPUTER_INPUT_ACTIONS = [
  "click_element",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "mouse_move",
  "type",
  "key",
  "scroll",
  "focus_window",
] as const;

@Injectable()
export class ComputerPlugin extends PluginBase {
  private readonly logger = new Logger(ComputerPlugin.name);
  private readonly leases = new ComputerLeaseRegistry();

  manifest = {
    id: "computer",
    name: "%computer.name%",
    description: "%computer.description%",
    version: "0.1.0",
    // Extended plugins ship disabled; desktop control stays opt-in until the
    // user enables it from the plugin list or the Computer Use settings page.
    category: "extended" as const,
  };

  constructor(
    private readonly bridgeClient: BridgeClient,
    private readonly settingsStorage: SettingsStorage,
    private readonly askService: AskService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    api.registerToolKit({
      id: "computer",
      name: "%computer.toolkitName%",
      description: "%computer.toolkitDescription%",
      loadMode: "lazy",
      activator:
        "Use this toolkit to observe and operate the local Windows desktop: screenshots, window lists, UI Automation element trees, clicks, typing, key presses, scrolling and window focus. Always observe first and pass the returned generation to the next input.",
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "computer_observe",
          description:
            "Observe the desktop without changing it. action='screenshot' captures the selected display and returns an image; action='cursor_position' reports the cursor; action='list_windows' lists visible top-level windows with ids; action='wait' sleeps up to 5 seconds. A screenshot or window list returns a generation that must be passed to computer_input.",
          inputSchema: z.object({
            action: z
              .enum(["screenshot", "cursor_position", "list_windows", "wait"])
              .describe("Observation to perform"),
            display: z
              .number()
              .int()
              .min(0)
              .optional()
              .describe("Display index for action='screenshot' (default: primary display)"),
            seconds: z
              .number()
              .min(0)
              .max(5)
              .optional()
              .describe("Seconds to wait for action='wait' (default 1, maximum 5)"),
          }),
          execute: async (args, ctx, signal) => {
            const sessionId = ctx?.session.sessionId ?? "";
            const params: Record<string, unknown> = { action: args.action };
            if (args.action === "screenshot") {
              params.output_path = screenshotPath(ctx);
              if (args.display !== undefined) params.display = args.display;
            } else if (args.action === "wait") {
              params.seconds = args.seconds ?? 1;
            }

            const result = await this.sendRequest("computer_observe", params, signal);

            if (args.action === "screenshot") {
              this.leases.record(sessionId, "screenshot", Number(result?.generation));
              return this.formatScreenshotResult(result, ctx);
            }
            if (args.action === "list_windows") {
              this.leases.record(sessionId, "window_list", Number(result?.generation));
              const windows = Array.isArray(result?.windows) ? result.windows : [];
              return [
                `Generation: ${result?.generation}. ${windows.length} window(s).`,
                String(result?.text ?? ""),
              ].join("\n");
            }
            if (args.action === "cursor_position") {
              if (result?.has_screenshot) {
                return `Cursor at (${result.image_x}, ${result.image_y}) in screenshot coordinates (screen: (${result.screen_x}, ${result.screen_y})).`;
              }
              return `Cursor at (${result?.screen_x}, ${result?.screen_y}) in screen coordinates (no screenshot taken yet).`;
            }
            return `Waited ${result?.waited_seconds ?? args.seconds ?? 1} second(s).`;
          },
          display: {
            text: {
              executing: "%computer_observe.executing%",
              completed: "%computer_observe.completed%",
            },
            aggregate: {
              executing: "%computer_observe.aggregate.executing%",
              completed: "%computer_observe.aggregate.completed%",
            },
            argsKey: "action",
            icon: "computer",
          },
          readOnly: true,
          allowedInPlanMode: true,
        });

        toolkit.registerTool({
          name: "computer_a11y_observe",
          description:
            "Read the Windows UI Automation tree for the foreground window (or a specific process id) and return numbered [ref] elements with roles, names, values, states and bounds. Refs are valid only until the next input; after any action, observe again. If an element action reports STALE_REFERENCE, observe again before retrying.",
          inputSchema: z.object({
            pid: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Observe this process instead of the foreground window"),
          }),
          execute: async (args, ctx, signal) => {
            const sessionId = ctx?.session.sessionId ?? "";
            const result = await this.sendRequest(
              "computer_a11y_observe",
              args.pid ? { pid: args.pid } : {},
              signal
            );
            this.leases.record(sessionId, "accessibility", Number(result?.generation));
            const note = result?.truncated
              ? " The tree was truncated to the node budget."
              : "";
            return [
              `Generation: ${result?.generation}. ${Array.isArray(result?.entries) ? result.entries.length : 0} element(s).${note} Refs are only valid until the next input.`,
              String(result?.text ?? ""),
            ].join("\n");
          },
          display: {
            text: {
              executing: "%computer_a11y_observe.executing%",
              completed: "%computer_a11y_observe.completed%",
            },
            aggregate: {
              executing: "%computer_a11y_observe.aggregate.executing%",
              completed: "%computer_a11y_observe.aggregate.completed%",
            },
            argsKey: "pid",
            icon: "computer",
          },
          readOnly: true,
          allowedInPlanMode: true,
        });

        toolkit.registerTool({
          name: "computer_input",
          description:
            "Operate the desktop. First call computer_a11y_observe or computer_observe and copy its generation into expected_generation. click_element uses a [ref] from the latest accessibility snapshot and may fall back to a validated pixel click. Pixel actions use x/y in the latest screenshot's coordinate space. type/key/scroll/focus_window use their own parameters. Any input invalidates the observation, so observe again before the next input.",
          inputSchema: z
            .object({
              action: z.enum([...COMPUTER_INPUT_ACTIONS]).describe("Input operation"),
              expected_generation: z
                .number()
                .int()
                .positive()
                .describe("Generation returned by the observation this input is based on"),
              ref: z.number().int().nonnegative().optional().describe("Element ref for click_element"),
              x: z.number().int().optional().describe("X coordinate in screenshot space"),
              y: z.number().int().optional().describe("Y coordinate in screenshot space"),
              text: z.string().max(65536).optional().describe("Text for action='type'"),
              key: z
                .string()
                .min(1)
                .max(256)
                .optional()
                .describe("Key combo for action='key', e.g. ctrl+shift+t"),
              direction: z
                .enum(["up", "down", "left", "right"])
                .optional()
                .describe("Scroll direction for action='scroll'"),
              amount: z
                .number()
                .int()
                .min(1)
                .max(100)
                .optional()
                .describe("Scroll amount (default 3)"),
              window_id: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe("Window id for action='focus_window' from computer_observe list_windows"),
            })
            .superRefine((args, ctx) => {
              if (args.action === "click_element" && args.ref === undefined) {
                ctx.addIssue({ code: "custom", path: ["ref"], message: "ref is required for click_element" });
              }
              if (
                ["left_click", "right_click", "middle_click", "double_click", "triple_click", "mouse_move"].includes(
                  args.action
                ) &&
                (args.x === undefined || args.y === undefined)
              ) {
                ctx.addIssue({
                  code: "custom",
                  path: ["x"],
                  message: "x and y are required for pixel actions",
                });
              }
              if (args.action === "type" && args.text === undefined) {
                ctx.addIssue({ code: "custom", path: ["text"], message: "text is required for type" });
              }
              if (args.action === "key" && args.key === undefined) {
                ctx.addIssue({ code: "custom", path: ["key"], message: "key is required for key" });
              }
              if (args.action === "scroll" && args.direction === undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: ["direction"],
                  message: "direction is required for scroll",
                });
              }
              if (args.action === "focus_window" && args.window_id === undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: ["window_id"],
                  message: "window_id is required for focus_window",
                });
              }
              if ((args.x === undefined) !== (args.y === undefined)) {
                ctx.addIssue({
                  code: "custom",
                  path: ["x"],
                  message: "x and y must be provided together",
                });
              }
            }),
          execute: async (args, ctx, signal) => {
            const policy = await this.loadPolicy();
            const sessionId = ctx?.session.sessionId ?? "";
            const action = args.action as ComputerPolicyKey;
            const decision = policy[action] ?? "ask";

            if (decision === "deny") {
              throw new Error(`Computer Use policy denies the "${args.action}" action.`);
            }
            if (decision === "ask") {
              if (!ctx || !ctx.session.hasAnswerSurface()) {
                throw new Error(
                  "Computer Use requires user confirmation, but this session has no answer surface."
                );
              }
              try {
                await this.askService.requestComputerUseApproval(ctx.session, {
                  toolCallId: ctx?.toolCallId,
                  toolName: "computer_input",
                  detail: describeAction(args),
                  abortSignal: signal,
                });
              } catch (error) {
                // A denied or cancelled approval may be followed by user input.
                // Force a fresh observation before the next attempt.
                this.leases.clear(sessionId);
                throw error;
              }
            }

            const hasPoint = args.x !== undefined && args.y !== undefined;
            this.leases.require(sessionId, action, args.expected_generation, hasPoint);

            try {
              const result = await this.sendRequest(
                "computer_input",
                { ...args },
                signal
              );
              return `${result?.message ?? "Input completed."}\nThe previous observation is now invalid; observe again before the next input.`;
            } finally {
              this.leases.clear(sessionId);
            }
          },
          display: {
            text: {
              executing: "%computer_input.executing%",
              completed: "%computer_input.completed%",
            },
            aggregate: {
              executing: "%computer_input.aggregate.executing%",
              completed: "%computer_input.aggregate.completed%",
            },
            argsKey: "action",
            icon: "computer",
          },
          requiresUserInteraction: true,
          dangerLevel: "critical",
        });

        toolkit.registerPrompt({
          frequency: "REGULAR",
          description: "Computer Use 使用说明",
          content: [
            "# Computer Use Workflow",
            "",
            "Tool names are exact: `computer_observe`, `computer_a11y_observe`, `computer_input` (underscores). `observe`, `computer.observe`, and `list_windows` are not tools; `list_windows` is an `action` value of `computer_observe`.",
            "",
            "1. Observe first: `computer_a11y_observe` for element refs, or `computer_observe` with `action=screenshot` for pixels and window lists.",
            "2. Use the returned `generation` as `expected_generation` on the next `computer_input` call.",
            "3. `click_element` uses a `[ref]` from the latest accessibility snapshot. Pixel actions use `x`/`y` in the latest screenshot's coordinate space.",
            "4. Any input invalidates the observation. Observe again before the next input.",
            "5. If an action reports `STALE_REFERENCE`, observe again; never reuse an old ref or coordinate.",
            "6. Input actions may be approved by the user. If the user denies an action, do not retry it unchanged.",
          ].join("\n"),
        });
      },
    });
  }

  private async sendRequest(
    method: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal
  ): Promise<any> {
    try {
      return await this.bridgeClient.request(method, params, abortSignal);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (message.includes(`Unknown method: ${method}`)) {
        throw new Error(
          `The desktop bridge rejected "${method}". The Electron main process is probably running an older build; rebuild electron (pnpm run build:electron-ts) and restart the desktop app.`
        );
      }
      throw error;
    }
  }

  /**
   * The runtime gates are the plugin master switch and the agent toolkit
   * switch. The computerUse settings group stores the action policy and the
   * UI's switch state, but it must not become a second hard gate: enabling the
   * plugin globally and the toolkit per agent is already an explicit opt-in.
   */
  private async loadPolicy(): Promise<ComputerPolicy> {
    const group = await this.settingsStorage.getSettings("computerUse");
    return normalizeComputerPolicy(group?.actions);
  }

  private formatScreenshotResult(result: any, ctx?: PluginContext) {
    const parts: string[] = [];
    if (result?.image_path) {
      parts.push(`Screenshot saved: ${result.image_path}`);
    }
    parts.push(`Dimensions: ${result?.width}x${result?.height}`);
    parts.push(`Generation: ${result?.generation}`);

    if (supportsMultimodal(ctx) && result?.image_path) {
      parts.push(
        "The screenshot will be injected as a subsequent user message for your visual analysis."
      );
      return {
        content: parts.join("\n"),
        imageRefs: [
          {
            url: result.image_path,
            refType: "local" as const,
            media_type: "image/png",
            name: path.basename(result.image_path),
          },
        ],
      };
    }
    return parts.join("\n");
  }
}

function screenshotPath(ctx?: PluginContext): string {
  const workspace = ctx?.session.workspacePath;
  const base = workspace || path.join(os.tmpdir(), "guada-computer");
  return path.join(base, "computer-screenshots", `computer-${Date.now()}.png`);
}

function describeAction(args: {
  action: string;
  ref?: number;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  direction?: string;
  amount?: number;
  window_id?: number;
}): string {
  switch (args.action) {
    case "click_element":
      return `Click element [${args.ref}]`;
    case "left_click":
      return `Left-click at screenshot coordinates (${args.x}, ${args.y})`;
    case "right_click":
      return `Right-click at screenshot coordinates (${args.x}, ${args.y})`;
    case "middle_click":
      return `Middle-click at screenshot coordinates (${args.x}, ${args.y})`;
    case "double_click":
      return `Double-click at screenshot coordinates (${args.x}, ${args.y})`;
    case "triple_click":
      return `Triple-click at screenshot coordinates (${args.x}, ${args.y})`;
    case "mouse_move":
      return `Move the cursor to screenshot coordinates (${args.x}, ${args.y})`;
    case "type": {
      const text = args.text ?? "";
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      return `Type ${text.length} character(s): ${preview}`;
    }
    case "key":
      return `Press key combo ${args.key}`;
    case "scroll":
      return `Scroll ${args.direction} by ${args.amount ?? 3}`;
    case "focus_window":
      return `Focus window ${args.window_id}`;
    default:
      return args.action;
  }
}
