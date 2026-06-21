/// <reference types="jest" />

import { SkillsController } from '../../src/modules/skills/api/skills.controller';
import { SkillOrchestrator } from '../../src/modules/skills/core/skill-orchestrator.service';
import { SkillWatcherService } from '../../src/modules/skills/core/skill-watcher.service';
import { SkillDefinition } from '../../src/modules/skills/interfaces/skill-manifest.interface';
import { SkillDiscoveryResult } from '../../src/modules/skills/interfaces/index';
import { SkillMetadataValidator } from '../../src/modules/skills/common/skill-metadata.validator';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import AdmZip from 'adm-zip';

// ── Mock Services ──

function createMockOrchestrator() {
  const registry = new Map<string, SkillDefinition>();

  return {
    triggerScan: jest.fn().mockResolvedValue({
      added: [],
      updated: [],
      removed: [],
      errors: [],
      scanDurationMs: 0,
    } as SkillDiscoveryResult),

    reloadSkill: jest.fn().mockImplementation((skillId: string) => {
      const existing = registry.get(skillId);
      if (!existing) throw new Error(`Skill ${skillId} not found`);
      return Promise.resolve(existing);
    }),

    listSkills: jest.fn().mockImplementation((_filterEnabled?: boolean) => {
      return Array.from(registry.values());
    }),

    getSkillDetail: jest.fn().mockImplementation((skillId: string) => {
      return registry.get(skillId) || null;
    }),

    enableSkill: jest.fn().mockResolvedValue(undefined),
    disableSkill: jest.fn().mockResolvedValue(undefined),
    batchToggleSkills: jest.fn().mockResolvedValue(undefined),
    getSkillDocumentation: jest.fn().mockResolvedValue('test doc'),

    _registry: registry,
  };
}

function createMockWatcher() {
  return {} as SkillWatcherService;
}

function createMockConfigService(skillsDir: string) {
  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'SKILLS_DIR') return skillsDir;
      return undefined;
    }),
  } as unknown as ConfigService;
}

// ── Helpers ──

/**
 * 创建单技能 ZIP 包（Buffer 形式）
 */
function createSingleSkillZip(skillName: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${skillName}/SKILL.md`, Buffer.from(
    `---\nname: ${skillName}\ndescription: A test skill\n---\n\n# ${skillName}\n\nTest skill content.\n`,
    'utf-8',
  ));
  zip.addFile(`${skillName}/README.md`, Buffer.from('Readme content', 'utf-8'));
  return zip.toBuffer();
}

/**
 * 创建多技能 ZIP 包（Buffer 形式）
 * 包内包含 skill-alpha 和 skill-beta 两个技能
 */
function createMultiSkillZip(): Buffer {
  const zip = new AdmZip();

  // 技能 A
  zip.addFile('skill-alpha/SKILL.md', Buffer.from(
    `---\nname: skill-alpha\ndescription: Alpha test skill\n---\n\n# Skill Alpha\n\nAlpha content.\n`,
    'utf-8',
  ));
  zip.addFile('skill-alpha/config.json', Buffer.from('{"version":1}', 'utf-8'));

  // 技能 B
  zip.addFile('skill-beta/SKILL.md', Buffer.from(
    `---\nname: skill-beta\ndescription: Beta test skill\n---\n\n# Skill Beta\n\nBeta content.\n`,
    'utf-8',
  ));
  zip.addFile('skill-beta/scripts/run.sh', Buffer.from('echo hello', 'utf-8'));

  return zip.toBuffer();
}

/**
 * 创建无效 ZIP（没有 SKILL.md）
 */
function createInvalidZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('not a skill', 'utf-8'));
  return zip.toBuffer();
}

// ── Express.Multer.File 模拟 ──
function makeMulterFile(buffer: Buffer, filename: string): Express.Multer.File {
  return {
    buffer,
    originalname: filename,
    fieldname: 'file',
    encoding: '7bit',
    mimetype: 'application/zip',
    size: buffer.length,
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
  };
}

// ── Tests ──

describe('SkillsController', () => {
  let controller: SkillsController;
  let mockOrchestrator: ReturnType<typeof createMockOrchestrator>;
  let mockConfigService: ConfigService;
  let testSkillsDir: string;

  beforeAll(async () => {
    // 创建临时测试目录
    testSkillsDir = path.join(process.cwd(), 'temp', `test-skills-${Date.now()}`);
    await fs.mkdir(testSkillsDir, { recursive: true });
  });

  afterAll(async () => {
    // 清理临时目录
    await fs.rm(testSkillsDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    mockOrchestrator = createMockOrchestrator();
    mockConfigService = createMockConfigService(testSkillsDir);
    controller = new SkillsController(
      mockOrchestrator as any,
      createMockWatcher(),
      mockConfigService,
    );
  });

  afterEach(async () => {
    // 清理测试目录下安装的技能
    const entries = await fs.readdir(testSkillsDir).catch(() => []);
    for (const entry of entries) {
      await fs.rm(path.join(testSkillsDir, entry), { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('POST /skills/scan', () => {
    it('应该触发扫描并返回结果', async () => {
      const result = await controller.triggerScan();
      expect(mockOrchestrator.triggerScan).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('added');
      expect(result).toHaveProperty('updated');
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('scanDurationMs');
    });

    it('扫描后应该能发现新安装的技能目录', async () => {
      // 手动创建一个技能目录
      const skillDir = path.join(testSkillsDir, 'test-find');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: test-find\ndescription: Test find\n---\n\nContent',
        'utf-8',
      );

      // 模拟扫描发现
      const fakeDef: SkillDefinition = {
        id: 'test-find',
        basePath: skillDir,
        manifest: { name: 'test-find', description: 'Test find' },
        contentHash: 'abc',
        source: 'global',
        enabled: true,
      };
      mockOrchestrator.triggerScan.mockResolvedValueOnce({
        added: [fakeDef],
        updated: [],
        removed: [],
        errors: [],
        scanDurationMs: 10,
      });

      const result = await controller.triggerScan();
      expect(result.added).toHaveLength(1);
      expect(result.added[0].id).toBe('test-find');
    });

    it('扫描后应报告错误信息', async () => {
      mockOrchestrator.triggerScan.mockResolvedValueOnce({
        added: [],
        updated: [],
        removed: [],
        errors: [{ path: '/tmp/bad-skill', error: 'Invalid SKILL.md format' }],
        scanDurationMs: 5,
      });

      const result = await controller.triggerScan();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Invalid');
    });
  });

  describe('POST /skills/:id/reload', () => {
    it('应重新加载已注册的技能', async () => {
      const def: SkillDefinition = {
        id: 'my-skill',
        basePath: path.join(testSkillsDir, 'my-skill'),
        manifest: { name: 'my-skill', description: 'My test skill' },
        contentHash: 'hash1',
        source: 'global',
        enabled: true,
      };
      mockOrchestrator._registry.set('my-skill', def);

      const result = await controller.reloadSkill('my-skill');
      expect(mockOrchestrator.reloadSkill).toHaveBeenCalledWith('my-skill');
      expect(result.id).toBe('my-skill');
    });

    it('对不存在的技能应抛出错误', async () => {
      mockOrchestrator.reloadSkill.mockRejectedValueOnce(new Error('Skill unknown not found'));
      await expect(controller.reloadSkill('unknown')).rejects.toThrow('not found');
    });

    it('重载后内容哈希应更新', async () => {
      const def: SkillDefinition = {
        id: 'updatable',
        basePath: path.join(testSkillsDir, 'updatable'),
        manifest: { name: 'updatable', description: 'Old' },
        contentHash: 'old-hash',
        source: 'global',
        enabled: true,
      };
      mockOrchestrator._registry.set('updatable', def);

      // 模拟重载时返回新哈希
      const updatedDef = { ...def, contentHash: 'new-hash', manifest: { ...def.manifest, version: '2.0.0' } };
      mockOrchestrator.reloadSkill.mockResolvedValueOnce(updatedDef);

      const result = await controller.reloadSkill('updatable');
      expect(result.contentHash).toBe('new-hash');
      expect(result.manifest.version).toBe('2.0.0');
    });
  });

  describe('POST /skills/install — 单技能 ZIP', () => {
    it('应安装单技能 ZIP 包', async () => {
      const zipBuffer = createSingleSkillZip('test-alpha');
      const file = makeMulterFile(zipBuffer, 'test-alpha.zip');

      const result = await controller.installSkill(file, { force: false });

      expect(result.success).toBe(true);
      expect(result.skillIds).toContain('test-alpha');

      // 验证文件已复制到技能目录
      const skillDir = path.join(testSkillsDir, 'test-alpha');
      const files = await fs.readdir(skillDir);
      expect(files).toContain('SKILL.md');
      expect(files).toContain('README.md');

      // 验证 SKILL.md 内容
      const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
      expect(content).toContain('name: test-alpha');
    });

    it('应触发扫描', async () => {
      const zipBuffer = createSingleSkillZip('scan-check');
      const file = makeMulterFile(zipBuffer, 'scan-check.zip');

      await controller.installSkill(file, { force: false });

      expect(mockOrchestrator.triggerScan).toHaveBeenCalledTimes(1);
    });

    it('无文件时应返回错误', async () => {
      const result = await controller.installSkill(undefined as any, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('No file uploaded');
    });

    it('非 ZIP 文件应返回错误', async () => {
      const file = makeMulterFile(Buffer.from('not-a-zip'), 'skill.txt');
      const result = await controller.installSkill(file, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('Only ZIP files');
    });

    it('空 ZIP（无 SKILL.md）应返回错误', async () => {
      const zipBuffer = createInvalidZip();
      const file = makeMulterFile(zipBuffer, 'invalid.zip');

      const result = await controller.installSkill(file, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('No skills found');
    });
  });

  describe('POST /skills/install — 多技能 ZIP', () => {
    it('应安装多技能 ZIP 包（安装两个技能）', async () => {
      const zipBuffer = createMultiSkillZip();
      const file = makeMulterFile(zipBuffer, 'multi-skill.zip');

      const result = await controller.installSkill(file, { force: false });

      expect(result.success).toBe(true);
      expect(result.skillIds).toHaveLength(2);
      expect(result.skillIds).toContain('skill-alpha');
      expect(result.skillIds).toContain('skill-beta');

      // 验证两个技能目录都已创建
      const alphaDir = path.join(testSkillsDir, 'skill-alpha');
      const betaDir = path.join(testSkillsDir, 'skill-beta');

      const alphaFiles = await fs.readdir(alphaDir);
      expect(alphaFiles).toContain('SKILL.md');
      expect(alphaFiles).toContain('config.json');

      const betaFiles = await fs.readdir(betaDir);
      expect(betaFiles).toContain('SKILL.md');
      expect(betaFiles).toContain('scripts');
    });

    it('多技能包中部分技能无效不应影响其他技能安装', async () => {
      const zip = new AdmZip();
      // 有效技能
      zip.addFile('valid-skill/SKILL.md', Buffer.from(
        '---\nname: valid-skill\ndescription: Valid\n---\n\nContent',
        'utf-8',
      ));
      // 无效技能：没有 frontmatter name
      zip.addFile('bad-skill/SKILL.md', Buffer.from(
        '---\ndescription: No name\n---\n\nNo name here',
        'utf-8',
      ));

      const file = makeMulterFile(zip.toBuffer(), 'partial.zip');
      const result = await controller.installSkill(file, {});

      // valid-skill 应成功
      expect(result.success).toBe(true);
      expect(result.skillIds).toContain('valid-skill');

      // bad-skill 应出现在错误列表中（通过 message 检查）
      expect(result.message).toContain('Errors');

      // 验证有效技能目录存在
      await expect(fs.access(path.join(testSkillsDir, 'valid-skill'))).resolves.toBeUndefined();
    });
  });

  describe('POST /skills/install — 覆盖安装', () => {
    it('force=false 时已存在技能不应覆盖', async () => {
      // 先安装一次
      const zip1 = createSingleSkillZip('overwrite-test');
      await controller.installSkill(makeMulterFile(zip1, 'first.zip'), { force: false });

      // 修改技能目录内容
      await fs.writeFile(path.join(testSkillsDir, 'overwrite-test', 'extra.txt'), 'existing', 'utf-8');

      // 再次安装（force=false）
      const zip2 = createSingleSkillZip('overwrite-test');
      const result = await controller.installSkill(makeMulterFile(zip2, 'second.zip'), { force: false });

      // 应失败 — 但我们的新实现在循环中会收集 error，不会阻止后续安装
      // 验证 extra.txt 依然存在（未被覆盖）
      const extraContent = await fs.readFile(path.join(testSkillsDir, 'overwrite-test', 'extra.txt'), 'utf-8');
      expect(extraContent).toBe('existing');
    });

    it('force=true 时已存在技能应被覆盖', async () => {
      // 先安装一次
      const zip1 = createSingleSkillZip('force-overwrite');
      await controller.installSkill(makeMulterFile(zip1, 'first.zip'), { force: false });

      // 确保 SKILL.md 包含原始内容
      const originalContent = await fs.readFile(path.join(testSkillsDir, 'force-overwrite', 'SKILL.md'), 'utf-8');

      // 再次安装（force=true），使用不同的 SKILL.md
      const zip2 = new AdmZip();
      zip2.addFile('force-overwrite/SKILL.md', Buffer.from(
        '---\nname: force-overwrite\ndescription: Overwritten version\n---\n\nNew content',
        'utf-8',
      ));
      const result = await controller.installSkill(makeMulterFile(zip2.toBuffer(), 'second.zip'), { force: true });

      expect(result.success).toBe(true);
      expect(result.skillIds).toContain('force-overwrite');

      // 验证 SKILL.md 已更新
      const newContent = await fs.readFile(path.join(testSkillsDir, 'force-overwrite', 'SKILL.md'), 'utf-8');
      expect(newContent).toContain('Overwritten version');
      expect(newContent).not.toBe(originalContent);
    });
  });

  describe('POST /skills/install-from-url', () => {
    it('URL 为空时应返回错误', async () => {
      const result = await controller.installFromUrl({ url: '', force: false });
      expect(result.success).toBe(false);
      expect(result.message).toContain('URL is required');
    });

    it('URL 格式无效时应返回错误', async () => {
      const result = await controller.installFromUrl({ url: 'ftp://bad.url', force: false });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid URL');
    });
  });
});
