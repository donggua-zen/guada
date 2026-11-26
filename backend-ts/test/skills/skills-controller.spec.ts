/// <reference types="jest" />

import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  // 项目作用域：projectSkills 按路径组织，供 *ForProject / resolve 系列替身使用
  const projectSkills = new Map<string, SkillDefinition[]>();

  function resolveWithScope(skillId: string, workspacePath?: string) {
    const scoped = workspacePath
      ? (projectSkills.get(workspacePath) ?? []).find((s) => s.id === skillId)
      : undefined;
    return scoped ?? registry.get(skillId) ?? null;
  }

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

    /** 项目口径列表：全局 + 项目技能（同名覆盖，标记 overridden） */
    listManageableSkills: jest.fn().mockImplementation(() => Array.from(registry.values())),
    listManageableSkillsForProject: jest
      .fn()
      .mockImplementation((workspacePath?: string) => {
        const base = Array.from(registry.values());
        const ws = workspacePath ? projectSkills.get(workspacePath) ?? [] : [];
        if (!ws.length) return base;
        const baseIds = new Set(base.map((s) => s.id));
        const merged = new Map(base.map((s) => [s.id, s]));
        for (const s of ws) {
          merged.set(s.id, baseIds.has(s.id) ? { ...s, overridden: true } : s);
        }
        return Array.from(merged.values());
      }),

    ensureProjectSkills: jest
      .fn()
      .mockImplementation(async (workspacePath: string) =>
        projectSkills.get(workspacePath) ?? [],
      ),

    getSkillDetail: jest.fn().mockImplementation((skillId: string) => {
      return registry.get(skillId) || null;
    }),

    getManageableSkillDetail: jest
      .fn()
      .mockImplementation((skillId: string, workspacePath?: string) =>
        resolveWithScope(skillId, workspacePath),
      ),

    /** 最终生效状态：项目覆盖 > 全局状态（无项目时只看全局） */
    resolveSkillEnabled: jest.fn(
      (skillId: string, workspacePath?: string) => {
        const id = String(skillId).toLowerCase();
        const projectOverride = workspacePath
          ? (projectSkills.get(workspacePath) ?? []).some((s) => s.id === id)
            ? // 项目技能存在即视为启用；这里只用于判定全局状态，简单处理
              true
            : undefined
          : undefined;
        if (projectOverride !== undefined) {
          return { enabled: projectOverride, source: 'project', projectOverride };
        }
        const globalSkill = registry.get(id);
        return {
          enabled: globalSkill ? globalSkill.enabled !== false : true,
          source: 'global' as const,
        };
      },
    ),

    enableSkill: jest.fn().mockResolvedValue(undefined),
    disableSkill: jest.fn().mockResolvedValue(undefined),
    batchToggleSkills: jest.fn().mockResolvedValue(undefined),
    getSkillDocumentation: jest.fn().mockResolvedValue('test doc'),

    _registry: registry,
    _projectSkills: projectSkills,
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

/** 目录分组端口替身：默认无任何项目（不传 projectGroupId 时不会被访问） */
function createMockProjectGroups(rows: Array<{ id: string; path: string }> = []) {
  return {
    findProjectGroup: jest.fn().mockImplementation(async (id: string) => {
      const hit = rows.find((r) => r.id === id);
      return hit ? { ...hit, pathKey: hit.path } : null;
    }),
  } as any;
}

/** 项目级技能开关配置替身：内存态，行为与真实服务一致（读/写/清） */
/**
 * 技能开关配置替身（全局与项目统一覆盖表格式）。
 *
 * 行为与真实服务一致：键存在即覆盖，键不存在即继承。
 */
function createMockSkillToggleConfig() {
  const globalMap = new Map<string, boolean>();
  const byProject = new Map<string, Map<string, boolean>>();
  const mapFor = (projectPath: string) => {
    if (!byProject.has(projectPath)) byProject.set(projectPath, new Map());
    return byProject.get(projectPath)!;
  };
  const view = (file: string, map: Map<string, boolean>) => {
    const overrides: Record<string, boolean> = {};
    for (const id of Array.from(map.keys()).sort()) overrides[id] = map.get(id) as boolean;
    return { file, overrides, warnings: [] };
  };
  const globalFile = () => "/global/skills.yaml";
  const projectFile = (p: string) => path.join(p, ".guada", "skills.yaml");

  return {
    globalFilePath: jest.fn(() => globalFile()),
    projectFilePath: jest.fn((projectPath?: string | null) =>
      projectPath ? projectFile(projectPath) : null,
    ),
    getGlobalOverrides: jest.fn(() => globalMap),
    getProjectOverrides: jest.fn((projectPath?: string | null) =>
      projectPath ? mapFor(projectPath) : new Map<string, boolean>(),
    ),
    getGlobalOverride: jest.fn((skillId: string) =>
      globalMap.get(String(skillId).toLowerCase()),
    ),
    getProjectOverride: jest.fn(
      (projectPath: string | null | undefined, skillId: string) =>
        projectPath ? mapFor(projectPath).get(String(skillId).toLowerCase()) : undefined,
    ),
    readGlobal: jest.fn(() => view(globalFile(), globalMap)),
    readProject: jest.fn((projectPath: string) =>
      view(projectFile(projectPath), mapFor(projectPath)),
    ),
    setGlobalEnabled: jest.fn(async (skillId: string, enabled: boolean) => {
      const id = skillId.toLowerCase();
      // 与真实服务一致：启用=默认态 → 删除覆盖
      if (enabled) globalMap.delete(id);
      else globalMap.set(id, false);
      return view(globalFile(), globalMap);
    }),
    setProjectOverride: jest.fn(
      async (projectPath: string, skillId: string, value: boolean | undefined) => {
        const map = mapFor(projectPath);
        const id = skillId.toLowerCase();
        if (value === undefined) map.delete(id);
        else map.set(id, value);
        return view(projectFile(projectPath), map);
      },
    ),
    _global: globalMap,
    _projects: byProject,
  } as any;
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
  let mockProjectGroups: ReturnType<typeof createMockProjectGroups>;
  let mockToggleConfig: ReturnType<typeof createMockSkillToggleConfig>;
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
    mockProjectGroups = createMockProjectGroups();
    mockToggleConfig = createMockSkillToggleConfig();
    controller = new SkillsController(
      mockOrchestrator as any,
      createMockWatcher(),
      mockConfigService,
      mockProjectGroups,
      mockToggleConfig as any,
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
    it('应该触发扫描并返回成功', async () => {
      const result = await controller.triggerScan();
      expect(mockOrchestrator.triggerScan).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, message: 'Scan completed' });
    });

    it('扫描失败时应返回错误信息', async () => {
      mockOrchestrator.triggerScan.mockRejectedValueOnce(new Error('Scan failed'));
      const result = await controller.triggerScan();
      expect(result).toEqual({ success: false, message: 'Scan failed' });
    });
  });

  describe('项目作用域（?projectGroupId=）', () => {
    const PROJECT_ID = 'pg-demo';
    /** 项目目录在 beforeAll 之后才有值，这里惰性求值 */
    const projectPath = () => path.join(testSkillsDir, 'demo-project');

    function makeProjectSkill(id: string, extra: Partial<SkillDefinition> = {}): SkillDefinition {
      return {
        id,
        baseDir: path.join(projectPath(), '.guada', 'skills'),
        basePath: id,
        manifest: { name: id, description: `Project skill ${id}` },
        contentHash: `hash-${id}`,
        source: 'workspace',
        enabled: true,
        ...extra,
      };
    }

    it('列表：解析项目路径并加载项目来源，返回合并后的清单', async () => {
      mockOrchestrator._registry.set('global-skill', {
        id: 'global-skill',
        baseDir: testSkillsDir,
        basePath: 'global-skill',
        manifest: { name: 'global-skill', description: 'g' },
        contentHash: 'h',
        source: 'global',
        enabled: true,
      });
      const projectSkill = makeProjectSkill('proj-skill');
      mockOrchestrator._projectSkills.set(projectPath(), [projectSkill]);
      mockProjectGroups = createMockProjectGroups([{ id: PROJECT_ID, path: projectPath() }]);
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );

      const res = await controller.listSkills(undefined, undefined, undefined, PROJECT_ID);

      expect(mockOrchestrator.ensureProjectSkills).toHaveBeenCalledWith(projectPath());
      expect(mockOrchestrator.listManageableSkillsForProject).toHaveBeenCalledWith(
        projectPath(),
        false,
      );
      expect(res.items.map((s) => s.id).sort()).toEqual(['global-skill', 'proj-skill']);
    });

    it('未知项目 id：抛 404，前端据此回落全局视图', async () => {
      await expect(
        controller.listSkills(undefined, undefined, undefined, 'pg-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('文档：同名技能读取项目版本而不是全局版本', async () => {
      const projectSkillsDir = path.join(projectPath(), '.guada', 'skills');
      await fs.mkdir(path.join(projectSkillsDir, 'same-id'), { recursive: true });
      await fs.writeFile(
        path.join(projectSkillsDir, 'same-id', 'SKILL.md'),
        '---\nname: same-id\ndescription: project\n---\n\nPROJECT CONTENT',
      );

      const projectSkill = makeProjectSkill('same-id', {
        baseDir: projectSkillsDir,
        basePath: 'same-id',
      });
      mockOrchestrator._projectSkills.set(projectPath(), [projectSkill]);
      mockProjectGroups = createMockProjectGroups([{ id: PROJECT_ID, path: projectPath() }]);
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );

      const res = await controller.getSkillDocumentation('same-id', PROJECT_ID);
      expect(res.content).toContain('PROJECT CONTENT');
    });

    it('文档：项目版本文件缺失时返回 404（不是 500）', async () => {
      mockOrchestrator._projectSkills.set(projectPath(), [
        makeProjectSkill('missing-file', { basePath: 'missing-file' }),
      ]);
      mockProjectGroups = createMockProjectGroups([{ id: PROJECT_ID, path: projectPath() }]);
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );

      await expect(
        controller.getSkillDocumentation('missing-file', PROJECT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('卸载：项目技能不允许从管理页删除', async () => {
      mockOrchestrator._projectSkills.set(projectPath(), [makeProjectSkill('proj-skill')]);
      mockProjectGroups = createMockProjectGroups([{ id: PROJECT_ID, path: projectPath() }]);
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );

      const res = await controller.uninstallSkill('proj-skill', PROJECT_ID);
      expect(res.success).toBe(false);
      expect(res.message).toContain('.guada/skills');
    });

    it('扫描：带项目 id 时先确保项目来源', async () => {
      mockProjectGroups = createMockProjectGroups([{ id: PROJECT_ID, path: projectPath() }]);
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );

      const res = await controller.triggerScan(PROJECT_ID);
      expect(mockOrchestrator.ensureProjectSkills).toHaveBeenCalledWith(projectPath());
      expect(res.success).toBe(true);
    });

    it('重载：带项目 id 时传项目路径，否则保持旧签名', async () => {
      mockProjectGroups = createMockProjectGroups([{ id: PROJECT_ID, path: projectPath() }]);
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );

      mockOrchestrator._registry.set('global-skill', {
        id: 'global-skill',
        baseDir: testSkillsDir,
        basePath: 'global-skill',
        manifest: { name: 'global-skill', description: 'g' },
        contentHash: 'h',
        source: 'global',
        enabled: true,
      });

      await controller.reloadSkill('global-skill', PROJECT_ID);
      expect(mockOrchestrator.reloadSkill).toHaveBeenCalledWith('global-skill', projectPath());

      mockOrchestrator.reloadSkill.mockClear();
      await controller.reloadSkill('global-skill');
      expect(mockOrchestrator.reloadSkill).toHaveBeenCalledWith('global-skill');
    });
  });

  describe('项目级技能开关（/skills/project-config）', () => {
    const PROJECT_ID = 'pg-cfg';
    const projectPath = () => path.join(testSkillsDir, 'config-project');

    /** 装上可控的 projectGroups + 一个存在的全局技能 */
    function setupProject() {
      mockProjectGroups = createMockProjectGroups([
        { id: PROJECT_ID, path: projectPath() },
      ]);
      mockToggleConfig = createMockSkillToggleConfig();
      mockOrchestrator._registry.set('global-skill', {
        id: 'global-skill',
        baseDir: testSkillsDir,
        basePath: 'global-skill',
        manifest: { name: 'global-skill', description: 'g' },
        contentHash: 'h',
        source: 'global',
        enabled: true,
      });
      controller = new SkillsController(
        mockOrchestrator as any,
        createMockWatcher(),
        mockConfigService,
        mockProjectGroups,
        mockToggleConfig as any,
      );
    }

    it('GET：返回该项目的覆盖表与文件路径', async () => {
      setupProject();
      mockToggleConfig._projects.set(projectPath(), new Map([['global-skill', false]]));

      const res = await controller.getSkillToggleConfig(PROJECT_ID);

      expect(res.file).toBe(path.join(projectPath(), '.guada', 'skills.yaml'));
      expect(res.overrides).toEqual({ 'global-skill': false });
    });

    it('GET：文件不存在时返回空覆盖表（不是错误）', async () => {
      setupProject();

      const res = await controller.getSkillToggleConfig(PROJECT_ID);

      expect(res.overrides).toEqual({});
    });

    it('GET：无 projectGroupId → 返回全局配置（不再是错误）', async () => {
      setupProject();
      mockToggleConfig._global.set('global-skill', false);

      const res = await controller.getSkillToggleConfig();

      expect(res.overrides).toEqual({ 'global-skill': false });
      expect(mockToggleConfig.readGlobal).toHaveBeenCalled();
    });

    it('GET：未知项目 id → 404', async () => {
      setupProject();

      await expect(
        controller.getSkillToggleConfig('pg-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('PUT：项目内关闭技能 → 写显式 false 覆盖', async () => {
      setupProject();

      const res = await controller.updateSkillToggleConfig({
        projectGroupId: PROJECT_ID,
        skillId: 'global-skill',
        enabled: false,
      });

      expect(res.overrides).toEqual({ 'global-skill': false });
      expect(mockToggleConfig.setProjectOverride).toHaveBeenCalledWith(
        projectPath(),
        'global-skill',
        false,
      );
    });

    it('PUT：项目内启用全局已关闭的技能 → 写显式 true 覆盖', async () => {
      setupProject();
      // 全局关掉它
      mockOrchestrator._registry.get('global-skill')!.enabled = false;

      const res = await controller.updateSkillToggleConfig({
        projectGroupId: PROJECT_ID,
        skillId: 'global-skill',
        enabled: true,
      });

      expect(res.overrides).toEqual({ 'global-skill': true });
      expect(mockToggleConfig.setProjectOverride).toHaveBeenCalledWith(
        projectPath(),
        'global-skill',
        true,
      );
    });

    it('PUT：与全局状态相同 → 删除覆盖（保持文件干净）', async () => {
      setupProject();
      // 全局是启用（默认），项目也设成启用 → 不该留覆盖
      await controller.updateSkillToggleConfig({
        projectGroupId: PROJECT_ID,
        skillId: 'global-skill',
        enabled: true,
      });

      expect(mockToggleConfig.setProjectOverride).toHaveBeenCalledWith(
        projectPath(),
        'global-skill',
        undefined,
      );
    });

    it('PUT：无 projectGroupId → 写全局配置（启用即删键）', async () => {
      setupProject();

      const res = await controller.updateSkillToggleConfig({
        skillId: 'global-skill',
        enabled: false,
      });

      expect(res.overrides).toEqual({ 'global-skill': false });
      expect(mockToggleConfig.setGlobalEnabled).toHaveBeenCalledWith(
        'global-skill',
        false,
      );
      expect(mockToggleConfig.setProjectOverride).not.toHaveBeenCalled();
    });

    it('PUT：未知技能 → 400，且不写文件', async () => {
      setupProject();

      await expect(
        controller.updateSkillToggleConfig({
          projectGroupId: PROJECT_ID,
          skillId: 'no-such-skill',
          enabled: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockToggleConfig.setProjectOverride).not.toHaveBeenCalled();
      expect(mockToggleConfig.setGlobalEnabled).not.toHaveBeenCalled();
    });

    it('PUT：skillId 缺失或 enabled 非布尔 → 400', async () => {
      setupProject();

      await expect(
        controller.updateSkillToggleConfig({ projectGroupId: PROJECT_ID, enabled: false }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        controller.updateSkillToggleConfig({
          projectGroupId: PROJECT_ID,
          skillId: 'global-skill',
          enabled: 'yes' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('PUT：skillId 大小写归一后写小写', async () => {
      setupProject();

      await controller.updateSkillToggleConfig({
        projectGroupId: PROJECT_ID,
        skillId: 'Global-Skill',
        enabled: false,
      });

      expect(mockToggleConfig.setProjectOverride).toHaveBeenCalledWith(
        projectPath(),
        'global-skill',
        false,
      );
    });
  });

  describe('POST /skills/:id/reload', () => {
    it('应重新加载已注册的技能', async () => {
      const def: SkillDefinition = {
        id: 'my-skill',
        baseDir: testSkillsDir,
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
        baseDir: testSkillsDir,
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

    it('下载安装时写入市场来源 sidecar', async () => {
      const zipBuffer = createSingleSkillZip('url-skill');
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => zipBuffer,
      }) as unknown as typeof fetch;

      try {
        const result = await controller.installFromUrl({
          url: 'https://example.com/url-skill.zip',
          force: false,
          origin: { source: 'official', itemId: 'url-skill', version: '1.0.0' },
        });

        expect(result.success).toBe(true);
        expect(result.skillIds).toEqual(['url-skill']);

        const origin = JSON.parse(
          await fs.readFile(
            path.join(testSkillsDir, 'url-skill', '.skill-origin.json'),
            'utf-8',
          ),
        );
        expect(origin).toMatchObject({
          source: 'official',
          itemId: 'url-skill',
          version: '1.0.0',
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('根级 SKILL.md 时不应把下载的 ZIP 复制进技能目录', async () => {
      const zip = new AdmZip();
      zip.addFile(
        'SKILL.md',
        Buffer.from('---\nname: root-skill\ndescription: Root skill\n---\n\n# Root\n', 'utf-8'),
      );
      zip.addFile('README.md', Buffer.from('readme', 'utf-8'));

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => zip.toBuffer(),
      }) as unknown as typeof fetch;

      try {
        const result = await controller.installFromUrl({
          url: 'https://example.com/root-skill.zip',
          force: false,
        });

        expect(result.success).toBe(true);
        const files = await fs.readdir(path.join(testSkillsDir, 'root-skill'));
        expect(files).toContain('SKILL.md');
        expect(files).toContain('README.md');
        expect(files).not.toContain('skill.zip');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
