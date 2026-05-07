import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { SkillLoaderService } from '../../src/modules/skills/core/skill-loader.service';

describe('SkillLoaderService - YAML Parsing Fix', () => {
  let service: SkillLoaderService;
  const testSkillsDir = path.join(__dirname, '../fixtures/skills');

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ SKILLS_DIR: testSkillsDir })],
        }),
      ],
      providers: [SkillLoaderService],
    }).compile();

    service = module.get<SkillLoaderService>(SkillLoaderService);
  });

  describe('parseSimpleYaml - Multiline String Support', () => {
    it('应该正确解析使用 > 的多行字符串', () => {
      const yamlContent = `name: test-skill
description: >
  This is a multiline
  description that should
  be joined together
version: 1.0.0`;

      // 通过反射调用私有方法进行测试
      const result = (service as any).parseSimpleYaml(yamlContent);

      expect(result.name).toBe('test-skill');
      expect(result.description).toContain('This is a multiline');
      expect(result.description).toContain('description that should');
      expect(result.description).toContain('be joined together');
      expect(result.version).toBe('1.0.0');
    });

    it('应该正确解析数组', () => {
      const yamlContent = `name: test-skill
tags:
  - tag1
  - tag2
  - tag3`;

      const result = (service as any).parseSimpleYaml(yamlContent);

      expect(result.name).toBe('test-skill');
      expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('应该正确解析带引号的字符串', () => {
      const yamlContent = `name: "quoted-name"
description: 'single quoted'`;

      const result = (service as any).parseSimpleYaml(yamlContent);

      expect(result.name).toBe('quoted-name');
      expect(result.description).toBe('single quoted');
    });

    it('应该处理混合内容', () => {
      const yamlContent = `name: example-skill
description: >
  示例 Skill，用于演示 Skills 框架的基本功能。
  包含简单的文本处理工具和最佳实践指南。
version: 1.0.0
author: AI Chat Team
tags:
  - example
  - demo
  - tutorial`;

      const result = (service as any).parseSimpleYaml(yamlContent);

      expect(result.name).toBe('example-skill');
      expect(result.description).toContain('示例 Skill');
      expect(result.description).toContain('基本功能');
      expect(result.version).toBe('1.0.0');
      expect(result.author).toBe('AI Chat Team');
      expect(result.tags).toEqual(['example', 'demo', 'tutorial']);
    });
  });

  describe('loadManifest - Real File Test', () => {
    it('应该成功加载 example-skill（包含多行描述）', async () => {
      const skillPath = path.join(__dirname, '../../skills/example-skill');
      
      try {
        const skill = await service.loadManifest(skillPath);

        expect(skill).toBeDefined();
        expect(skill.id).toBe('example-skill');
        expect(skill.manifest.name).toBe('example-skill');
        
        // 验证多行描述被正确解析
        expect(skill.manifest.description).toBeDefined();
        expect(skill.manifest.description.length).toBeGreaterThan(0);
        expect(skill.manifest.description).toContain('示例 Skill');
        
        expect(skill.manifest.version).toBe('1.0.0');
        expect(skill.manifest.author).toBe('AI Chat Team');
        expect(skill.manifest.tags).toEqual(['example', 'demo', 'tutorial']);
      } catch (error) {
        console.error('加载失败:', error);
        throw error;
      }
    });
  });
});
