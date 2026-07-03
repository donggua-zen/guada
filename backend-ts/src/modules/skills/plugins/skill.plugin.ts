import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { SkillOrchestrator } from "../core/skill-orchestrator.service";
import { PluginApi } from "../../plugins/api/plugin-api";

@Injectable()
export class SkillPlugin extends PluginBase {
  private readonly logger = new Logger(SkillPlugin.name);
  private readonly skillsDir =
    process.env.SKILLS_DIR || path.join(process.cwd(), "skills");
  manifest = {
    id: "skill",
    name: "Skills 技能",
    description: "技能系统的管理工具",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(private orchestrator: SkillOrchestrator) {
    super();
  }

  async onLoad(api: PluginApi) {
    // 动态技能列表提示词（每次收集时从 orchestrator 读取当前技能）
    api.registerPrompt({
      frequency: "REGULAR",
      description: "可用技能列表及使用指南",
      content: (context: PluginContext) => {
        const allSkills = this.orchestrator.listSkills(
          true,
          context?.session.workspacePath,
        );

        // 按角色级偏好过滤
        const charSkillCfg = context?.session.getSettings?.('skills');
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

        const skillXml = skills
          .map((s) => {
            return [
              ` <skill name="${s.manifest.name}">`,
              `   <description>${s.manifest.description}</description>`,
              `   <location>${s.basePath}/SKILL.md</location>`,
              ` </skill>`,
            ].join("\n");
          })
          .join("\n");

        return [
          "",
          "# Skills",
          "",
          `Your skills base directory is \`${this.skillsDir}\`.`,
          "You have access to the following skills. Each skill has a name, description, and location.",
          "When a user's request matches a skill's description, use the `read` tool to load the full",
          "SKILL.md file from its location to get complete instructions. Do not guess the skill's",
          "behavior — always read the file first.",

          "<available_skills>",
          skillXml,
          "</available_skills>",
        ].join("\n");
      },
    });
  }
}
