import { Test, TestingModule } from '@nestjs/testing';
import { SkillsController } from '../../src/modules/skills/api/skills.controller';
import { SkillOrchestrator } from '../../src/modules/skills/core/skill-orchestrator.service';
import { SkillWatcherService } from '../../src/modules/skills/core/skill-watcher.service';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import AdmZip from 'adm-zip';

describe('SkillsController - Smart Installation', () => {
  let controller: SkillsController;
  let orchestrator: SkillOrchestrator;
  let tempTestDir: string;

  beforeAll(async () => {
    const tempSkillsDir = path.join(process.cwd(), 'temp', `test-skills-${Date.now()}`);
    
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SkillsController],
      providers: [
        {
          provide: SkillOrchestrator,
          useValue: {
            triggerScan: jest.fn().mockResolvedValue(undefined),
            listSkills: jest.fn().mockReturnValue([]),
            getSkillDetail: jest.fn().mockReturnValue(null),
            getSkillDocumentation: jest.fn().mockResolvedValue(''),
            reloadSkill: jest.fn(),
          },
        },
        {
          provide: SkillWatcherService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(tempSkillsDir),
          },
        },
      ],
    }).compile();

    controller = module.get<SkillsController>(SkillsController);
    orchestrator = module.get<SkillOrchestrator>(SkillOrchestrator);

    // 创建临时测试目录
    tempTestDir = path.join(process.cwd(), 'temp', `test-skill-install-${Date.now()}`);
    await fs.mkdir(tempTestDir, { recursive: true });
    
    // 创建临时 skills 目录
    await fs.mkdir(tempSkillsDir, { recursive: true });
  });

  afterAll(async () => {
    // 清理临时目录
    try {
      await fs.rm(tempTestDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup temp directory:', error);
    }
  });

  describe('findSkillWithSmartLevel', () => {
    it('应该在当前目录找到 SKILL.md', async () => {
      const testDir = path.join(tempTestDir, 'level0-test');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'SKILL.md'), '# Test Skill');

      // @ts-ignore
      const result = await controller.findSkillWithSmartLevel(testDir);
      
      expect(result).not.toBeNull();
      expect(result?.skillName).toBe('level0-test');
      expect(result?.skillMdPath).toBe(path.join(testDir, 'SKILL.md'));
    });

    it('应该在一级子目录找到 SKILL.md', async () => {
      const testDir = path.join(tempTestDir, 'level1-parent');
      const subDir = path.join(testDir, 'my-skill');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, 'SKILL.md'), '# Test Skill');

      // @ts-ignore
      const result = await controller.findSkillWithSmartLevel(testDir);
      
      expect(result).not.toBeNull();
      expect(result?.skillName).toBe('my-skill');
      expect(result?.skillMdPath).toBe(path.join(subDir, 'SKILL.md'));
    });

    it('不应该在二级以下子目录查找', async () => {
      const testDir = path.join(tempTestDir, 'level2-parent');
      const level1Dir = path.join(testDir, 'level1');
      const level2Dir = path.join(level1Dir, 'level2');
      await fs.mkdir(level2Dir, { recursive: true });
      await fs.writeFile(path.join(level2Dir, 'SKILL.md'), '# Test Skill');

      // @ts-ignore
      const result = await controller.findSkillWithSmartLevel(testDir);
      
      expect(result).toBeNull();
    });

    it('应该返回第一个找到的 SKILL.md', async () => {
      const testDir = path.join(tempTestDir, 'multiple-skills');
      const skill1Dir = path.join(testDir, 'skill-alpha');
      const skill2Dir = path.join(testDir, 'skill-beta');
      
      await fs.mkdir(skill1Dir, { recursive: true });
      await fs.mkdir(skill2Dir, { recursive: true });
      
      await fs.writeFile(path.join(skill1Dir, 'SKILL.md'), '# Skill Alpha');
      await fs.writeFile(path.join(skill2Dir, 'SKILL.md'), '# Skill Beta');

      // @ts-ignore
      const result = await controller.findSkillWithSmartLevel(testDir);
      
      expect(result).not.toBeNull();
      // 应该返回第一个找到的（按文件系统顺序）
      expect(['skill-alpha', 'skill-beta']).toContain(result?.skillName);
    });

    it('当没有 SKILL.md 时应该返回 null', async () => {
      const testDir = path.join(tempTestDir, 'no-skill');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'README.md'), '# No Skill Here');

      // @ts-ignore
      const result = await controller.findSkillWithSmartLevel(testDir);
      
      expect(result).toBeNull();
    });

    it('应该跳过隐藏目录和 node_modules', async () => {
      const testDir = path.join(tempTestDir, 'skip-dirs');
      const hiddenDir = path.join(testDir, '.hidden');
      const nodeModulesDir = path.join(testDir, 'node_modules');
      const validDir = path.join(testDir, 'valid-skill');
      
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.mkdir(nodeModulesDir, { recursive: true });
      await fs.mkdir(validDir, { recursive: true });
      
      await fs.writeFile(path.join(hiddenDir, 'SKILL.md'), '# Hidden');
      await fs.writeFile(path.join(nodeModulesDir, 'SKILL.md'), '# Node Modules');
      await fs.writeFile(path.join(validDir, 'SKILL.md'), '# Valid');

      // @ts-ignore
      const result = await controller.findSkillWithSmartLevel(testDir);
      
      expect(result).not.toBeNull();
      expect(result?.skillName).toBe('valid-skill');
    });
  });

  describe('installSkill with force parameter', () => {
    it('应该接受 force 参数', async () => {
      // 创建一个简单的 ZIP 文件用于测试
      const zip = new AdmZip();
      const skillDir = 'test-skill';
      
      // 创建包含 YAML frontmatter 的 SKILL.md
      const skillMdContent = `---
name: test-skill
description: A test skill for testing
---

# Test Skill

This is a test skill.`;
      
      zip.addFile(`${skillDir}/SKILL.md`, Buffer.from(skillMdContent));
      
      const zipBuffer = zip.toBuffer();
      
      const mockFile = {
        originalname: 'test-skill.zip',
        buffer: zipBuffer,
      } as Express.Multer.File;

      // 首次安装
      const result1 = await controller.installSkill(mockFile, { force: false });
      expect(result1.success).toBe(true);

      // 尝试再次安装（不强制）
      const result2 = await controller.installSkill(mockFile, { force: false });
      expect(result2.success).toBe(false);
      expect(result2.message).toContain('already exists');

      // 强制覆盖安装
      const result3 = await controller.installSkill(mockFile, { force: true });
      expect(result3.success).toBe(true);
      expect(result3.message).toContain('overwritten');

      // 清理
      const skillPath = path.join(process.cwd(), 'skills', 'test-skill');
      await fs.rm(skillPath, { recursive: true, force: true });
    });
  });
});
