import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { SkillRegistry } from '../../src/modules/skills/core/skill-registry.service';
import { SkillDefinition, SkillLoadState } from '../../src/modules/skills/interfaces/skill-manifest.interface';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [SkillRegistry],
    }).compile();

    registry = module.get<SkillRegistry>(SkillRegistry);
  });

  describe('register', () => {
    it('应该成功注册新的 Skill', () => {
      const skill: SkillDefinition = {
        id: 'test-skill',
        basePath: '/test/path',
        manifest: {
          name: 'test-skill',
          description: 'Test skill',
          version: '1.0.0',
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'abc123',
      };

      registry.register(skill);

      expect(registry.get('test-skill')).toBeDefined();
      expect(registry.getAll().size).toBe(1);
    });

    it('应该在重复注册时更新现有 Skill', () => {
      const skill1: SkillDefinition = {
        id: 'test-skill',
        basePath: '/test/path',
        manifest: {
          name: 'test-skill',
          description: 'Original',
          version: '1.0.0',
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'hash1',
      };

      const skill2: SkillDefinition = {
        ...skill1,
        manifest: { ...skill1.manifest, description: 'Updated' },
        contentHash: 'hash2',
      };

      registry.register(skill1);
      registry.register(skill2);

      const retrieved = registry.get('test-skill');
      expect(retrieved?.manifest.description).toBe('Updated');
    });
  });

  describe('unregister', () => {
    it('应该成功注销 Skill', () => {
      const skill: SkillDefinition = {
        id: 'test-skill',
        basePath: '/test/path',
        manifest: {
          name: 'test-skill',
          description: 'Test',
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'abc',
      };

      registry.register(skill);
      expect(registry.get('test-skill')).toBeDefined();

      registry.unregister('test-skill');
      expect(registry.get('test-skill')).toBeUndefined();
    });
  });

  describe('searchByTags', () => {
    it('应该按标签搜索 Skills', () => {
      const skill1: SkillDefinition = {
        id: 'skill-1',
        basePath: '/path1',
        manifest: {
          name: 'skill-1',
          description: 'Skill 1',
          tags: ['test', 'alpha'],
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'hash1',
      };

      const skill2: SkillDefinition = {
        id: 'skill-2',
        basePath: '/path2',
        manifest: {
          name: 'skill-2',
          description: 'Skill 2',
          tags: ['test', 'beta'],
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'hash2',
      };

      registry.register(skill1);
      registry.register(skill2);

      const results = registry.searchByTags(['alpha']);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('skill-1');
    });
  });

  describe('onChange listener', () => {
    it('应该在注册时触发事件', () => {
      const listener = jest.fn();
      registry.onChange(listener);

      const skill: SkillDefinition = {
        id: 'test-skill',
        basePath: '/test',
        manifest: {
          name: 'test-skill',
          description: 'Test',
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'abc',
      };

      registry.register(skill);

      expect(listener).toHaveBeenCalledWith({
        type: 'registered',
        skill,
      });
    });

    it('应该支持取消订阅', () => {
      const listener = jest.fn();
      const unsubscribe = registry.onChange(listener);

      unsubscribe();

      const skill: SkillDefinition = {
        id: 'test-skill',
        basePath: '/test',
        manifest: {
          name: 'test-skill',
          description: 'Test',
        },
        loadState: SkillLoadState.DISCOVERED,
        installedAt: new Date(),
        lastModifiedAt: new Date(),
        contentHash: 'abc',
      };

      registry.register(skill);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
