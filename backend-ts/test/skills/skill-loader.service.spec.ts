import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';
import { SkillLoaderService } from '../../src/modules/skills/core/skill-loader.service';
import { SkillDefinition, SkillLoadState } from '../../src/modules/skills/interfaces/skill-manifest.interface';

describe('SkillLoaderService', () => {
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

  describe('loadManifest', () => {
    it('应该成功加载有效的 SKILL.md 文件', async () => {
      const skillPath = path.join(testSkillsDir, 'test-skill-alpha');
      const skill = await service.loadManifest(skillPath);

      expect(skill).toBeDefined();
      expect(skill.id).toBe('test-skill-alpha');
      expect(skill.manifest.name).toBe('test-skill-alpha');
      expect(skill.manifest.description).toContain('测试用 Skill Alpha');
      expect(skill.manifest.version).toBe('1.0.0');
      expect(skill.manifest.author).toBe('Test Team');
      expect(skill.manifest.tags).toEqual(['test', 'alpha']);
      expect(skill.loadState).toBe(SkillLoadState.DISCOVERED);
      expect(skill.contentHash).toBeDefined();
      expect(skill.contentHash.length).toBe(64); // SHA256 哈希长度
    });

    it('应该加载包含脚本的 Skill', async () => {
      const skillPath = path.join(testSkillsDir, 'test-skill-beta');
      const skill = await service.loadManifest(skillPath);

      expect(skill.id).toBe('test-skill-beta');
      expect(skill.manifest.version).toBe('2.1.0');
      expect(skill.manifest.tags).toContain('scripts');
    });

    it('应该在文件不存在时抛出错误', async () => {
      const invalidPath = path.join(testSkillsDir, 'non-existent-skill');
      await expect(service.loadManifest(invalidPath)).rejects.toThrow();
    });
  });

  describe('loadInstructions', () => {
    it('应该惰性加载 L2 指令内容', async () => {
      const skillPath = path.join(testSkillsDir, 'test-skill-alpha');
      const skill = await service.loadManifest(skillPath);

      // 初始状态不应有 instructions
      expect(skill.instructions).toBeUndefined();

      // 加载指令
      const instructions = await service.loadInstructions(skill);

      expect(instructions).toBeDefined();
      expect(instructions).toContain('# Test Skill Alpha');
      expect(skill.loadState).toBe(SkillLoadState.LOADED);
      expect(skill.instructions).toBe(instructions);
    });

    it('应该缓存已加载的指令', async () => {
      const skillPath = path.join(testSkillsDir, 'test-skill-alpha');
      const skill = await service.loadManifest(skillPath);

      // 第一次加载
      const instructions1 = await service.loadInstructions(skill);

      // 第二次加载应返回缓存的内容
      const instructions2 = await service.loadInstructions(skill);

      expect(instructions1).toBe(instructions2);
    });
  });

  describe('reloadManifest', () => {
    it('应该重新加载 Manifest 并检测变更', async () => {
      const skillPath = path.join(testSkillsDir, 'test-skill-alpha');
      const skill = await service.loadManifest(skillPath);
      const originalHash = skill.contentHash;

      // 重新加载（文件未变，哈希应相同）
      const reloaded = await service.reloadManifest(skill);

      expect(reloaded.contentHash).toBe(originalHash);
    });
  });

  describe('computeContentHash', () => {
    it('应该为相同内容生成相同的哈希', () => {
      const content = 'test content';
      const hash1 = service.computeContentHash(content);
      const hash2 = service.computeContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('应该为不同内容生成不同的哈希', () => {
      const hash1 = service.computeContentHash('content 1');
      const hash2 = service.computeContentHash('content 2');

      expect(hash1).not.toBe(hash2);
    });
  });
});
