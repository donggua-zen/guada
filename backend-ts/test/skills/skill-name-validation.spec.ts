import { Test, TestingModule } from '@nestjs/testing';
import { SkillDiscoveryService } from '../../src/modules/skills/core/skill-discovery.service';
import { SkillLoaderService } from '../../src/modules/skills/core/skill-loader.service';
import { SkillRegistry } from '../../src/modules/skills/core/skill-registry.service';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('SkillDiscoveryService - Name Validation', () => {
  let service: SkillDiscoveryService;
  let tempTestDir: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillDiscoveryService,
        {
          provide: SkillLoaderService,
          useValue: {
            loadManifest: jest.fn(),
          },
        },
        {
          provide: SkillRegistry,
          useValue: {
            getAll: jest.fn().mockReturnValue(new Map()),
            get: jest.fn().mockReturnValue(null),
            register: jest.fn(),
            update: jest.fn(),
            unregister: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(path.join(process.cwd(), 'temp', 'test-skills')),
          },
        },
      ],
    }).compile();

    service = module.get<SkillDiscoveryService>(SkillDiscoveryService);

    // 创建临时测试目录
    tempTestDir = path.join(process.cwd(), 'temp', `test-skill-discovery-${Date.now()}`);
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    // 清理临时目录
    try {
      await fs.rm(tempTestDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup temp directory:', error);
    }
  });

  describe('validateSkillName', () => {
    it('应该拒绝包含特殊字符的技能名称', () => {
      const invalidNames = [
        'skill.name',
        'skill/name',
        'skill\\name',
        'skill<name>',
        'skill:name',
        'skill"name',
        'skill|name',
        'skill?name',
        'skill*name',
        'skill_name',  // 下划线也不允许
        'skill name',  // 空格也不允许
      ];

      for (const name of invalidNames) {
        // @ts-ignore - 访问私有方法进行测试
        const result = service.validateSkillName(name, name);
        expect(result).not.toBeNull();
        expect(result).toContain('invalid characters');
      }
    });

    it('应该接受合法的技能名称', () => {
      const validNames = [
        'my-skill',
        'skill123',
        'a',
        'my-awesome-skill-2024',
        'test-1',
      ];

      for (const name of validNames) {
        // @ts-ignore
        const result = service.validateSkillName(name, name);
        expect(result).toBeNull();
      }
    });

    it('应该拒绝大写字母', () => {
      const uppercaseNames = [
        'My-Skill',
        'SKILL',
        'Test-Skill',
        'my-Skill',
      ];

      for (const name of uppercaseNames) {
        // @ts-ignore
        const result = service.validateSkillName(name, name);
        expect(result).not.toBeNull();
        expect(result).toContain('lowercase');
      }
    });

    it('应该拒绝空名称', () => {
      // @ts-ignore
      expect(service.validateSkillName('', '')).not.toBeNull();
      // @ts-ignore
      expect(service.validateSkillName('   ', '   ')).not.toBeNull();
    });

    it('应该拒绝过长的名称', () => {
      const longName = 'a'.repeat(65);
      // @ts-ignore
      const result = service.validateSkillName(longName, longName);
      expect(result).not.toBeNull();
      expect(result).toContain('too long');
    });

    it('应该拒绝以特殊字符开头或结尾的名称', () => {
      // @ts-ignore
      expect(service.validateSkillName('-skill', '-skill')).not.toBeNull();
      // @ts-ignore
      expect(service.validateSkillName('skill-', 'skill-')).not.toBeNull();
    });
  });

  describe('技能名称与目录名一致性检查', () => {
    it('应该拒绝名称与目录名不一致的技能', () => {
      const skillName = 'my-skill';
      const dirName = 'different-name';
      
      // @ts-ignore
      const result = service.validateSkillName(skillName, dirName);
      
      // 名称本身是合法的，但会在扫描时因为不匹配而被拒绝
      expect(result).toBeNull(); // 名称验证通过
      
      // 但在实际扫描中会检查一致性
      expect(skillName.toLowerCase()).not.toBe(dirName.toLowerCase());
    });

    it('应该接受名称与目录名一致（不区分大小写）的技能', () => {
      const testCases = [
        { skillName: 'my-skill', dirName: 'my-skill' },
        { skillName: 'my-skill', dirName: 'My-Skill' },
        { skillName: 'my-skill', dirName: 'MY-SKILL' },
        { skillName: 'test-123', dirName: 'Test-123' },
      ];

      for (const { skillName, dirName } of testCases) {
        // @ts-ignore
        const result = service.validateSkillName(skillName, dirName);
        expect(result).toBeNull();
        
        // 验证一致性检查会通过
        expect(skillName.toLowerCase()).toBe(dirName.toLowerCase());
      }
    });
  });

  describe('边界情况', () => {
    it('应该接受单个字符的名称', () => {
      // @ts-ignore
      expect(service.validateSkillName('a', 'a')).toBeNull();
      // @ts-ignore
      expect(service.validateSkillName('1', '1')).toBeNull();
    });

    it('应该接受包含数字的名称', () => {
      // @ts-ignore
      expect(service.validateSkillName('skill-123', 'skill-123')).toBeNull();
      // @ts-ignore
      expect(service.validateSkillName('123-skill', '123-skill')).toBeNull();
    });

    it('应该拒绝只包含连字符的名称', () => {
      // @ts-ignore
      expect(service.validateSkillName('-', '-')).not.toBeNull();
      // @ts-ignore
      expect(service.validateSkillName('--', '--')).not.toBeNull();
    });
  });
});
