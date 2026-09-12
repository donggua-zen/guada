import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as yaml from 'js-yaml';
import { PrismaService } from '../../common/database/prisma.service';
import { MigrationRunner } from '../../common/database/migration-runner.service';
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import { SG_MODELS } from '../../constants/settings.constants';
import {
  ProviderFileStore,
  ProviderFileConfig,
  ProviderFileModel,
} from '../llm-core/provider-file.store';
import {
  MODEL_ID_KEYS,
  buildModelIdMap,
  planModelRefRewrite,
} from './model-reference-migration';
import {
  AGENT_FILE,
  REKEY_FILE,
  resolveAgentsDir,
} from '../characters/character-file.store';
import {
  parseAgentMarkdown,
  serializeAgentMarkdown,
} from '../characters/character-file.mapper';

const MIGRATED_MARKER = '.migrated-from-db';
/** 历史遗留：曾把「引用改写」拆成独立 marker，现已与上面合并，见到就清掉 */
const OBSOLETE_REFS_MARKER = '.model-refs-migrated';

/**
 * 供应商配置引导：schema 文档落盘 + DB→文件一次性迁移
 *
 * 设计要点：
 * - **不做** bundled 实例补种——bundled-providers/*.yaml 只作为「可添加」模板
 *   数据源（用户从模板添加时才创建实例文件）。
 * - DB→文件迁移是一个整体：导出实例文件 → 载入 store → 改写存量模型引用，
 *   共用一个 marker。没有历史用户（除开发测试环境），不需要为「已迁过供应商
 *   但未迁引用」的中间态单独设 marker。
 * - 引用改写读的是旧 model/model_provider 表（此刻尚未删除），因此必须排在
 *   删除这些表之前；表删除后本步骤自然变为 no-op（读不到行 → 无映射 → 全 unresolved）。
 *
 * 客户端分发形态：迁移在用户机器上启动时自动执行且仅执行一次。
 * 全新安装没有 DB 行，两个阶段都是 no-op，只落一个 marker。
 * 若还原了旧快照导致引用回退成旧 id，删掉 marker 重启即可重跑（改写幂等）。
 */
@Injectable()
export class ProviderBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ProviderBootstrapService.name);

  constructor(
    private readonly store: ProviderFileStore,
    private readonly prisma: PrismaService,
    private readonly migrationRunner: MigrationRunner,
    private readonly settingsStorage: SettingsStorage,
  ) {}

  async onModuleInit(): Promise<void> {
    // 先确保结构就绪（含 0003 解除 model 外键），否则改写会撞外键；
    // 不依赖 onModuleInit 的跨模块顺序，显式调用（幂等）
    await this.migrationRunner.run();
    await this.seedReadme();

    const markerPath = path.join(this.store.getDirectory(), MIGRATED_MARKER);
    this.dropObsoleteRefsMarker();
    const needsMigration = !fs.existsSync(markerPath);

    // 导出必须发生在 store.initialize() 之前，新建的实例文件才会被本次加载纳入
    // （store 虽在监听目录，但改写阶段要立刻用 findModel 校验，不能等 debounce）
    const exported = needsMigration ? await this.exportProviderFiles() : true;

    await this.store.initialize();

    if (needsMigration && exported) {
      const rewritten = await this.rewriteModelReferences();
      // 改写失败（DB 不可读）不落 marker：下次启动重试，避免静默留下旧引用
      if (rewritten) await this.writeMarker(markerPath);
    }
  }

  /** 清掉历史遗留的第二个 marker（已合并，避免日后误以为还要单独重跑） */
  private dropObsoleteRefsMarker(): void {
    const obsolete = path.join(this.store.getDirectory(), OBSOLETE_REFS_MARKER);
    if (!fs.existsSync(obsolete)) return;
    try {
      fs.rmSync(obsolete, { force: true });
      this.logger.log(
        `Removed obsolete marker ${OBSOLETE_REFS_MARKER} (merged into ${MIGRATED_MARKER})`,
      );
    } catch (err) {
      this.logger.warn(`Failed to remove obsolete marker: ${String(err)}`);
    }
  }

  /** 仅落盘 schema 说明文档（README.md），不创建任何实例文件 */
  private async seedReadme(): Promise<void> {
    const bundledDir = this.resolveBundledDir();
    if (!bundledDir) return;
    const readme = path.join(bundledDir, 'README.md');
    const target = path.join(this.store.getDirectory(), 'README.md');
    if (!fs.existsSync(readme) || fs.existsSync(target)) return;
    try {
      await fsp.mkdir(this.store.getDirectory(), { recursive: true });
      await fsp.copyFile(readme, target);
    } catch (err) {
      this.logger.warn(`Failed to seed providers README: ${String(err)}`);
    }
  }

  private resolveBundledDir(): string | undefined {
    const candidates = [
      process.env.BUNDLED_PROVIDERS_DIR,
      path.join(process.cwd(), 'bundled-providers'),
    ].filter(Boolean) as string[];
    return candidates.find((dir) => fs.existsSync(dir));
  }

  /**
   * DB 供应商/模型 → 实例文件。
   * @returns false 表示 DB 不可读（调用方不落 marker，下次启动重试）
   */
  private async exportProviderFiles(): Promise<boolean> {
    let dbProviders: Array<Record<string, any>>;
    try {
      dbProviders = await this.prisma.modelProvider.findMany({
        include: { models: true },
      });
    } catch (err) {
      this.logger.warn(`DB unreadable, skip provider migration: ${String(err)}`);
      return false;
    }

    if (dbProviders.length === 0) {
      // 全新安装：无 DB 行，无事可做
      return true;
    }

    let migrated = 0;
    let skipped = 0;
    for (const row of dbProviders) {
      const config = this.rowToConfig(row);
      const target = path.join(this.store.getDirectory(), `${config.id}.yaml`);
      if (fs.existsSync(target)) {
        // 幂等保护（重复执行时已存在的实例文件不覆盖）
        skipped += 1;
        continue;
      }
      const body = yaml.dump(config, { lineWidth: -1, noRefs: true });
      await fsp.writeFile(target, body, 'utf8');
      migrated += 1;
    }

    this.logger.log(
      `Provider config migrated from DB: ${migrated} written, ${skipped} skipped (file exists), ${dbProviders.length} total`,
    );
    return true;
  }

  /** DB 行 → 文件 schema（保留原 id 使实例 id 与存量 provider 前缀一致） */
  private rowToConfig(row: Record<string, any>): ProviderFileConfig {
    const attributes = row.attributes as Record<string, any> | null;
    const headers =
      attributes && typeof attributes.headers === 'object' && attributes.headers !== null
        ? (attributes.headers as Record<string, string>)
        : undefined;

    const models: ProviderFileModel[] = (row.models || []).map((m: any) => ({
      modelName: m.modelName,
      modelType: m.modelType || 'text',
      name: m.name || undefined,
      config: m.config || undefined,
      isFavorite: m.isFavorite === true,
      isActive: m.isActive !== false,
    }));

    // 迁移实例统一视为启用（原 DB 无 enabled 概念，全部可用）
    return {
      id: row.id,
      type: row.provider || 'custom',
      name: row.name,
      enabled: true,
      protocol: row.protocol || 'openai',
      apiUrl: row.apiUrl || undefined,
      apiKey: row.apiKey || undefined,
      ...(headers ? { headers } : {}),
      ...(models.length > 0 ? { models } : {}),
    };
  }

  /**
   * 存量模型引用改写：旧 cuid → `{实例id}:{模型名}`（幂等，随 DB→文件迁移同批执行）。
   *
   * 覆盖 DB 列（session/character/knowledge_base/bot_instance）、models 设置组、
   * 调度任务 JSON。改写前逐条用文件目录校验目标 id，解析不到的保持原值并告警——
   * 运行期会 fail-loud 报出，避免静默指向错误模型。
   *
   * @returns false 表示 DB 不可读（调用方不落 marker，下次启动重试）
   */
  private async rewriteModelReferences(): Promise<boolean> {
    let legacyRows: Array<{ id: string; modelName: string; providerId: string }>;
    try {
      legacyRows = await this.prisma.model.findMany({
        select: { id: true, modelName: true, providerId: true },
      });
    } catch (err) {
      this.logger.warn(
        `DB unreadable, skip model reference rewrite: ${String(err)}`,
      );
      return false;
    }

    if (legacyRows.length === 0) {
      this.logger.log('No legacy model rows; model reference rewrite skipped');
      return true;
    }

    const legacyToFileId = buildModelIdMap(legacyRows);
    const isResolvable = (fileId: string) => this.store.findModel(fileId) !== undefined;
    const unresolved: string[] = [];
    let rewritten = 0;

    const planFor = (value: string | null | undefined) =>
      planModelRefRewrite(value, legacyToFileId, isResolvable);

    // ── DB 列 ──
    const targets: Array<{
      label: string;
      rows: Array<{ id: string; value: string | null }>;
      update: (id: string, value: string) => Promise<unknown>;
    }> = [
      {
        label: 'session.modelId',
        rows: (
          await this.prisma.session.findMany({
            where: { modelId: { not: null } },
            select: { id: true, modelId: true },
          })
        ).map((r) => ({ id: r.id, value: r.modelId })),
        update: (id, value) =>
          this.prisma.session.update({ where: { id }, data: { modelId: value } }),
      },
      {
        label: 'character.modelId',
        rows: (
          await this.prisma.character.findMany({
            where: { modelId: { not: null } },
            select: { id: true, modelId: true },
          })
        ).map((r) => ({ id: r.id, value: r.modelId })),
        // 角色定义权威来源已是 agents/<id>/AGENT.md：DB 行仅作只读兜底，
        // 改写落到文件 frontmatter（id 沿用旧 cuid，与文件侧目录名一致时生效）
        update: (id, value) => this.rewriteCharacterFileModel(id, value),
      },
      {
        label: 'knowledgeBase.embeddingModelId',
        rows: (
          await this.prisma.knowledgeBase.findMany({
            select: { id: true, embeddingModelId: true },
          })
        ).map((r) => ({ id: r.id, value: r.embeddingModelId })),
        update: (id, value) =>
          this.prisma.knowledgeBase.update({
            where: { id },
            data: { embeddingModelId: value },
          }),
      },
      {
        label: 'botInstance.defaultModelId',
        rows: (
          await this.prisma.botInstance.findMany({
            where: { defaultModelId: { not: null } },
            select: { id: true, defaultModelId: true },
          })
        ).map((r) => ({ id: r.id, value: r.defaultModelId })),
        update: (id, value) =>
          this.prisma.botInstance.update({
            where: { id },
            data: { defaultModelId: value },
          }),
      },
    ];

    for (const target of targets) {
      for (const row of target.rows) {
        const outcome = planFor(row.value);
        if (outcome.kind === 'rewritten') {
          await target.update(row.id, outcome.to);
          rewritten += 1;
        } else if (outcome.kind === 'unresolved') {
          unresolved.push(`${target.label}#${row.id}=${outcome.from}`);
        }
      }
    }

    // ── models 设置组 ──
    const settings = await this.settingsStorage.getSettings(SG_MODELS);
    const settingsPatch: Record<string, string> = {};
    for (const key of Object.keys(settings || {})) {
      if (!MODEL_ID_KEYS.has(key)) continue;
      const outcome = planFor(settings[key]);
      if (outcome.kind === 'rewritten') settingsPatch[key] = outcome.to;
      else if (outcome.kind === 'unresolved') {
        unresolved.push(`settings.${key}=${outcome.from}`);
      }
    }
    if (Object.keys(settingsPatch).length > 0) {
      await this.settingsStorage.updateSettings(SG_MODELS, settingsPatch);
      rewritten += Object.keys(settingsPatch).length;
    }

    // ── 调度任务 JSON（路径与 TaskStorageService 同源）──
    rewritten += await this.rewriteSchedulerTasks(planFor, unresolved);

    this.logger.log(
      `Model references rewritten: ${rewritten} rewritten, ${unresolved.length} unresolved`,
    );
    if (unresolved.length > 0) {
      this.logger.warn(
        `Unresolved model references (left as-is, requests will fail loudly): ${unresolved.join(', ')}`,
      );
    }
    return true;
  }

  /** 调度任务的模型引用（JSON 存储，与 TaskStorageService 使用同一 dataDir 推导） */
  private async rewriteSchedulerTasks(
    planFor: (value: string | null | undefined) => ReturnType<typeof planModelRefRewrite>,
    unresolved: string[],
  ): Promise<number> {
    const dataDir =
      process.env.USERDATA_DIR ||
      process.env.DATA_DIR ||
      path.join(process.cwd(), 'data');
    const tasksFile = path.join(dataDir, 'scheduler', 'tasks.json');
    if (!fs.existsSync(tasksFile)) return 0;

    try {
      const parsed = JSON.parse(await fsp.readFile(tasksFile, 'utf8'));
      const tasks = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.tasks)
          ? parsed.tasks
          : null;
      if (!tasks) return 0;

      let changed = 0;
      for (const task of tasks) {
        if (!task || typeof task.modelId !== 'string') continue;
        const outcome = planFor(task.modelId);
        if (outcome.kind === 'rewritten') {
          task.modelId = outcome.to;
          changed += 1;
        } else if (outcome.kind === 'unresolved') {
          unresolved.push(`schedulerTask#${task.id ?? '?'}=${outcome.from}`);
        }
      }
      if (changed > 0) {
        await fsp.writeFile(tasksFile, JSON.stringify(parsed, null, 2), 'utf8');
      }
      return changed;
    } catch (err) {
      this.logger.warn(`Scheduler tasks rewrite failed: ${String(err)}`);
      return 0;
    }
  }

  private async writeMarker(markerPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(
      markerPath,
      `migrated at ${new Date().toISOString()}\n`,
      'utf8',
    );
  }

  /**
   * 改写角色文件里的模型引用（角色定义权威来源已是 agents/<id>/AGENT.md）。
   *
   * id 可能是旧 cuid：角色导出时目录名换成了 name 派生的 slug，映射记在
   * `.rekey.json`。两条路径都试，找不到就跳过（导出引导会在导出时自行改写）。
   */
  private async rewriteCharacterFileModel(
    legacyId: string,
    value: string,
  ): Promise<void> {
    const agentsDir = resolveAgentsDir();
    const dirId = await this.resolveAgentDirId(agentsDir, legacyId);
    if (!dirId) return;
    const mdPath = path.join(agentsDir, dirId, AGENT_FILE);
    try {
      const content = await fsp.readFile(mdPath, 'utf8');
      const def = parseAgentMarkdown(content, dirId);
      if (def.model === value) return;
      await fsp.writeFile(
        mdPath,
        serializeAgentMarkdown({ ...def, model: value }),
        'utf8',
      );
    } catch (err) {
      this.logger.warn(
        `Failed to rewrite character model ref (${dirId}): ${String(err)}`,
      );
    }
  }

  /** 旧 id → 目录名（先按 id 直查，再查 rekey 映射） */
  private async resolveAgentDirId(
    agentsDir: string,
    legacyId: string,
  ): Promise<string | null> {
    try {
      await fsp.access(path.join(agentsDir, legacyId, AGENT_FILE));
      return legacyId;
    } catch {
      /* 继续查映射 */
    }
    try {
      const raw = await fsp.readFile(
        path.join(agentsDir, REKEY_FILE),
        'utf8',
      );
      const map = JSON.parse(raw);
      const mapped = map?.[legacyId];
      if (typeof mapped === 'string' && mapped) return mapped;
    } catch {
      /* 无映射 */
    }
    return null;
  }
}
