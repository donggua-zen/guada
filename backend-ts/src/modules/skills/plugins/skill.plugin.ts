import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import { z } from "zod";
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
    category: "core" as const,
  };

  constructor(private orchestrator: SkillOrchestrator) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerToolSet({
      name: "skill",
      activator: "当需要管理或调用技能时使用 tool_load 加载技能管理工具",
    });

    api.registerTool({
      name: "skill_scan",
      toolSet: "skill",
      description:
        "Scan the skills directory to discover new or updated skills. Use this when you need to refresh the list of available skills.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const result = await this.orchestrator.triggerScan();
          return `Scan completed successfully. Found ${result.added.length} new skills, ${result.updated.length} updated, ${result.removed.length} removed.`;
        } catch (error: any) {
          return `Scan failed: ${error.message}`;
        }
      },
      display: { action: "扫描技能", icon: "search" },
    });

    api.registerTool({
      name: "skill_reload",
      toolSet: "skill",
      description:
        "Reload a specific skill to apply changes. Use this after modifying a skill's SKILL.md file. If you changed the skill name (directory name), use scan instead.",
      inputSchema: z.object({
        skillId: z.string().describe("The ID (name) of the skill to reload"),
      }),
      execute: async (args) => {
        if (!args.skillId) return "Error: skillId parameter is required";
        try {
          const normalizedSkillId = args.skillId.toLowerCase();
          const updatedSkill =
            await this.orchestrator.reloadSkill(normalizedSkillId);
          return `Successfully reloaded skill: ${updatedSkill.manifest.name} (version ${updatedSkill.manifest.version})`;
        } catch (error: any) {
          return `Failed to reload skill ${args.skillId}: ${error.message}`;
        }
      },
      display: { action: "重新加载技能", argsKey: "skillId", icon: "edit" },
    });

    api.registerTool({
      name: "skill_call",
      toolSet: "skill",
      description:
        "Call a specific skill to activate it and get its complete instructions. This will return the full SKILL.md content that you must follow to complete the task.",
      inputSchema: z.object({
        skillName: z.string().describe("The name of the skill to call"),
      }),
      execute: async (args, ctx) => {
        if (!args.skillName) return "Error: skillName parameter is required";
        try {
          const normalizedSkillName = args.skillName.toLowerCase();
          const skill = this.orchestrator.getSkillDetail(normalizedSkillName);
          if (!skill) return `Skill '${args.skillName}' not found.`;
          const content = await this.orchestrator.getSkillDocumentation(normalizedSkillName);
          return [
            `# Skill: ${skill.manifest.name}`,
            "",
            `**Path**: ${skill.basePath}/SKILL.md`,
            "",
            "---",
            "",
            content || "(No content available)",
          ].join("\n");
        } catch (error: any) {
          return `Failed to get skill info for ${args.skillName}: ${error.message}`;
        }
      },
      display: { action: "调用技能", argsKey: "skillName", icon: "generic" },
    });

    // 动态技能列表提示词（每次收集时从 orchestrator 读取当前技能）
    api.registerPrompt({
      toolSet: "skill",
      frequency: "VOLATILE",
      description: "可用技能列表及使用指南",
      content: (context: PluginContext) => {
        const skills = this.orchestrator.listSkills(true);
        if (skills.length === 0) return "";

        const metadataList = skills
          .map((s: any) => `- ${s.manifest.name}: ${s.manifest.description}`)
          .join("\n");

        return [
          "",
          "# Available Skills",
          "You have access to the following professional skills. When a user request matches a skill's capability, you should proactively read and apply that skill:",
          "",
          metadataList,
          "",
          "## Skills Directory",
          `User skills are stored in: ${this.skillsDir}`,
          `System built-in skills are stored in: ${this.skillsDir}/.system/`,
          "",
          "## Important: Skills List Already Provided",
          "The complete list of available skills is shown above. You do NOT need to call any tool to get the skills list.",
          "When asked about available skills, simply refer to the list provided in this prompt.",
          "",
          "## How to Use Skills",
          "When you identify that a skill is relevant to the current task:",
          '1. Call the skill using: skill_call({ skillName: "skill-name" })',
          "2. The tool will activate the skill and return its complete SKILL.md instructions",
          "3. Carefully follow all instructions and guidelines in the returned content",
          "4. Apply the skill's methodology to complete the task",
        ].join("\n");
      },
    });
  }
}
