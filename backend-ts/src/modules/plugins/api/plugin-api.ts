import {
  PluginContext,
  ToolHandlerDef,
  ToolKitDef,
  ToolKitHandle,
  AttachmentTypeRegistration,
  UiPageRegistration,
  SlotRegistration,
  ThemeRegistration,
  RpcHandler,
  SkinRegistration,
  PromptSectionDef,
  PromptTransformDef,
  LocalCommandDef,
  PluginHookDef,
  PluginJobDef,
  PluginHttpRouteDef,
  PluginLlmCompleteOptions,
  PluginLlmResult,
  PluginLlmStreamChunk,
  PluginLlmModelInfo,
  PluginAgentDef,
  PluginSkillDef,
  VisibleToAgent,
  PLUGIN_API_VERSION,
} from "../types/plugin.types";
import { PluginRegistry } from "../registry/plugin-registry";
import { PluginAgentRegistry } from "../registry/plugin-agent.registry";
import { Toolkit } from "../toolkit/toolkit";
import { SkillRegistry } from "../../skills/core/skill-registry.service";
import { createHash } from "crypto";
import { z } from "zod";
import { ICommandProvider } from "../../commands/interfaces/command-provider.interface";
import type { WorkspaceProviderFactory } from "../../../common/workspace/workspace-provider.interface";
import type { ToolDisplay } from "../types/plugin.types";
import { NlsService } from "../i18n/nls.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import type { TurnReminderProvider } from "../turn-reminders/turn-reminder.types";
import type { TurnReminderRegistry } from "../turn-reminders/turn-reminder.registry";
import type { ProviderTypeCard } from "../../llm-core/bundled-catalog.service";
import type {
  IProtocolAdapter,
  ProtocolCapabilities,
} from "../../llm-core/adapters/base.adapter";
import type { ProtocolAdapterContribution } from "../../llm-core/types/provider-plugin.types";

// ── PluginApi ──

export interface ImageContent {
  media_type: string;
  data: string; // base64, no data: prefix
}

/**
 * 工具返回的图片**引用**形态：字节已在磁盘上的生产者（image_view、browser_screenshot 等）
 * 直接回传引用，避免「读盘 → base64 → 解码 → 再落盘」的字符串往返。
 * url/refType 语义对齐 FileRef（conversation.types）：'local' = 本机绝对路径；
 * 'session' = 会话数据目录内的自包含引用。引擎负责物化/转正后注入。
 * base64 的 images 形态保留给字节只存在于内存/线上的来源（MCP、第三方插件）。
 */
export interface ImageRefContent {
  url: string;
  refType: "local" | "session";
  media_type?: string;
  bytes?: number;
  name?: string;
  /** 会话副本的前端缩略图引用（refType='session' 时可选；零复制转正时原样保留） */
  previewUrl?: string;
}

export interface ToolResultObject {
  content: string;
  images?: ImageContent[];
  /** 磁盘图片引用（优先于 images）：引擎物化进会话 images 目录，持久化只落路径指针 */
  imageRefs?: ImageRefContent[];
  /**
   * UI 渲染元数据（仅前端消费，不进 LLM 上下文）。
   * card 标识结果卡片类型（terminal/diff/read/...），其余为该卡片的结构化字段。
   */
  meta?: Record<string, any>;
  /**
   * 工具转交的用户输入正文（见 ToolCallResponse.followUpUserInput）。
   * 非空 ⇒ 引擎终止当前轮，文字作为真实用户消息开启新轮次；计划审批反馈是唯一生产者。
   */
  followUpUserInput?: string;
  /**
   * 本结果表达"执行未成功"（进 isError 通道、outcome=error）。
   * 供需要**返回结构化错误**（同时携带 followUpUserInput 等附加字段）的处理器使用；
   * 只需错误文本时直接 throw 更简单。
   */
  isError?: boolean;
}

export type ToolResult = string | ToolResultObject | Record<string, any>;

export interface ToolExecCtx extends PluginContext {}

export interface PluginApi {
  /**
   * 注册工具（Zod 方式）：inputSchema 自动推导 execute 第一个参数类型 + 运行时校验
   */
  registerTool<Z extends z.ZodTypeAny>(def: {
    name: string;
    description: string;
    inputSchema: Z;
    toolSet?: string;
    execute: (
      args: z.output<Z>,
      ctx?: ToolExecCtx,
      signal?: AbortSignal,
    ) => ToolResult | Promise<ToolResult>;
      display?: ToolDisplay;
      dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
      /** 只读执行能力（计划模式权限门依据）；缺省 false */
      readOnly?: boolean;
      /** 计划模式逃生舱；缺省 false */
      allowedInPlanMode?: boolean;
      /** 本工具会阻塞等待人类应答（审批/提问）；子会话放行会卡死父回合 */
      requiresUserInteraction?: boolean;
      /** 豁免通用大结果裁剪：本工具自行管理返回长度（自带上限与续读提示）；缺省 false */
      exemptFromLargeResult?: boolean;
      /** 作用域声明（v4）：仅对哪些智能体可用；省略 = 全局可用 */
      visibleTo?: VisibleToAgent;
    }): void;

    /**
     * 注册工具（旧版 JSOM Schema 方式，仅 MCP 等动态工具使用）
     * @deprecated 使用 inputSchema 替代
     */
    registerTool(def: {
      name: string;
      description: string;
      parameters?: Record<string, any>;
      toolSet?: string;
      execute: (
        args: any,
        ctx?: ToolExecCtx,
        signal?: AbortSignal,
      ) => ToolResult | Promise<ToolResult>;
      display?: ToolDisplay;
    dangerLevel?: "safe" | "info" | "normal" | "high" | "critical";
    /** 只读执行能力（计划模式权限门依据）；缺省 false */
    readOnly?: boolean;
    /** 计划模式逃生舱；缺省 false */
    allowedInPlanMode?: boolean;
    /** 本工具会阻塞等待人类应答（审批/提问）；子会话放行会卡死父回合 */
    requiresUserInteraction?: boolean;
    /** 豁免通用大结果裁剪：本工具自行管理返回长度（自带上限与续读提示）；缺省 false */
    exemptFromLargeResult?: boolean;
    /** 作用域声明（v4）：仅对哪些智能体可用；省略 = 全局可用 */
    visibleTo?: VisibleToAgent;
  }): void;

  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    toolSet?: string;
    description?: string;
    /** 作用域声明（v4）：仅对哪些智能体注入本段；省略 = 全局 */
    visibleTo?: import("../types/plugin.types").VisibleToAgent;
  }): void;

  registerRawTool(def: ToolHandlerDef): void;

  // ── 插件专属智能体（v4） ──

  /**
   * 注册一个插件专属智能体（虚拟、不落盘，生命周期跟随插件）。
   *
   * 宿主把 id 归一化为 `plugin-<pluginId>-<id>`；能力默认收口为白名单
   * （本插件的工具包与技能），其他智能体不受影响。配合能力侧
   * `visibleTo: ["self"]` 声明可实现「专属智能体 + 专属能力」的隔离。
   * 用户不可编辑/删除本智能体（HTTP 层 400）。
   */
  registerAgent(def: PluginAgentDef): void;

  // ── 提示词段（v2） ──

  /**
   * 注册命名提示词段。
   *
   * 与 registerPrompt 的区别：稳定 name + 数值 order + 作用域，
   * 同名同作用域冲突在注册期报错（不再静默拼接）。
   */
  registerPromptSection(def: PromptSectionDef): void;

  /**
   * 注册装配后整体变换（waterfall，按 order 串行）。
   * 默认禁止删除 `builtin.*` 段；需要 manifest 声明 permissions: ["prompt"]
   * 且由插件自行提供用户开关。
   */
  registerPromptTransform(def: PromptTransformDef): void;

  // ── 动作型本地命令（v2） ──

  /**
   * 注册动作型斜杠命令（如 `/purge apply`）。
   * 命中后由后端直接执行 handler，不写用户消息、不建流、不进 LLM 上下文。
   */
  registerLocalCommand(def: LocalCommandDef): void;

  // ── Hook（v2） ──

  /**
   * 注册生命周期钩子（白名单见 PluginHookName）。
   * 包装器会检查插件启用态；异常 fail-open（仅记日志）。
   */
  registerHook(def: PluginHookDef): void;

  // ── 路径（v2） ──

  /** 插件安装目录（只读；自带 skills/presets/assets） */
  getPluginDir(): string | undefined;
  /** 插件数据目录（可写；提示词/规则/快照） */
  getDataDir(): string;

  /** 宿主支持的 PluginApi 版本 */
  getApiVersion(): number;

  // ── 后台作业（v2.1） ──

  /**
   * 登记一个后台作业并返回 jobId。
   *
   * 作业按 shell 语义登记（字节日志 + 默认完成通知），因此模型可用
   * 现成的 job_read / job_list / job_stop 读取与取消。
   *
   * @throws 没有会话上下文（sessionId）时抛错
   */
  startJob(def: PluginJobDef, sessionId?: string): string;

  // ── HTTP 路由（v3） ──

  /**
   * 注册自定义 HTTP 路由。
   *
   * 对外 URL：`/api/v1/plugins/<pluginId>/http/<path>`
   * handler 拿到原生 req/res，可以写流（SSE / 大文件 pipe）。
   */
  registerRoute(def: PluginHttpRouteDef): void;

  // ── 模型调用（v3） ──

  /** 非流式补全，复用宿主已配置的模型 */
  complete(options: PluginLlmCompleteOptions): Promise<PluginLlmResult>;
  /** 流式补全，chunk 已归一化为 text / reasoning / finish */
  completeStream(options: PluginLlmCompleteOptions): AsyncGenerator<PluginLlmStreamChunk, void, unknown>;
  /** 宿主已配置的模型清单 */
  listModels(): Promise<PluginLlmModelInfo[]>;


  /**
   * 注册工具包（ToolKit）
   *
   * 支持两种用法：
   * 1. 回调方式：registerToolKit({ onLoad: (toolkit) => { toolkit.registerTool({...}) } })
   * 2. 返回值方式：const tk = registerToolKit({}); tk.registerTool({...})
   */
  registerToolKit(def: ToolKitDef): ToolKitHandle;

  /**
   * 注册命令提供者（斜杠命令 / 艾特命令）
   * 插件通过此接口注册后，前端即可通过 / 或 @ 触发该命令的补全列表。
   */
  registerCommandProvider(def: ICommandProvider): void;

  /**
   * 注册每轮提醒 provider。
   *
   * 引擎在每次 LLM 迭代前向 registry 收集提醒；provider 返回的 `persist` 会写入
   * 会话历史（可审计），`transient` 只追加到本次请求。插件启用态由引擎过滤。
   */
  registerTurnReminderProvider(provider: TurnReminderProvider): void;

  /**
   * 注册 WorkspaceProvider 工厂（旧接口，保留兼容）
   */
  registerWorkspaceProvider(factory: WorkspaceProviderFactory): void;

  /**
   * 注册连接类型（附加连接方案）
   *
   * 插件声明支持的连接类型（如 ssh、docker），前端设置页据此渲染表单。
   * configSchema 定义连接配置表单字段。
   */
  registerConnectionType(factory: WorkspaceProviderFactory): void;

  /**
   * 注册附件类型
   *
   * 插件声明一种可绑定到会话的附件类型（如 SSH 连接、知识库等）。
   * 前端 AttachmentPopover 据此动态渲染选择列表。
   * describe() 返回的文本会注入到 AI prompt 中。
   */
  registerAttachmentType(reg: import("../types/plugin.types").AttachmentTypeRegistration): void;

  /**
   * 注册 UI 页面
   *
   * 插件声明一个自定义页面，渲染到指定区域（如设置页）。
   * 前端通过 PluginSlot 加载插件 frontend/ 目录下的组件。
   */
  registerUiPage(reg: import("../types/plugin.types").UiPageRegistration): void;

  /**
   * 注册前端 slot（插件 UI 能力声明）
   */
  registerSlot(reg: import("../types/plugin.types").SlotRegistration): void;

  /**
   * 注册主题（插件主题能力声明）
   *
   * CSS 文件放插件 frontend/dist/ 下，通过 assets 端点静态服务；
   * 前端下拉列表与启动应用均以本声明为准。
   */
  registerTheme(reg: import("../types/plugin.types").ThemeRegistration): void;

  /**
   * 注册皮肤（v2.2）
   *
   * 皮肤 = 多份 CSS（亮/暗）+ 可选运行时脚本 + 资源目录 + 设置项。
   * 与主题互斥：同一时间只启用一个皮肤；切换时前端会卸载前一个并还原 DOM。
   */
  registerSkin(reg: SkinRegistration): void;

  // ── 供应商包（Provider Pack）──

  /**
   * 注册供应商类型卡（声明式贡献）
   *
   * 类型卡进入 app 级供应商目录，与 bundled-providers/*.yaml 合并展示；
   * 内置 type 是保留位，冲突会导致整个包安装失败。
   */
  registerProviderType(card: ProviderTypeCard): void;

  /**
   * 注册 wire 协议适配器（代码贡献）
   *
   * 适配器进入 app 级协议注册表；内置协议是保留位，插件不得覆盖
   * （防止恶意包劫持 openai/anthropic 等协议把密钥发往其他地址）。
   */
  registerProtocolAdapter(def: {
    protocol: string;
    adapter: IProtocolAdapter;
    displayName?: string;
    capabilities?: ProtocolCapabilities;
  }): void;

  /**
   * 注册技能（第三方插件注册技能，内嵌正文，无需文件/复制）
   */
  registerSkill(input: PluginSkillDef): void;

  /**
   * 注册 RPC 方法（插件 UI 通过 pluginApi.call 调用）
   */
  registerRpc(methods: Record<string, import("../types/plugin.types").RpcHandler>): void;

  /**
   * 注册语言包（NLS）
   *
   * 每个插件注册自己的 key→string 字典，插件间隔离。
   * display 字段中的 "%key%" 引用会在返回前端前就地解析。
   *
   * @param locale 语言代码（如 "zh"、"en"）
   * @param messages 扁平 key→string 字典
   */
  registerNls(locale: string, messages: Record<string, string>): void;

  // ── PluginDataApi: 插件数据自治 ──

  /** 读取插件所有数据 */
  getData(): Promise<Record<string, any>>;
  /** 读取单个 key */
  getValue<T>(key: string, defaultValue?: T): Promise<T>;
  /** 写入单个 key */
  setValue(key: string, value: any): Promise<void>;
  /** 删除单个 key */
  deleteValue(key: string): Promise<void>;
}

// ── PluginApi 实现 ──

export class PluginApiImpl implements PluginApi {
  private _toolDefs: ToolHandlerDef[] = [];
  private _toolKits: Toolkit[] = [];
  /**
   * v3：`registerPrompt` 已收敛为 `registerPromptSection` 的语法糖，
   * 不再单独存一份；这里只保留注册序号用于稳定命名。
   */
  private _promptSeq = 0;
  private _commandProviders: ICommandProvider[] = [];
  private _workspaceProviders: WorkspaceProviderFactory[] = [];
  /** v2：命名提示词段 / 装配变换 */
  private _promptSections: PromptSectionDef[] = [];
  private _promptTransforms: PromptTransformDef[] = [];
  /** v2：动作型本地命令 */
  private _localCommands: LocalCommandDef[] = [];
  /** v2：生命周期 Hook */
  private _hooks: PluginHookDef[] = [];
  /** v2.1：startJob 使用的会话 id（由 PluginManager/工具上下文注入） */
  private jobSessionId?: string;

  constructor(
    private pluginId: string,
    private pluginName: string,
    private nlsService?: NlsService,
    private settingsStorage?: SettingsStorage,
    /** 插件来源；非 builtin 的外部插件不得自封 governance（见 registerToolKit） */
    private pluginSource?: "builtin" | "dev" | "user",
    /** 每轮提醒注册表；插件在 onLoad 中注册 provider 后立即生效 */
    private turnReminderRegistry?: TurnReminderRegistry,
    /** v2：插件目录与数据目录（由 PluginManager 注入） */
    private pluginPaths?: { pluginDir?: string; dataDir?: string },
    /** v2：动作命令注册表（flush 时提交，结构类型避免模块环） */
    private localCommandRegistry?: {
      register: (
        name: string,
        handler: (ctx: any) => any,
        meta?: { description?: string; pluginId?: string; aliases?: string[] },
      ) => void;
      unregisterByPlugin?: (pluginId: string) => void;
    },
    /** v2：Hook 注册表（flush 时提交，结构类型避免模块环） */
    private hookRegistry?: {
      register: (pluginId: string, def: PluginHookDef) => void;
    },
    /** v2.1：后台作业注册表（结构类型避免模块环） */
    private jobRegistry?: {
      start: (spec: {
        kind: "shell";
        label: string;
        sessionId: string;
        logFilePath?: string;
        notify?: boolean;
        read: (opts: { offset?: number; maxBytes?: number }) => Promise<any>;
        cancel: (reason?: string) => void | Promise<void>;
        send?: (input: string) => Promise<void>;
        done: Promise<any>;
      }) => string;
    },
    /** v3：插件 HTTP 路由注册表（结构类型避免模块环） */
    private httpRegistry?: {
      register: (pluginId: string, def: PluginHttpRouteDef) => void;
    },
    /** v3：插件 LLM 能力 */
    private llmService?: {
      complete: (pluginId: string, options: PluginLlmCompleteOptions) => Promise<PluginLlmResult>;
      completeStream: (
        pluginId: string,
        options: PluginLlmCompleteOptions,
      ) => AsyncGenerator<PluginLlmStreamChunk, void, unknown>;
      listModels: () => Promise<PluginLlmModelInfo[]>;
    },
  ) {}

  registerTool(def: any): void {
    if (def.inputSchema) {
      // Zod 方式：从 Zod schema 生成 JSON Schema（Zod v4 原生 z.toJSONSchema）
      const zodSchema = def.inputSchema as any;
      const rawJson = z.toJSONSchema(zodSchema) as any;

      // 提取 required、properties（兼容不同输出格式）
      const root =
        rawJson.type === "object"
          ? rawJson
          : rawJson.$defs?.[Object.keys(rawJson.$defs || {})[0]] || rawJson;
      const required: string[] = root.required || [];
      const properties: Record<string, any> = {};
      const rawProps = root.properties || {};
      for (const [key, val] of Object.entries(rawProps)) {
        const p = val as any;
        const clean: Record<string, any> = {
          type: p.type || "string",
          description: p.description || key,
        };
        if (p.enum) clean.enum = p.enum;
        if (p.default !== undefined) clean.default = p.default;
        properties[key] = clean;
      }

      const argsKey =
        def.display?.argsKey ??
        Object.keys(properties).find((k) => properties[k]?.type === "string");

      const entry: ToolHandlerDef = {
        name: def.name,
        description: def.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
        _zodSchema: zodSchema,
        handler: async (args, ctx, signal) => {
          const parsed = zodSchema.parse(args);
          return def.execute(parsed, ctx, signal);
        },
        dangerLevel: def.dangerLevel,
        toolSet: def.toolSet,
        readOnly: def.readOnly,
        allowedInPlanMode: def.allowedInPlanMode,
        requiresUserInteraction: def.requiresUserInteraction,
        exemptFromLargeResult: def.exemptFromLargeResult,
        icon: def.display?.icon,
        actionType: def.display?.actionType,
        argsKey,
        argsCountUnit: def.display?.argsCountUnit,
        displayText: def.display?.text,
        displayAggregate: def.display?.aggregate,
        displayRenderer: def.display?.renderer,
        visibleTo: def.visibleTo,
      };

      if (!this._toolDefs.find((x) => x.name === entry.name)) {
        this._toolDefs.push(entry);
      }
      return;
    }

    // 旧方式：parameters 手写 JSON Schema 或从 execute toString 推断
    const schema = def.parameters
      ? {
          type: "object" as const,
          properties: def.parameters,
          required:
            Object.entries(def.parameters)
              .filter(([_, v]) => (v as any).required !== false)
              .map(([k]) => k)
              .filter((k) => k.length > 0) || undefined,
        }
      : {
          type: "object" as const,
          properties: {} as Record<string, any>,
        };

    const argsKey =
      def.display?.argsKey ||
      (() => {
        const fnStr = def.execute.toString();
        const match = fnStr.match(/async\s*\(\s*\{\s*(\w+)/);
        return match?.[1];
      })();

    const entry: ToolHandlerDef = {
      name: def.name,
      description: def.description,
      parameters: schema,
      handler: (args: any, ctx?: PluginContext, signal?: AbortSignal) => {
        return def.execute(args, ctx, signal);
      },
      dangerLevel: def.dangerLevel,
      toolSet: def.toolSet,
      readOnly: def.readOnly,
      allowedInPlanMode: def.allowedInPlanMode,
      requiresUserInteraction: def.requiresUserInteraction,
      icon: def.display?.icon,
      actionType: def.display?.actionType,
      argsKey,
      argsCountUnit: def.display?.argsCountUnit,
      displayText: def.display?.text,
      displayAggregate: def.display?.aggregate,
      displayRenderer: def.display?.renderer,
      visibleTo: def.visibleTo,
    };

    if (!this._toolDefs.find((x) => x.name === entry.name)) {
      this._toolDefs.push(entry);
    }
  }

  /**
   * 注册插件级提示词。
   *
   * v3 起是 `registerPromptSection` 的**语法糖**：内容 + 频率 → 命名段。
   * 顺序映射（保持历史"追加在末尾"语义，排在所有显式 section 之后）：
   *   STATIC 5000 / REGULAR 6000 / VOLATILE 7000（+ 注册序号）
   * 同频内按注册顺序；跨插件按段名（含 pluginId）稳定排序。
   *
   * 需要 order / scope / 覆盖能力时，直接使用 `registerPromptSection`。
   */
  registerPrompt(def: {
    content: string | ((ctx: PluginContext) => string | Promise<string>);
    frequency?: "STATIC" | "REGULAR" | "VOLATILE";
    /** @deprecated 插件级 registerPrompt 上不消费；工具包作用域请用 toolkit.registerPrompt */
    toolSet?: string;
    description?: string;
    /** 作用域声明（v4）：仅对哪些智能体注入本段；省略 = 全局 */
    visibleTo?: import("../types/plugin.types").VisibleToAgent;
  }): void {
    const index = this._promptSeq++;
    const base =
      def.frequency === "STATIC" ? 5000 : def.frequency === "VOLATILE" ? 7000 : 6000;
    this.registerPromptSection({
      name: `${this.pluginId}.prompt.${index}`,
      order: base + index,
      scope: "global",
      text: def.content,
      description: def.description,
      ...(def.visibleTo ? { visibleTo: def.visibleTo } : {}),
    });
  }

  registerRawTool(def: ToolHandlerDef): void {
    if (!this._toolDefs.find((x) => x.name === def.name)) {
      this._toolDefs.push(def);
    }
  }

  registerToolKit(def: ToolKitDef): ToolKitHandle {
    // 自治理会使其工具包逃逸智能体层治理，因此只允许内建插件声明。
    // 外部插件（dev/user）的 manifest 由插件自己提供，不能据此自封。
    const safeDef: ToolKitDef =
      this.pluginSource && this.pluginSource !== "builtin"
        ? { ...def, governance: undefined }
        : def;
    const toolkit = new Toolkit(safeDef, this.pluginId);
    if (!this._toolKits.find((x) => x.id === toolkit.id)) {
      this._toolKits.push(toolkit);
    }
    return toolkit;
  }

  registerCommandProvider(def: ICommandProvider): void {
    if (!this._commandProviders.find((x) => x.id === def.id)) {
      this._commandProviders.push(def);
    }
  }

  // ── v2：提示词段 / 变换 / 动作命令 / Hook / 路径 ──

  registerAgent(def: PluginAgentDef): void {
    if (!def || typeof def !== "object") {
      throw new Error(`plugin ${this.pluginId}: registerAgent requires a def`);
    }
    if (!def.id || typeof def.id !== "string") {
      throw new Error(`plugin ${this.pluginId}: registerAgent requires an id`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(def.id)) {
      throw new Error(
        `plugin ${this.pluginId}: agent id "${def.id}" must match ^[a-z0-9][a-z0-9-]*$`,
      );
    }
    if (!def.name || typeof def.name !== "string") {
      throw new Error(
        `plugin ${this.pluginId}: registerAgent("${def.id}") requires a name`,
      );
    }
    if (
      def.systemPrompt !== undefined &&
      typeof def.systemPrompt !== "string"
    ) {
      throw new Error(
        `plugin ${this.pluginId}: registerAgent("${def.id}") systemPrompt must be a string`,
      );
    }
    if (this._agentDefs.find((x) => x.id === def.id)) {
      throw new Error(
        `plugin ${this.pluginId}: agent "${def.id}" already registered`,
      );
    }
    this._agentDefs.push({ ...def });
  }

  registerPromptSection(def: PromptSectionDef): void {
    if (!def?.name || typeof def.name !== "string") {
      throw new Error(`plugin ${this.pluginId}: registerPromptSection requires a name`);
    }
    if (def.name.startsWith("builtin.")) {
      throw new Error(`plugin ${this.pluginId}: prompt section name "${def.name}" uses reserved prefix "builtin."`);
    }
    const scope = def.scope || "global";
    const dup = this._promptSections.find(
      (x) => x.name === def.name && (x.scope || "global") === scope,
    );
    if (dup) {
      throw new Error(
        `plugin ${this.pluginId}: prompt section "${def.name}" already registered in scope "${scope}"`,
      );
    }
    this._promptSections.push({ ...def, scope });
  }

  registerPromptTransform(def: PromptTransformDef): void {
    if (!def?.id || typeof def.transform !== "function") {
      throw new Error(`plugin ${this.pluginId}: registerPromptTransform requires id and transform`);
    }
    if (this._promptTransforms.find((x) => x.id === def.id)) {
      throw new Error(`plugin ${this.pluginId}: prompt transform "${def.id}" already registered`);
    }
    this._promptTransforms.push(def);
  }

  registerLocalCommand(def: LocalCommandDef): void {
    if (!def?.name || !/^[a-z][a-z0-9-]*$/.test(def.name)) {
      throw new Error(
        `plugin ${this.pluginId}: local command name must match ^[a-z][a-z0-9-]*$, got "${def?.name}"`,
      );
    }
    if (typeof def.handler !== "function") {
      throw new Error(`plugin ${this.pluginId}: local command "${def.name}" requires a handler`);
    }
    for (const name of [def.name, ...(def.aliases || [])]) {
      if (this._localCommands.find((x) => x.name === name || (x.aliases || []).includes(name))) {
        throw new Error(`plugin ${this.pluginId}: local command "${name}" already registered`);
      }
    }
    this._localCommands.push(def);
  }

  registerHook(def: PluginHookDef): void {
    const allowed = new Set<string>([
      "agent.pre_step",
      "agent.request_error",
      "turn.stopping",
      "session.created",
    ]);
    if (!def?.event || !allowed.has(def.event)) {
      throw new Error(`plugin ${this.pluginId}: hook event "${def?.event}" is not open to plugins`);
    }
    if (typeof def.handler !== "function") {
      throw new Error(`plugin ${this.pluginId}: hook "${def.event}" requires a handler`);
    }
    this._hooks.push(def);
  }

  getPluginDir(): string | undefined {
    return this.pluginPaths?.pluginDir;
  }

  getDataDir(): string {
    const dir = this.pluginPaths?.dataDir;
    if (!dir) {
      throw new Error(`plugin ${this.pluginId}: data dir is not configured`);
    }
    return dir;
  }

  getApiVersion(): number {
    return PLUGIN_API_VERSION;
  }

  /**
   * 登记后台作业（v2.1）。
   *
   * 复用 JobRegistry 的 shell 语义：字节日志 + 默认完成通知，
   * 模型可用现成的 job_read / job_list / job_stop。
   */
  startJob(def: PluginJobDef, sessionId?: string): string {
    if (!this.jobRegistry) {
      throw new Error(
        `plugin ${this.pluginId}: background jobs are not available in this host build`,
      );
    }
    if (!def || typeof def.read !== "function" || typeof def.cancel !== "function") {
      throw new Error(
        `plugin ${this.pluginId}: startJob requires read and cancel functions`,
      );
    }
    if (!def.done || typeof (def.done as any).then !== "function") {
      throw new Error(`plugin ${this.pluginId}: startJob requires a done promise`);
    }
    const effectiveSession = sessionId || this.jobSessionId;
    if (!effectiveSession) {
      throw new Error(
        `plugin ${this.pluginId}: startJob requires a session context (sessionId)`,
      );
    }
    return this.jobRegistry.start({
      kind: "shell",
      label: def.label || `plugin:${this.pluginId}`,
      sessionId: effectiveSession,
      logFilePath: def.logFilePath,
      notify: def.notify,
      read: def.read,
      cancel: def.cancel,
      send: def.send,
      done: def.done as any,
    });
  }

  /** 由 PluginManager 在工具执行前注入当前会话 id（startJob 需要） */
  setJobSession(sessionId: string | undefined): void {
    this.jobSessionId = sessionId;
  }

  // ── v3：HTTP 路由 + 模型调用 ──

  registerRoute(def: PluginHttpRouteDef): void {
    if (!this.httpRegistry) {
      throw new Error(
        `plugin ${this.pluginId}: custom HTTP routes are not available in this host build`,
      );
    }
    if (!def?.path) {
      throw new Error(`plugin ${this.pluginId}: registerRoute requires a path`);
    }
    if (typeof def.handler !== "function") {
      throw new Error(`plugin ${this.pluginId}: registerRoute requires a handler`);
    }
    this.httpRegistry.register(this.pluginId, def);
  }

  async complete(options: PluginLlmCompleteOptions): Promise<PluginLlmResult> {
    if (!this.llmService) {
      throw new Error(
        `plugin ${this.pluginId}: LLM access is not available in this host build`,
      );
    }
    return this.llmService.complete(this.pluginId, options || {});
  }

  completeStream(
    options: PluginLlmCompleteOptions,
  ): AsyncGenerator<PluginLlmStreamChunk, void, unknown> {
    if (!this.llmService) {
      throw new Error(
        `plugin ${this.pluginId}: LLM access is not available in this host build`,
      );
    }
    return this.llmService.completeStream(this.pluginId, options || {});
  }

  async listModels(): Promise<PluginLlmModelInfo[]> {
    if (!this.llmService) return [];
    return this.llmService.listModels();
  }

  registerTurnReminderProvider(provider: TurnReminderProvider): void {
    this.turnReminderRegistry?.register(this.pluginId, provider);
  }

  registerWorkspaceProvider(factory: WorkspaceProviderFactory): void {
    if (!this._workspaceProviders.find((f) => f.scheme === factory.scheme)) {
      this._workspaceProviders.push(factory);
    }
  }

  registerConnectionType(factory: WorkspaceProviderFactory): void {
    // Same as registerWorkspaceProvider — connection types are stored in the same registry
    // and surfaced via GET /workspace/providers for the settings page
    if (!this._workspaceProviders.find((f) => f.scheme === factory.scheme)) {
      this._workspaceProviders.push(factory);
    }
  }

  private _attachmentTypes: AttachmentTypeRegistration[] = [];
  private _uiPages: UiPageRegistration[] = [];
  private _slots: SlotRegistration[] = [];
  private _themes: ThemeRegistration[] = [];
  private _rpcHandlers: Record<string, RpcHandler> = {};
  private _providerTypeCards: ProviderTypeCard[] = [];
  private _protocolAdapters: ProtocolAdapterContribution[] = [];
  private _agentDefs: PluginAgentDef[] = [];

  registerAttachmentType(reg: AttachmentTypeRegistration): void {
    if (!this._attachmentTypes.find((x) => x.id === reg.id)) {
      this._attachmentTypes.push(reg);
    }
  }

  registerUiPage(reg: UiPageRegistration): void {
    if (!this._uiPages.find((x) => x.id === reg.id)) {
      this._uiPages.push(reg);
    }
  }
  registerSlot(reg: SlotRegistration): void {
    if (!this._slots.find((x) => x.name === reg.name && x.component === reg.component)) {
      this._slots.push(reg);
    }
  }
  registerTheme(reg: ThemeRegistration): void {
    if (!reg?.id) {
      throw new Error(`plugin ${this.pluginId}: registerTheme requires an id`);
    }
    const cssFiles =
      reg.cssFiles ||
      (reg.cssFile ? { light: reg.cssFile, dark: reg.cssFile } : undefined);
    const isRich = Boolean(reg.runtimeScript || reg.assetBase);
    // 纯 CSS 主题允许没有 cssFile（如 "default" 语义的占位），富主题必须有样式或脚本
    if (!cssFiles?.light && !cssFiles?.dark && !isRich) {
      throw new Error(
        `plugin ${this.pluginId}: theme "${reg.id}" must declare cssFile / cssFiles or runtimeScript`,
      );
    }
    if (this._themes.find((x) => x.id === reg.id)) return;
    this._themes.push({ ...reg, cssFiles });
  }

  /**
   * @deprecated v3 起主题与皮肤合并：等价于 registerTheme。
   * 保留只为兼容按旧契约编写的插件。
   */
  registerSkin(reg: SkinRegistration): void {
    this.registerTheme(reg);
  }

  registerProviderType(card: ProviderTypeCard): void {
    const type = typeof card?.type === 'string' ? card.type.trim() : '';
    if (!type) {
      throw new Error(`[plugin:${this.pluginId}] provider type card requires a non-empty type`);
    }
    if (this._providerTypeCards.find((x) => x.type === type)) {
      throw new Error(`[plugin:${this.pluginId}] duplicate provider type "${type}"`);
    }
    this._providerTypeCards.push({ ...card, type });
  }

  registerProtocolAdapter(def: {
    protocol: string;
    adapter: IProtocolAdapter;
    displayName?: string;
    capabilities?: ProtocolCapabilities;
  }): void {
    const protocol = def?.protocol?.trim() || def?.adapter?.protocol;
    if (!protocol) {
      throw new Error(`[plugin:${this.pluginId}] protocol adapter requires a protocol`);
    }
    if (!def.adapter || typeof def.adapter.chatCompletion !== 'function') {
      throw new Error(
        `[plugin:${this.pluginId}] protocol "${protocol}" adapter must implement chatCompletion()`,
      );
    }
    if (def.adapter.protocol !== protocol) {
      throw new Error(
        `[plugin:${this.pluginId}] protocol "${protocol}" does not match adapter.protocol "${def.adapter.protocol}"`,
      );
    }
    if (this._protocolAdapters.find((x) => x.protocol === protocol)) {
      throw new Error(`[plugin:${this.pluginId}] duplicate protocol "${protocol}"`);
    }
    this._protocolAdapters.push({
      protocol,
      adapter: def.adapter,
      displayName: def.displayName,
      capabilities: def.capabilities,
    });
  }

  /** 供 PluginManager 提交到 ProviderContributionCoordinator */
  getProviderContributions(): {
    adapters: ProtocolAdapterContribution[];
    types: ProviderTypeCard[];
  } {
    return {
      adapters: this._protocolAdapters,
      types: this._providerTypeCards,
    };
  }

  /**
   * 注册技能（第三方插件）：构造 SkillDefinition（内嵌 content）并注入技能注册表。
   */
  registerSkill(input: PluginSkillDef): void {
    this.commitPluginSkill(input);
  }

  /**
   * v4.1：技能提交实现——插件级与能力包级共用。
   *
   * @param toolkitId 能力包技能传入所属 kit id（运行时随该包门控显隐）
   */
  private commitPluginSkill(
    input: PluginSkillDef,
    toolkitId?: string,
  ): void {
    const registry = SkillRegistry.getInstance();
    if (!registry) {
      console.warn(`[plugin:${this.pluginId}] SkillRegistry not ready, cannot register skill: ${input.name}`);
      return;
    }
    const rb = input.resourceBase;
    registry.register({
      id: input.name.toLowerCase(),
      baseDir: "",
      basePath: "__plugin__",
      manifest: {
        name: input.name.toLowerCase(),
        description: input.description,
        ...(input.version ? { version: input.version } : {}),
        ...(input.dependencies ? { dependencies: input.dependencies } : {}),
        ...(input.author ? { author: input.author } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      },
      contentHash: createHash("sha256").update(input.content).digest("hex"),
      content: input.content,
      source: "system",
      enabled: true,
      provider: `plugin:${this.pluginId}`,
      ...(toolkitId ? { toolkitId } : {}),
      ...(input.visibleTo ? { visibleTo: input.visibleTo } : {}),
      ...(rb
        ? {
            resourceBase:
              rb.kind === "directory" ? { kind: "directory", path: rb.path } :
              rb.kind === "url" ? { kind: "url", url: rb.url } :
              { kind: "opaque", description: rb.description },
          }
        : {}),
    });
    console.log(
      `[plugin:${this.pluginId}] registered skill: ${input.name}${toolkitId ? ` (toolkit: ${toolkitId})` : ""}`,
    );
  }

  registerRpc(methods: Record<string, RpcHandler>): void {
    Object.assign(this._rpcHandlers, methods);
  }

  /** 获取附件类型（供 PluginManager 消费） */
  getAttachmentTypes(): AttachmentTypeRegistration[] {
    return this._attachmentTypes;
  }

  /** 获取 UI 页面（供 PluginManager 消费） */
  getUiPages(): UiPageRegistration[] {
    return this._uiPages;
  }
  /** 获取插件声明的 slots（供 PluginManager 消费） */
  getSlots(): SlotRegistration[] {
    return this._slots;
  }

  /** 获取插件声明的 RPC handlers（供 PluginManager 消费） */
  getRpcHandlers(): Record<string, RpcHandler> {
    return this._rpcHandlers;
  }

  registerNls(locale: string, messages: Record<string, string>): void {
    this.nlsService?.registerBundle(this.pluginId, locale, messages);
  }

  // ── PluginDataApi 实现 ──

  private get dataGroup(): string {
    return `plugin:${this.pluginId}`;
  }

  async getData(): Promise<Record<string, any>> {
    if (!this.settingsStorage) return {};
    return this.settingsStorage.getSettings(this.dataGroup);
  }

  async getValue<T>(key: string, defaultValue?: T): Promise<T> {
    if (!this.settingsStorage) return defaultValue as T;
    return this.settingsStorage.getSettingValue(
      this.dataGroup,
      key,
      defaultValue,
    );
  }

  async setValue(key: string, value: any): Promise<void> {
    if (!this.settingsStorage) return;
    await this.settingsStorage.updateSettings(this.dataGroup, {
      [key]: value,
    });
  }

  async deleteValue(key: string): Promise<void> {
    if (!this.settingsStorage) return;
    await this.settingsStorage.deleteSettingValue(this.dataGroup, key);
  }

  /** 注册到 PluginRegistry */
  flush(): void {
    // 注册 manifest
    if (!PluginRegistry.has(this.pluginId)) {
      PluginRegistry.registerManifest({
        id: this.pluginId,
        name: this.pluginName,
        description: "",
        version: "1.0.0",
        category: "core",
      });
    }

    // 注册 tools（顶层）
    const reg = (PluginRegistry as any).registrations.get(this.pluginId);
    if (reg) {
      for (const td of this._toolDefs) {
        if (!reg.tools.find((x: any) => x.name === td.name)) {
          reg.tools.push(td);
        }
      }
    }

    // 注册 ToolKits
    const kitRegs = this._toolKits.map((tk) => tk.toRegistration());
    for (const kitReg of kitRegs) {
      PluginRegistry.registerToolKit(this.pluginId, kitReg);
    }

    // v4.1：能力包技能 → SkillRegistry（带 toolkitId，运行时随本包门控显隐）
    //
    // 与工具包提示词同一条提交时序（先提交 kit 注册，再提交其附属能力）。
    // 警告：lazy 包的技能若与包同名，会遮蔽 skill_learn("<kit>") 的工具定义
    // fallback（技能命中优先于工具包目录），导致模型拿不到 <tool_definition>。
    for (const kitReg of kitRegs) {
      for (const sk of kitReg.skills) {
        if (
          sk.name.toLowerCase() === kitReg.def.id.toLowerCase() &&
          (kitReg.def.loadMode || "eager") === "lazy"
        ) {
          console.warn(
            `[plugin:${this.pluginId}] toolkit "${kitReg.def.id}" is lazy but registers a same-name skill; ` +
              `skill_learn("${sk.name}") will return the skill text and skip the lazy toolkit's tool definitions`,
          );
        }
        this.commitPluginSkill(sk, kitReg.def.id);
      }
    }

    // 工具包级提示词 → 提示词段（v3：与 registerPrompt 同一条管线）
    //
    // 只有「本轮 eager」的段才会进系统提示词：装配器按 `toolkitId` 查
    // resolvedPlugins[].enabledToolKits 的 loadMode 再决定是否跳过，
    // 因为 loadMode 可以由 kit.handler 在运行时动态改变（lazy / none）。
    for (const kitReg of kitRegs) {
      kitReg.prompts.forEach((pm, index) => {
        const base =
          pm.frequency === "STATIC" ? 5500 : pm.frequency === "VOLATILE" ? 7500 : 6500;
        const name = `${this.pluginId}.toolkit.${kitReg.def.id}.${index}`;
        if (this._promptSections.find((x) => x.name === name)) return;
        this._promptSections.push({
          name,
          order: base + index,
          scope: "global",
          toolkitId: kitReg.def.id,
          text: pm.handler,
          description: pm.description,
        });
      });
    }

    // 注册 v2 提示词段 / 装配变换
    // （registerPrompt 与 toolkit.registerPrompt 都已在上面折算为段）
    for (const section of this._promptSections) {
      PluginRegistry.registerPromptSection(this.pluginId, section);
    }
    for (const transform of this._promptTransforms) {
      PluginRegistry.registerPromptTransform(this.pluginId, transform);
    }

    // 注册 v2 动作型本地命令（不落库、不调模型）
    if (this.localCommandRegistry) {
      for (const cmd of this._localCommands) {
        this.localCommandRegistry.register(cmd.name, (ctx: any) => cmd.handler(ctx), {
          description: cmd.description,
          pluginId: this.pluginId,
          aliases: cmd.aliases,
        });
      }
    }

    // 注册 v2 生命周期 Hook
    if (this.hookRegistry) {
      for (const hook of this._hooks) {
        this.hookRegistry.register(this.pluginId, hook);
      }
    }

    // 注册 workspace providers
    for (const factory of this._workspaceProviders) {
      PluginRegistry.registerWorkspaceProvider(this.pluginId, factory);
    }

    // 注册 attachment types
    for (const att of this._attachmentTypes) {
      PluginRegistry.registerAttachmentType(this.pluginId, att);
    }

    // 注册 slots
    for (const slot of this._slots) {
      PluginRegistry.registerSlot(this.pluginId, slot);
    }

    // 注册 themes（v3：主题与皮肤统一，皮肤就是富主题）
    for (const theme of this._themes) {
      PluginRegistry.registerTheme(this.pluginId, theme);
    }

    // 注册 rpc handlers
    PluginRegistry.registerRpc(this.pluginId, this._rpcHandlers);

    // 注册 ui pages
    for (const page of this._uiPages) {
      PluginRegistry.registerUiPage(this.pluginId, page);
    }

    // 注册插件智能体（v4）：toolkits 缺省在此定格为本插件当前全部工具包，
    // 之后插件内新增/删除工具包不会追溯改变已注册智能体的能力面。
    for (const def of this._agentDefs) {
      const resolved: PluginAgentDef = {
        ...def,
        toolkits:
          def.toolkits ??
          this._toolKits.map((tk) => tk.toRegistration().def.id),
        skills: def.skills ?? undefined,
      };
      PluginAgentRegistry.commit(this.pluginId, def.id, resolved);
    }
  }

  /** 获取命令提供者 供 PluginManager 消费 */
  getCommandProviders(): ICommandProvider[] {
    return this._commandProviders;
  }

  /** 获取 WorkspaceProvider 工厂 供 PluginManager 消费 */
  getWorkspaceProviders(): WorkspaceProviderFactory[] {
    return this._workspaceProviders;
  }

  /** v2：本次 onLoad 注册的提示词段（供生命周期回滚/诊断） */
  getPromptSections(): PromptSectionDef[] {
    return this._promptSections;
  }

  /** v2：本次 onLoad 注册的装配变换 */
  getPromptTransforms(): PromptTransformDef[] {
    return this._promptTransforms;
  }

  /** v2：本次 onLoad 注册的动作型本地命令 */
  getLocalCommands(): LocalCommandDef[] {
    return this._localCommands;
  }

  /** v2：本次 onLoad 注册的 Hook */
  getHooks(): PluginHookDef[] {
    return this._hooks;
  }

  /** v2.2：本次 onLoad 注册的皮肤（v3 起 = 富主题，即带 runtimeScript/assetBase 的主题） */
  getSkins(): SkinRegistration[] {
    return this._themes.filter((theme) => theme.runtimeScript || theme.assetBase);
  }

  /** v4：本次 onLoad 注册的智能体声明（供生命周期诊断） */
  getAgentDefs(): PluginAgentDef[] {
    return this._agentDefs;
  }
}
