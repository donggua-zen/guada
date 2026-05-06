import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IToolProvider, ToolCallRequest, ToolProviderMetadata } from '../../tools/interfaces/tool-provider.interface';
import { SkillOrchestrator } from '../core/skill-orchestrator.service';
import * as path from 'path';

@Injectable()
export class SkillToolBridgeService implements IToolProvider {
  private readonly logger = new Logger(SkillToolBridgeService.name);
  private readonly skillsDir: string;
  namespace = 'skill';

  constructor(
    private orchestrator: SkillOrchestrator,
    private configService: ConfigService,
  ) {
    this.skillsDir = this.configService.get<string>('SKILLS_DIR') || 
                     path.join(process.cwd(), 'skills');
  }

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    // 返回 Skills 系统管理工具（ToolOrchestrator 会自动添加 skill__ 前缀）
    return [
      {
        name: 'scan',
        description: 'Scan the skills directory to discover new or updated skills. Use this when you need to refresh the list of available skills.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      // TODO: 暂时屏蔽 list 工具，技能列表已注入提示词
      // {
      //   name: 'list',
      //   description: 'List all currently loaded skills with their names and descriptions.',
      //   parameters: {
      //     type: 'object',
      //     properties: {},
      //     required: [],
      //   },
      // },
      {
        name: 'reload',
        description: 'Reload a specific skill to apply changes. Use this after modifying a skill\'s SKILL.md file. If you changed the skill name (directory name), use scan instead.',
        parameters: {
          type: 'object',
          properties: {
            skillId: {
              type: 'string',
              description: 'The ID (name) of the skill to reload',
            },
          },
          required: ['skillId'],
        },
      },
      {
        name: 'call',
        description: 'Call a specific skill to activate it and get its complete instructions. This will return the full SKILL.md content that you must follow to complete the task.',
        parameters: {
          type: 'object',
          properties: {
            skillName: {
              type: 'string',
              description: 'The name of the skill to call',
            },
          },
          required: ['skillName'],
        },
      },
    ];
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    // request.name 已经是去掉命名空间前缀后的名称（如 scan, list, reload）
    this.logger.debug(`Executing skill tool: ${request.name}`);

    // 直接根据工具名称执行
    switch (request.name) {
      case 'scan':
        try {
          const result = await this.orchestrator.triggerScan();
          return `Scan completed successfully. Found ${result.added.length} new skills, ${result.updated.length} updated, ${result.removed.length} removed.`;
        } catch (error) {
          return `Scan failed: ${error.message}`;
        }

      case 'list':
        const skills = this.orchestrator.listSkills();
        if (skills.length === 0) {
          return 'No skills are currently loaded.';
        }

        const skillList = skills.map(skill =>
          `- ${skill.manifest.name}: ${skill.manifest.description}`
        ).join('\n');

        return `Currently loaded skills (${skills.length} total):\n${skillList}`;

      case 'reload':
        const skillId = request.arguments?.skillId;
        if (!skillId) {
          return 'Error: skillId parameter is required';
        }

        try {
          // 统一转换为小写进行匹配
          const normalizedSkillId = skillId.toLowerCase();
          const updatedSkill = await this.orchestrator.reloadSkill(normalizedSkillId);
          return `Successfully reloaded skill: ${updatedSkill.manifest.name} (version ${updatedSkill.manifest.version})`;
        } catch (error) {
          return `Failed to reload skill ${skillId}: ${error.message}`;
        }

      case 'call':
        const skillName = request.arguments?.skillName;
        if (!skillName) {
          return 'Error: skillName parameter is required';
        }

        try {
          // 统一转换为小写进行匹配
          const normalizedSkillName = skillName.toLowerCase();
          const skill = this.orchestrator.getSkillDetail(normalizedSkillName);
          if (!skill) {
            return `Skill '${skillName}' not found.`;
          }

          // 获取 SKILL.md 内容
          const content = await this.orchestrator.getSkillDocumentation(normalizedSkillName);
          
          return [
            `# Skill: ${skill.manifest.name}`,
            '',
            `**Path**: ${skill.basePath}/SKILL.md`,
            '',
            '---',
            '',
            content || '(No content available)',
          ].join('\n');
        } catch (error) {
          return `Failed to get skill info for ${skillName}: ${error.message}`;
        }

      default:
        return `Unknown skill tool: ${request.name}`;
    }
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    // 返回 Skills 元数据和工具使用说明
    const skills = this.orchestrator.listSkills();

    if (skills.length === 0) {
      return '';
    }

    const metadataList = skills.map(skill =>
      `- ${skill.manifest.name}: ${skill.manifest.description}`
    ).join('\n');

    return [
      '',
      '# Available Skills',
      "You have access to the following professional skills. When a user request matches a skill's capability, you should proactively read and apply that skill:",
      '',
      metadataList,
      '',
      '## Skills Directory',
      `All skills are stored in: ${this.skillsDir}`,
      `Each skill is in its own subdirectory: ${this.skillsDir}/{skill-name}/`,
      '',
      '## Important: Skills List Already Provided',
      'The complete list of available skills is shown above. You do NOT need to call any tool to get the skills list.',
      'When asked about available skills, simply refer to the list provided in this prompt.',
      '',
      '## How to Use Skills',
      'When you identify that a skill is relevant to the current task:',
      '1. Call the skill using: skill__call({ skillName: "skill-name" })',
      '2. The tool will activate the skill and return its complete SKILL.md instructions',
      '3. Carefully follow all instructions and guidelines in the returned content',
      '4. Apply the skill\'s methodology to complete the task',
      '',
      '## Skill Management Tools',
      'These tools are available for managing skills:',
      '- scan: Scan the skills directory to discover new or updated skills (use this after renaming a skill directory)',
      '- call: Call a skill to activate it and get its complete instructions',
      '- reload: Reload a specific skill after modifying its SKILL.md file (not for name changes)',
    ].join('\n');
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: 'skill',
      displayName: 'Skills 技能',
      description: '由 Skills 核心支持及附属工具，关闭后Agent将不能使用技能',
      isMcp: false,
    };
  }
}
