import { Injectable, Logger } from "@nestjs/common";
import { PluginManager } from "../plugins/plugin.manager";
import { PromptCollector } from "../plugins/prompt-collector.service";
import type { ISessionContext } from "../chat/session-context";
import type {
  ContentBlock,
  Message,
} from "../../common/types/conversation.types";
import type {
  PluginContext,
  ResolvedPluginInfo,
  ToolHandlerDef,
} from "../plugins/types/plugin.types";
import { getRetiredToolkitMessage } from "./retired-tools";

/** lazy 工具包的技能条目（动态生成，不进入 SkillRegistry） */
export interface ToolSkillEntry {
  /** 工具包 id（skill_learn 的参数，也是历史扫描的规范名） */
  id: string;
  /** 展示名（工具包 name，可能是 NLS key） */
  name: string;
  description?: string;
  activator?: string;
  pluginId: string;
}

/**
 * lazy 工具包目录：把懒加载工具包以"工具技能"的形式暴露给技能体系。
 *
 * - listToolSkills：技能清单用，只列 lazy 且启用的包；
 * - resolveToolSkill / buildToolSkillContent：skill_learn fallback 用，
 *   保持与旧 tool_learn 完全一致的输出格式（toolkit + <tool_definition> + lazy prompts）；
 * - collectLearnedToolkits / hasCompleteSkillContent：压缩记忆恢复用，
 *   扫描历史中的 skill_learn（含 legacy tool_learn）与结果正文里的首尾标记。
 */
@Injectable()
export class ToolkitCatalogService {
  private readonly logger = new Logger(ToolkitCatalogService.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly promptCollector: PromptCollector,
  ) {}

  /** 当前会话可学习的 lazy 工具包（技能清单条目） */
  listToolSkills(session: ISessionContext): ToolSkillEntry[] {
    const resolved = session.getResolvedPlugins();
    if (!resolved || resolved.length === 0) return [];
    const entries: ToolSkillEntry[] = [];
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      for (const tk of rp.enabledToolKits) {
        if (!tk.enabled || tk.loadMode !== "lazy") continue;
        entries.push({
          id: tk.id,
          name: tk.name || tk.id,
          description: tk.description,
          activator: tk.activator || `${rp.plugin.name} 工具包`,
          pluginId: rp.plugin.id,
        });
      }
    }
    return entries;
  }

  /** 按工具包 id 或展示名解析（loadMode=none 表示"压根不加载"，不可学） */
  resolveToolSkill(
    name: string,
    session: ISessionContext,
  ): ToolSkillEntry | undefined {
    const resolved = session.getResolvedPlugins();
    if (!resolved || resolved.length === 0) return undefined;
    const lowered = name.toLowerCase();
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      const kitInfo = rp.enabledToolKits.find(
        (k) =>
          k.enabled &&
          k.loadMode !== "none" &&
          (k.id === name || k.id === lowered || k.name === name),
      );
      if (kitInfo) {
        return {
          id: kitInfo.id,
          name: kitInfo.name || kitInfo.id,
          description: kitInfo.description,
          activator: kitInfo.activator || `${rp.plugin.name} 工具包`,
          pluginId: rp.plugin.id,
        };
      }
    }
    return undefined;
  }

  /**
   * 构建单个工具包的完整内容（工具定义 + 使用说明）。
   *
   * 内部自动收集该插件对应的 lazy prompts（使用指南/说明），
   * 按工具包维度组装：先工具定义，再使用说明。
   *
   * 从 UniversalToolsPlugin.buildToolkitContent 迁移，输出格式保持一致，
   * 保证压缩记忆恢复（# LEARNED TOOLKITS）与 skill_learn 返回的内容同构。
   * 首尾包一层 <!-- tool-skill:<kitId> --> 标记，供压缩保护识别完整定义。
   */
  async buildToolSkillContent(
    entry: ToolSkillEntry,
    context: PluginContext,
  ): Promise<string> {
    const resolved = context.session.getResolvedPlugins();
    const targetKit = resolved
      .find((rp) => rp.plugin.id === entry.pluginId)
      ?.enabledToolKits.find((k) => k.id === entry.id);
    // 工具存在 allTools 中（enabledTools 不含未激活的懒加载工具）；
    // eager 包（历史行为允许学习）则取 enabledTools
    const kitTools = this.collectKitTools(resolved, entry);

    const parts: string[] = [];
    if (kitTools.length > 0) {
      const toolDescriptions = kitTools
        .map((tool) => {
          // 按原生 function-calling 形状序列化为**单个 JSON 对象**：
          // {name, description, parameters} —— 与 openai.adapter 的 function 字段
          // 及内部 ToolDefinition 同构，模型对这套三件套最熟悉；同一次对话里 eager 工具
          // 也以同样的键名下发，词表一致。
          // parameters 直接复用 toolkit 已转换好的 JSON Schema（z.toJSONSchema + 限深展平）
          const toolJson = JSON.stringify(
            {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
            null,
            2,
          );
          return [`<tool_definition>`, toolJson, `</tool_definition>`].join(
            "\n",
          );
        })
        .join("\n\n");
      parts.push(`toolkit ${entry.id}`, "", toolDescriptions);
    }

    // 使用说明 prompt（lazy prompts）
    let toolUsagePrompt = "";
    if (targetKit && targetKit.loadMode === "lazy") {
      try {
        const prompts = await this.promptCollector.collectLazyPrompts(
          resolved,
          context,
        );
        const tsPrompts = prompts.filter((p) => p.pluginId === entry.pluginId);
        if (tsPrompts.length > 0) {
          toolUsagePrompt = tsPrompts.map((p) => p.content).join("\n\n");
        }
      } catch {}
    }
    if (toolUsagePrompt) parts.push(toolUsagePrompt);
    parts.push("---");

    const body = parts.join("\n");
    return [
      `<!-- tool-skill:${entry.id} -->`,
      body,
      `<!-- /tool-skill:${entry.id} -->`,
    ].join("\n");
  }

  /** 收集工具包内工具：lazy 包取 allTools，eager 包取 enabledTools（对齐旧 tool_learn） */
  private collectKitTools(
    resolved: ResolvedPluginInfo[],
    entry: ToolSkillEntry,
  ): ToolHandlerDef[] {
    for (const rp of resolved) {
      if (rp.plugin.id !== entry.pluginId || !rp.enabled) continue;
      const kitInfo = rp.enabledToolKits.find((k) => k.id === entry.id);
      if (!kitInfo) continue;
      if (kitInfo.loadMode === "lazy") {
        return rp.allTools.filter((t) => t.toolSet === entry.id);
      }
      return rp.enabledTools.filter((t) => t.toolSet === entry.id);
    }
    return [];
  }

  /** 旧工具包退役迁移提示（skill_learn 命中旧名称时返回） */
  retiredToolkitMessage(name: string): string | undefined {
    return getRetiredToolkitMessage(name);
  }

  /**
   * 扫描可见历史，收集"已学习"的工具包 id。
   *
   * 来源：assistant tool-call 中的 skill_learn（现行）与 tool_learn（legacy）。
   * 返回值为规范化后的工具包 id（legacy 名称可能与 id 不同，由调用方按当前
   * resolvedPlugins 归一；这里只做去重与小写化）。
   */
  async collectLearnedToolkits(session: ISessionContext): Promise<Set<string>> {
    const learned = new Set<string>();
    const history = await session.getHistory();
    if (!history || history.length === 0) return learned;
    for (const msg of history) {
      if (msg.role !== "assistant") continue;
      for (const block of msg.content) {
        if (block.type !== "tool-call") continue;
        if (block.name !== "skill_learn" && block.name !== "tool_learn") continue;
        const name = this.readLearnArg(block);
        if (name) learned.add(name.toLowerCase());
      }
    }
    return learned;
  }

  private readLearnArg(block: Extract<ContentBlock, { type: "tool-call" }>): string | undefined {
    try {
      const args =
        typeof block.arguments === "string"
          ? JSON.parse(block.arguments)
          : block.arguments;
      const name = args?.name ?? args?.toolkit;
      return typeof name === "string" && name.trim() ? name : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 判断历史 tool-result 中是否已有某工具包的完整定义（首尾标记俱在）。
   * 完整 → 压缩记忆无需重复注入；缺失/被裁剪 → 需要重建。
   */
  hasCompleteSkillContent(
    toolResultName: string,
    content: string,
    kitId: string,
  ): boolean {
    if (toolResultName !== "skill_learn" && toolResultName !== "tool_learn") {
      return false;
    }
    return (
      content.includes(`<!-- tool-skill:${kitId} -->`) &&
      content.includes(`<!-- /tool-skill:${kitId} -->`)
    );
  }

  /** 供测试与诊断：列出 resolved 中全部启用的 lazy 包（不做展示加工） */
  static listLazyKitIds(resolved: ResolvedPluginInfo[]): string[] {
    const ids: string[] = [];
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      for (const tk of rp.enabledToolKits) {
        if (tk.enabled && tk.loadMode === "lazy") ids.push(tk.id);
      }
    }
    return ids;
  }

  /** 遗留接口：供 UniversalToolsPlugin 记忆恢复反查工具包显示名 */
  getPluginName(pluginId: string): string | undefined {
    return this.pluginManager.getPlugin(pluginId)?.manifest.name;
  }
}

/** 从历史消息中提取（toolName → 内容）序列，供记忆恢复扫描 */
export function* iterateToolResults(history: Message[]): Generator<{
  name: string;
  content: string;
}> {
  for (const msg of history) {
    if (msg.role !== "tool") continue;
    for (const block of msg.content) {
      if (block.type !== "tool-result") continue;
      yield { name: block.name, content: block.content };
    }
  }
}
