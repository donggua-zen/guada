import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext, RolePluginConfig } from "../../plugins/types/plugin.types";
import { SkillOrchestrator } from "../core/skill-orchestrator.service";
import { PluginApi } from "../../plugins/api/plugin-api";
import { isToolkitAllowedByRoleConfig } from "../../plugins/utils/role-toolkit-filter";
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
              `Base directory for this skill: ${learned?.path ?? skill.baseDir}. Load referenced resources only as needed.`,
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
      handler: async (ctx: PluginContext) => {
        const entry = (ctx.pluginsConfig as RolePluginConfig | undefined)?.skill;
        if (!isToolkitAllowedByRoleConfig(entry, "skill")) {
          return { loadMode: "none" as const };
        }
        const skills = this.orchestrator.listSkills(
          true,
          ctx?.session.workspacePath,
          ctx?.session,
        );
        if (skills.length === 0) return { loadMode: "none" as const };
        return { loadMode: "eager" as const };
      },
    });

    // ── skill_learn ──
    skillKit.registerTool({
      name: "skill_learn",
      description:
        "通过技能名称获取技能的完整指令内容和路径。技能内容已去除 YAML 元数据头，可直接使用",
      inputSchema: z.object({
        name: z
          .string()
          .describe("技能名称（SKILL.md frontmatter 中定义的 name 字段）"),
      }),
      execute: async (args, ctx) => {
        const result = await this.orchestrator.skillLearn(args.name, ctx?.session);
        if (!result) {
          throw new Error(`skill "${args.name}" not found`);
        }
        return {
          success: true,
          name: result.name,
          content: result.content,
          path: result.path,
          resourceBase: result.resourceBase,
        };
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
    });

    // ── Prompt（toolkit 的 prompt 随 loadMode 自动注入/隐藏）──
    skillKit.registerPrompt({
      frequency: "REGULAR",
      description: "可用技能列表",
      content: (context: PluginContext) => {
        const allSkills = this.orchestrator.listSkills(
          true,
          context?.session.workspacePath,
          context?.session,
        );

        // 按智能体级偏好过滤
        const charSkillCfg = context?.session.getSettings?.("skills");
        let skills: any[];
        if (charSkillCfg === false) {
          skills = [];
        } else if (typeof charSkillCfg === "object" && charSkillCfg !== null) {
          if (charSkillCfg.__default === false) {
            // 白名单模式：只保留显式 enabled: true 的技能
            skills = allSkills.filter((s: any) => charSkillCfg[s.id] === true);
          } else {
            // 黑名单模式：排除显式 enabled: false 的技能
            skills = allSkills.filter((s: any) => charSkillCfg[s.id] !== false);
          }
        } else {
          skills = allSkills;
        }
        if (skills.length === 0) return "";

        const skillList = skills
          .map((s) => `- ${s.manifest.name}: ${s.manifest.description}`)
          .join("\n");

        return [
          "",
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
        ].join("\n");
      },
    });
  }
}
