import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { SkillOrchestrator } from "../core/skill-orchestrator.service";
import { PluginApi } from "../../plugins/api/plugin-api";
import { isToolkitAllowedByRoleConfig } from "../../plugins/utils/role-toolkit-filter";
import { isVisibleToAgent } from "../../plugins/utils/agent-visibility";
import {
  formatSkillLocationHeader,
  truncateSkillInstructions,
} from "../common/skill-location.util";
import path from "path";
import langZh from "./skill.lang.zh.json";
import langEn from "./skill.lang.en.json";

@Injectable()
export class SkillPlugin extends PluginBase {
  private readonly logger = new Logger(SkillPlugin.name);
  manifest = {
    id: "skill",
    name: "%skill.name%",
    description: "%skill.description%",
    version: "1.0.0",
    category: "system" as const,
    icon: "images/plugins/skill.svg",
  };

  constructor(private orchestrator: SkillOrchestrator) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── 注册斜杠命令提供者（含解析器） ──
    api.registerCommandProvider({
      id: "skill",
      trigger: "slash",
      fetchItems: () => {
        const skills = this.orchestrator.listSkills(true);
        return skills.map((s) => ({
          name: s.manifest?.name || s.id,
          description: s.manifest?.description || "",
          label: s.manifest?.name || s.id,
        }));
      },
      parse: async (attrs, ctx) => {
        const name = attrs.name || "unknown";

        const allSkills = this.orchestrator.listSkills(true);
        const skill = allSkills.find(
          (s) => (s.manifest?.name || s.id) === name,
        );
        if (!skill) return undefined;

        const skillName = skill.manifest?.name || skill.id || name;
        const desc = skill.manifest?.description || "";
        const replacement = `\`skill:${skillName}\``;

        // 智能注入：唯一技能且全文不超阈值 → 内联完整指令（省一次 skill_learn 往返）；
        // 多技能或超限 → 轻量提示（名字 + 描述 + 引导 skill_learn 懒加载），
        // 避免多个大技能把上下文撑爆。产物冻结为注入块，历史不再随插件状态变化。
        const SKILL_INLINE_LIMIT = 6000;
        const learned = await this.orchestrator
          .skillLearn(skill.id)
          .catch(() => null);
        const content = learned?.content ?? "";
        const inlineFull =
          (ctx?.commandCount ?? 1) === 1 &&
          content.length > 0 &&
          content.length <= SKILL_INLINE_LIMIT;

        const appendix = inlineFull
          ? [
              `The user invoked skill "${skillName}". Follow its instructions:`,
              `<skill_content name="${skillName}">`,
              "<skill_resources>",
              // 与 skill_learn 工具共用同一位置头，避免两处措辞漂移
              learned
                ? formatSkillLocationHeader(learned)
                : skill.baseDir
                  ? `Base directory for this skill: ${skill.baseDir}`
                  : "This skill declares no resource directory (no bundled scripts/resources).",
              "Load referenced resources only as needed.",
              "</skill_resources>",
              "",
              "<skill_instructions>",
              content,
              "</skill_instructions>",
              "</skill_content>",
            ].join("\n")
          : [
              `---skill:${skillName}---`,
              `description:${desc}`,
              `(The user invoked this skill. Use the skill_learn tool with name "${skillName}" to load the full instructions before acting.)`,
            ].join("\n");

        return { replacement, appendix };
      },
    });

    const skillKit = api.registerToolKit({
      id: "skill",
      name: "%skill.toolkitName%",
      description: "%skill.toolkitDescription%",
      loadMode: "eager",
      // Skills 有自己的管理页：总开关由 Skills tab 写入 settings.plugins.skill，
      // 逐项偏好在 settings.skills 由 orchestrator 消费
      governance: "self",
      activator:
        "Call this toolkit to get the full instructions for a skill when you need to use one",
      // 始终 eager：skill_learn 同时承担"读取技能"与"学习懒加载工具包"两个职责
      //（tool_learn 退役后的等价入口）。无技能时仍需可用，不能因列表为空返回 none。
      // skill 插件是 system 类别，全局恒启用；不按智能体层过滤（tool_learn 原先
      // 在 essential 插件中也不受裁剪，保持同等可得性）。
    });

    // ── skill_learn ──
    skillKit.registerTool({
      name: "skill_learn",
      description:
        "通过名称获取技能的完整指令内容或工具包的工具定义。技能正文已去除 YAML 元数据头，可直接使用；资源目录用于执行技能自带脚本、读取随附资源。传入懒加载工具包 ID 时返回包内所有工具的定义与用法（工具需经 tool_use 调用）。",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "技能名称（SKILL.md frontmatter 中定义的 name 字段）或懒加载工具包 ID",
          ),
      }),
      execute: async (args, ctx) => {
        // v4：作用域声明校验——限定智能体的技能，其他智能体不可学习
        const def = this.orchestrator.listSkills(true, ctx?.session.workspacePath, ctx?.session)
          .find((s: any) => s.id === args.name.toLowerCase());
        if (def?.visibleTo) {
          const provider = String(def.provider || "");
          const ownerPluginId = provider.startsWith("plugin:")
            ? provider.substring("plugin:".length)
            : "";
          if (
            !isVisibleToAgent(def.visibleTo, ownerPluginId, ctx?.session?.agentId ?? null)
          ) {
            throw new Error(`skill "${args.name}" is not available to this agent`);
          }
        }
        const result = await this.orchestrator.skillLearn(args.name, ctx?.session);
        if (!result) {
          throw new Error(`skill "${args.name}" not found`);
        }
        // 工具包（动态工具技能）没有资源目录，正文即全部内容，不加位置头
        if (result.kind === "tool") {
          return { content: result.content };
        }
        // 位置头置于正文最前：模型必须能定位技能自带脚本；
        // 即便结果被通用大结果处理 spill，2048 字符预览里也带着它。
        const body = formatSkillLocationHeader(result) + "\n\n" + result.content;
        const { content } = truncateSkillInstructions(body, result);
        // 规范 ToolResultObject：路径已在正文里，不再依赖会被执行器丢弃的 path 字段
        return { content };
      },
      display: {
        actionType: "skill_read",
        text: {
          executing: "%skill_learn.executing%",
          completed: "%skill_learn.completed%",
        },
        argsKey: "name",
        icon: "book",
      },
      dangerLevel: "info",
      readOnly: true,
      // 技能正文就是模型要用的内容，通用裁剪（换成 2048 字符预览）等于报废；
      // 由 truncateSkillInstructions 自管上限并给出续读路径。
      exemptFromLargeResult: true,
    });

    // ── Prompt（toolkit 的 prompt 随 loadMode 自动注入/隐藏）──
    skillKit.registerPrompt({
      frequency: "REGULAR",
      description: "可用技能列表",
      content: (context: PluginContext) => {
        const sections: string[] = [];

        // 智能体级「功能开关」只门控真实技能清单段：
        // settings.plugins.skill = { toolkits_filter: 'allow' }（空允许列表）→ 不投放 # Skills。
        // skill_learn 工具与懒加载工具包段（<available_tool_skills>）不受其影响——
        // 后者由「本地工具」tab 的工具包开关（loadMode）控制，职责分离。
        const skillEntry = (
          context?.session.getSettings?.("plugins") as any
        )?.skill;
        const realSkillsAllowed = isToolkitAllowedByRoleConfig(
          skillEntry,
          "skill",
        );

        if (realSkillsAllowed) {
          const allSkills = this.orchestrator.listSkills(
            true,
            context?.session.workspacePath,
            context?.session,
          );

          // v4：作用域声明过滤——插件限定智能体的技能只出现在该智能体的清单里
          const agentId = context?.session?.agentId ?? null;
          const scopedSkills = allSkills.filter((s: any) => {
            if (!s.visibleTo) return true;
            const provider = String(s.provider || "");
            const ownerPluginId = provider.startsWith("plugin:")
              ? provider.substring("plugin:".length)
              : "";
            return isVisibleToAgent(s.visibleTo, ownerPluginId, agentId);
          });

          // 按智能体级偏好过滤
          const charSkillCfg = context?.session.getSettings?.("skills");
          let skills: any[];
          if (charSkillCfg === false) {
            skills = [];
          } else if (typeof charSkillCfg === "object" && charSkillCfg !== null) {
            if (charSkillCfg.__default === false) {
              // 白名单模式：只保留显式 enabled: true 的技能
              skills = scopedSkills.filter((s: any) => charSkillCfg[s.id] === true);
            } else {
              // 黑名单模式：排除显式 enabled: false 的技能
              skills = scopedSkills.filter((s: any) => charSkillCfg[s.id] !== false);
            }
          } else {
            skills = scopedSkills;
          }

          if (skills.length > 0) {
            const skillList = skills
              .map((s) => `- ${s.manifest.name}: ${s.manifest.description}`)
              .join("\n");
            sections.push(
              [
                "# Skills",
                "",
                "You have access to the following skills. Each skill has a name and description.",
                "When a user's request matches a skill's description, use the `skill_learn` tool to load the full",
                "SKILL.md file from its location to get complete instructions. Do not guess the skill's",
                "behavior — always read the file first.",
                "",
                "<available_skills>",
                skillList,
                "</available_skills>",
              ].join("\n"),
            );
          }
        }

        // 懒加载工具包清单（取代旧 # Available Lazy-Load Toolkits / tool_learn）：
        // 先 skill_learn 取定义，再经 tool_use 调用具体工具
        const toolSkills = context?.session
          ? this.orchestrator.listToolSkills(context.session)
          : [];
        if (toolSkills.length > 0) {
          const toolSkillList = toolSkills
            .map((t) => `- ${t.id}: ${t.activator}`)
            .join("\n");
          sections.push(
            [
              "# Tool Skill Toolkits",
              "",
              "The following lazy-load toolkits are available. Each contains tools that are NOT in your",
              "function list. When a task matches a toolkit's capabilities, load its tool definitions",
              'with `skill_learn("<toolkit>")` first, then invoke individual tools via',
              "`tool_use(tool_name, arguments{...})`. Do not guess tool parameters — always learn first.",
              "",
              "<available_tool_skills>",
              toolSkillList,
              "</available_tool_skills>",
            ].join("\n"),
          );
        }

        return sections.join("\n\n");
      },
    });
  }
}
