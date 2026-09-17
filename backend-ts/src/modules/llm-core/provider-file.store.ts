import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as yaml from 'js-yaml';
import {
  AnyThinkingEffort,
  ProviderThinkingConfig,
  ResolvedThinkingCompat,
  ThinkingCompatConfig,
  ThinkingEffort,
  ThinkingEffortMap,
  defaultSupportsReasoningEffort,
  mergeThinkingCompat,
  normalizeEffortMap,
  normalizeThinkingFormat,
  parseThinkingCompat,
} from './thinking/thinking-vocabulary';
import { resolveThinkingMenu } from './thinking/resolve-thinking-efforts';
import type { ThinkingAwareModelEntry } from './thinking/resolve-thinking-efforts';
import { BundledCatalogService } from './bundled-catalog.service';
import { atomicWriteFile } from '../../common/persistence/file-store-kit';

/** 单个供应商实例配置（providers/*.yaml 的 schema） */
export interface ProviderFileConfig {
  /** 实例唯一 id（=文件名去扩展名；模型 id 前缀） */
  id: string;
  /** 类型键：行为注册表（thinking style 默认、元数据兜底、模板来源） */
  type: string;
  /** 显示名称 */
  name: string;
  /** 启用/禁用（禁用实例不进入模型选择器与运行时解析） */
  enabled: boolean;
  /** wire 协议：openai | openai-response | anthropic | gemini */
  protocol: string;
  /** API 基础地址 */
  apiUrl?: string;
  /** API Key（明文；与原 DB 存储同级） */
  apiKey?: string;
  /** 附加请求头 */
  headers?: Record<string, string>;
  /** 供应商级 thinking 档位声明（defaultEfforts；wire 开关在 compat） */
  thinking?: ProviderThinkingConfig;
  /** 供应商级 wire 兼容开关（模型条目 compat 可逐字段覆盖） */
  compat?: ThinkingCompatConfig;
  /** 模型条目列表 */
  models?: ProviderFileModel[];
}

/** 单个模型条目（models[]） */
export interface ProviderFileModel {
  modelName: string;
  /** text | embedding | image */
  modelType?: string;
  /** 显示名称 */
  name?: string;
  /** 模型能力配置（contextWindow/maxOutputTokens/features/inputCapabilities/temperature 等） */
  config?: Record<string, any>;
  /**
   * 能力声明：能不能思考（对齐 DSH `reasoning` 布尔；与档位菜单正交）。
   * false = 不能思考；true = 能思考（未声明档位时默认 [none, on] 开关菜单）；
   * 缺省 = fail-safe 按不能思考处理（legacy thinkingEfforts 声明在解析时折叠）。
   */
  supportsThinking?: boolean;
  /** 思考档位声明：false=legacy 不能思考；数组=显式菜单（wire 值=档位名）；缺省=回退 defaultEfforts/preset */
  thinkingEfforts?: boolean | AnyThinkingEffort[];
  /** 档位→wire 值映射（非 null 键派生菜单，值作为 wire 字符串；优先于 thinkingEfforts 数组） */
  thinkingEffortsMap?: ThinkingEffortMap;
  /** 模型条目级 wire 兼容开关（逐字段覆盖实例/卡片 compat） */
  compat?: ThinkingCompatConfig;
  isFavorite?: boolean;
  isActive?: boolean;
  /** 删除标记：目录继承模型被用户移除（实例条目覆盖层专用；自建模型直接移除条目） */
  deleted?: boolean;
}

/** 运行时模型视图（findById/listModels 返回形态，对齐原 DB Model+Provider include） */
export interface ModelWithProvider {
  id: string;
  modelName: string;
  name: string;
  modelType: string;
  config: Record<string, any>;
  isFavorite: boolean;
  isActive: boolean;
  provider: ProviderFileConfig & { attributes?: { headers?: Record<string, string> } };
  /** 解析后的思考档位菜单（中立档位） */
  thinkingEfforts: string[];
  /** 档位→wire 值映射（菜单与 wire 解耦；缺省时 wire 值=档位名） */
  thinkingEffortMap?: Partial<Record<ThinkingEffort, string>>;
  /** 生效的 wire 兼容开关（模型条目 > 实例级 > 类型卡；format/supportsEffort 必有值） */
  thinkingCompat: ResolvedThinkingCompat;
}

/** 读取失败文件的隔离信息 */
export interface LoadError {
  file: string;
  message: string;
}

const MODEL_TYPES = new Set(['text', 'embedding', 'image']);
const PROTOCOLS = new Set(['openai', 'openai-response', 'anthropic', 'gemini', 'mock']);

/**
 * 供应商配置文件存储（对齐 DSH「供应商就是数据」）
 *
 * 目录约定：PROVIDERS_DIR 环境变量（Electron 注入）|| USERDATA_DIR/providers
 * || cwd()/data/providers。每实例一个 YAML 文件，文件名（去扩展名）即实例 id。
 *
 * - 内存缓存 + chokidar 监听（300ms 防抖全量重读，兼容编辑器原子写 rename）
 * - 原子写（tmp + rename）
 * - 非法文件隔离：解析失败仅记录，不崩服务，不挤占缓存
 * - 输入宽容：off→none 归一、thinkingStyle 未知值回退协议默认
 */
@Injectable()
export class ProviderFileStore implements OnModuleDestroy {
  private readonly logger = new Logger(ProviderFileStore.name);
  private readonly providersDir: string;
  private cache = new Map<string, ProviderFileConfig>();
  private loadErrors = new Map<string, LoadError>();
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private ready: Promise<void> | null = null;

  /** 配置变更通知（文件被 AI/手动/UI 修改后触发） */
  private changeListeners = new Set<() => void>();

  constructor(private readonly bundledCatalog: BundledCatalogService) {
    this.providersDir = this.resolveDir();
  }

  private resolveDir(): string {
    return (
      process.env.PROVIDERS_DIR ||
      (process.env.USERDATA_DIR
        ? path.join(process.env.USERDATA_DIR, 'providers')
        : path.join(process.cwd(), 'data', 'providers'))
    );
  }

  /** 目录绝对路径（供白名单注册与 README 落盘） */
  getDirectory(): string {
    return this.providersDir;
  }

  /** 初始化：建目录 + 种子补种 + 全量加载 + 启动监听 */
  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    await fsp.mkdir(this.providersDir, { recursive: true });
    await this.loadAll();
    this.startWatcher();
    this.logger.log(
      `Provider file store ready at ${this.providersDir} (${this.cache.size} providers)`,
    );
  }

  // ============ 读取与解析 ============

  private startWatcher(): void {
    if (this.watcher) return;
    try {
      this.watcher = chokidar.watch(this.providersDir, {
        ignoreInitial: true,
        ignorePermissionErrors: true,
        persistent: true,
      });
      this.watcher.on('add', () => this.scheduleReload());
      this.watcher.on('change', () => this.scheduleReload());
      this.watcher.on('unlink', () => this.scheduleReload());
      this.watcher.on('error', (err) =>
        this.logger.error('Provider watcher error: ' + String(err)),
      );
    } catch (err) {
      this.logger.warn(`Failed to start provider watcher: ${String(err)}`);
    }
  }

  /** 300ms 防抖全量重读（兼容编辑器 tmp+rename 原子写触发的多事件） */
  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.loadAll()
        .then(() => {
          for (const listener of this.changeListeners) {
            try {
              listener();
            } catch (err) {
              this.logger.warn(`Provider change listener failed: ${String(err)}`);
            }
          }
        })
        .catch((err) => this.logger.error(`Provider reload failed: ${String(err)}`));
    }, 300);
  }

  onDidChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async loadAll(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.providersDir, { withFileTypes: true });
    } catch {
      return;
    }
    const nextCache = new Map<string, ProviderFileConfig>();
    const nextErrors = new Map<string, LoadError>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fileName = entry.name;
      const ext = path.extname(fileName).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') continue;
      const id = path.basename(fileName, ext);
      const filePath = path.join(this.providersDir, fileName);
      try {
        const content = await fsp.readFile(filePath, 'utf8');
        const config = this.parse(content, id);
        nextCache.set(id, config);
      } catch (err: any) {
        nextErrors.set(id, { file: fileName, message: err?.message || String(err) });
        this.logger.warn(
          `Invalid provider file "${fileName}" (isolated): ${err?.message || err}`,
        );
      }
    }

    this.cache = nextCache;
    this.loadErrors = nextErrors;
  }

  /**
   * 解析并校验单个 YAML 文档（输入宽容）：
   * - id 缺省用文件名补齐；off→none 归一在 thinkingEfforts 解析时进行
   * - protocol/thinkingStyle 未知值回退（不拒载）
   */
  private parse(content: string, fileId: string): ProviderFileConfig {
    const doc = yaml.load(content);
    if (doc === null || doc === undefined) {
      throw new Error('empty document');
    }
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('root must be a mapping');
    }
    const raw = doc as Record<string, any>;

    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fileId;
    if (id !== fileId) {
      // id 与文件名不一致：以文件名为准（文件名即实例 id 是目录唯一性来源）
      this.logger.warn(
        `Provider file "${fileId}" declares id "${id}", using file name instead`,
      );
    }

    const type = typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : id;
    const protocol =
      typeof raw.protocol === 'string' && PROTOCOLS.has(raw.protocol)
        ? raw.protocol
        : 'openai';
    if (typeof raw.protocol === 'string' && !PROTOCOLS.has(raw.protocol)) {
      this.logger.warn(
        `Provider "${id}" declares unknown protocol "${raw.protocol}", falling back to "openai"`,
      );
    }

    const thinking = this.parseThinking(raw.thinking);
    // legacy：thinking.style 归一到 compat.thinkingFormat（显式 compat 优先）
    const legacyFormat = normalizeThinkingFormat(raw.thinking?.style);
    const compat = mergeThinkingCompat(
      legacyFormat ? { thinkingFormat: legacyFormat } : undefined,
      parseThinkingCompat(raw.compat),
    );

    const models = this.parseModels(raw.models);

    return {
      id,
      type,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      enabled: raw.enabled !== false,
      protocol,
      apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
      headers: this.parseStringMap(raw.headers),
      ...(thinking ? { thinking } : {}),
      ...(compat ? { compat } : {}),
      models,
    };
  }

  private parseThinking(raw: any): ProviderThinkingConfig | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    // legacy thinking.style 已在 parse() 归一进 compat；这里只保留档位声明
    const defaultEfforts = Array.isArray(raw.defaultEfforts)
      ? raw.defaultEfforts.map(String)
      : undefined;
    if (defaultEfforts === undefined) return undefined;
    return { defaultEfforts };
  }

  private parseStringMap(raw: any): Record<string, string> | undefined {
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = v;
      else if (typeof v === 'number') out[k] = String(v);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private parseModels(raw: any): ProviderFileModel[] {
    if (!Array.isArray(raw)) return [];
    const models: ProviderFileModel[] = [];
    for (const item of raw) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      const modelName = (item as any).modelName;
      if (typeof modelName !== 'string' || !modelName.trim()) continue;
      const modelType =
        typeof (item as any).modelType === 'string' &&
        MODEL_TYPES.has((item as any).modelType)
          ? (item as any).modelType
          : 'text';
      const thinkingEfforts = this.parseThinkingDeclaration(
        (item as any).thinkingEfforts,
      ) as boolean | AnyThinkingEffort[] | undefined;
      const thinkingEffortsMap = normalizeEffortMap(
        (item as any).thinkingEffortsMap,
      );
      // 能力声明：显式 supportsThinking 优先；否则由 legacy thinkingEfforts 折叠
      //（false → 不能思考；数组/true → 能思考）；都未声明 → undefined（fail-safe）
      const rawSupports = (item as any).supportsThinking;
      const supportsThinking =
        typeof rawSupports === 'boolean'
          ? rawSupports
          : thinkingEfforts === false
            ? false
            : thinkingEfforts !== undefined
              ? true
              : undefined;
      // legacy：模型条目 thinking.style 归一到 compat.thinkingFormat（显式 compat 优先）
      const legacyFormat = normalizeThinkingFormat(
        (item as any).thinking?.style,
      );
      const compat = mergeThinkingCompat(
        legacyFormat ? { thinkingFormat: legacyFormat } : undefined,
        parseThinkingCompat((item as any).compat),
      );

      models.push({
        modelName: modelName.trim(),
        modelType,
        name: typeof (item as any).name === 'string' ? (item as any).name : undefined,
        config:
          (item as any).config && typeof (item as any).config === 'object'
            ? (item as any).config
            : undefined,
        ...(supportsThinking !== undefined ? { supportsThinking } : {}),
        ...(thinkingEfforts !== undefined ? { thinkingEfforts } : {}),
        ...(thinkingEffortsMap !== undefined ? { thinkingEffortsMap } : {}),
        ...(compat ? { compat } : {}),
        isFavorite: (item as any).isFavorite === true,
        isActive: (item as any).isActive !== false,
        deleted: (item as any).deleted === true,
      });
    }
    return models;
  }

  private parseThinkingDeclaration(
    raw: any,
  ): boolean | AnyThinkingEffort[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'boolean') return raw;
    if (Array.isArray(raw)) return raw.map(String) as AnyThinkingEffort[];
    return undefined;
  }

  // ============ 查询 API（缓存，同步） ============

  /** 全部供应商实例（含 disabled；不含隔离失败文件） */
  listProviders(): ProviderFileConfig[] {
    return Array.from(this.cache.values());
  }

  /** 启用中的供应商实例 */
  listEnabledProviders(): ProviderFileConfig[] {
    return this.listProviders().filter((p) => p.enabled);
  }

  getProvider(id: string): ProviderFileConfig | undefined {
    return this.cache.get(id);
  }

  /** 读取失败文件列表（供管理面展示隔离告警） */
  listLoadErrors(): LoadError[] {
    return Array.from(this.loadErrors.values());
  }

  /**
   * 按 modelId 查模型（id 形如 `{providerId}:{modelName}`），返回
   * Model + Provider 的拍平视图（对齐原 modelRepository.findById include provider）。
   * 不存在返回 undefined（悬空引用语义与原设计一致）。
   */
  findModel(modelId: string): ModelWithProvider | undefined {
    const sep = modelId.indexOf(':');
    if (sep <= 0) return undefined;
    const providerId = modelId.slice(0, sep);
    const modelName = modelId.slice(sep + 1);
    const provider = this.cache.get(providerId);
    if (!provider) return undefined;
    for (const model of this.resolveMergedModels(provider)) {
      if (model.modelName === modelName) {
        return this.toModelView(provider, model);
      }
    }
    return undefined;
  }

  /** 列出启用实例的全部模型（供模型选择器；isActive=false 的条目仍返回，由调用方过滤） */
  listModels(includeInactive = false): ModelWithProvider[] {
    const out: ModelWithProvider[] = [];
    for (const provider of this.listProviders()) {
      if (!provider.enabled) continue;
      for (const model of this.resolveMergedModels(provider)) {
        if (!includeInactive && model.isActive === false) continue;
        out.push(this.toModelView(provider, model));
      }
    }
    return out;
  }

  /**
   * 实例模型解析：类型目录（bundled）继承 + 实例条目覆盖
   *
   * 合并语义（对齐 DSH「route inherits catalog, user layer overrides」）：
   * - 目录条目：未覆盖时按目录原样继承（目录随应用升级自动流到实例）
   * - 实例覆盖条目（modelName 匹配目录）：字段级覆盖（name/config/thinkingEfforts/
   *   thinking/isFavorite/isActive），`deleted: true` 表示用户删除了该继承模型
   * - 实例新增条目（目录没有的 modelName）：用户自建模型，完整条目
   */
  resolveMergedModels(provider: ProviderFileConfig): ProviderFileModel[] {
    const entries = provider.models || [];
    const byName = new Map(entries.map((e) => [e.modelName, e]));
    const catalog = this.bundledCatalog.getCatalogModels(provider.type);
    const out: ProviderFileModel[] = [];

    for (const cat of catalog) {
      const override = byName.get(cat.modelName);
      if (override?.deleted) continue; // 用户删除的继承模型
      out.push({
        modelName: cat.modelName,
        modelType: override?.modelType ?? cat.modelType,
        name: override?.name ?? cat.name,
        config: { ...(cat.config || {}), ...(override?.config || {}) },
        // 能力声明：实例条目覆盖目录条目（缺省 = 未声明，fail-safe 不能思考）
        ...(override?.supportsThinking !== undefined || cat.supportsThinking !== undefined
          ? {
              supportsThinking:
                override?.supportsThinking ?? cat.supportsThinking,
            }
          : {}),
        ...(override?.thinkingEfforts !== undefined || cat.thinkingEfforts !== undefined
          ? {
              thinkingEfforts:
                override?.thinkingEfforts ?? (cat.thinkingEfforts as any),
            }
          : {}),
        ...(override?.thinkingEffortsMap !== undefined || cat.thinkingEffortsMap !== undefined
          ? {
              thinkingEffortsMap:
                override?.thinkingEffortsMap ?? cat.thinkingEffortsMap,
            }
          : {}),
        // wire 兼容开关：实例条目 compat 逐字段覆盖目录条目 compat
        //（此前 thinking 整体替换曾把模型级覆盖静默吃掉，故逐字段合并）
        ...(mergeThinkingCompat(cat.compat, override?.compat)
          ? { compat: mergeThinkingCompat(cat.compat, override?.compat) }
          : {}),
        isFavorite: override?.isFavorite ?? false,
        isActive: override?.isActive ?? true,
      });
    }

    // 用户自建模型（目录没有的条目）
    const catalogNames = new Set(catalog.map((c) => c.modelName));
    for (const e of entries) {
      if (!catalogNames.has(e.modelName) && !e.deleted) {
        out.push(e);
      }
    }
    return out;
  }

  /**
   * 单模型的运行时视图（菜单/wire 映射已按同一份解析链算好）。
   * 管理面视图复用此方法——不要另起一份解析链，两份链必然漂移。
   */
  resolveModelView(
    provider: ProviderFileConfig,
    model: ProviderFileModel,
  ): ModelWithProvider {
    return this.toModelView(provider, model);
  }

  /** 拍平为运行时视图；菜单与 wire 值由 resolver 现算（数据即真相，不落盘缓存） */
  private toModelView(
    provider: ProviderFileConfig,
    model: ProviderFileModel,
  ): ModelWithProvider {
    const thinking = this.resolveProviderThinking(provider);
    const compat = this.resolveThinkingCompat(provider, model);
    const resolved = resolveThinkingMenu(
      {
        modelName: model.modelName,
        modelType: model.modelType,
        supportsThinking: model.supportsThinking,
        thinkingEfforts: model.thinkingEfforts,
        thinkingEffortsMap: model.thinkingEffortsMap,
      } as ThinkingAwareModelEntry,
      thinking,
      // 档位未知时的兜底要跟着格式走：开关型格式给不了强度档，别造假菜单
      { supportsEffort: compat.supportsReasoningEffort },
    );
    return {
      id: `${provider.id}:${model.modelName}`,
      modelName: model.modelName,
      name: model.name || model.modelName,
      modelType: model.modelType || 'text',
      config: model.config || {},
      isFavorite: model.isFavorite === true,
      isActive: model.isActive !== false,
      provider: {
        ...provider,
        thinking,
        // 用解析后的生效值覆盖原始部分声明，适配器只读这一个对象
        compat,
        attributes: provider.headers ? { headers: provider.headers } : undefined,
      },
      thinkingEfforts: resolved.menu,
      ...(Object.keys(resolved.wireValues).length > 0
        ? { thinkingEffortMap: resolved.wireValues }
        : {}),
      thinkingCompat: compat,
    };
  }

  /**
   * 供应商级档位兜底：仅实例文件的 `thinking.defaultEfforts`（类型卡不提供
   * provider 级兜底——那会让任意未声明模型白得一份档位）。
   */
  private resolveProviderThinking(
    provider: ProviderFileConfig,
  ): ProviderThinkingConfig | undefined {
    const defaultEfforts = provider.thinking?.defaultEfforts;
    return defaultEfforts ? { defaultEfforts } : undefined;
  }

  /**
   * 生效的 wire 兼容开关（对齐 DSH：compat 逐字段合并，模型条目 > 实例 > 卡片）。
   * - format：链上未声明 → 默认 `openai`（平铺 reasoning_effort）
   * - supportsReasoningEffort：链上未声明 → 按 format 的厂商默认
   * - requiresReasoningContentOnAssistantMessages / 模板参数：链上未声明即缺省
   *   （前者由会话侧的名字启发式兜底，见 message-transform.pipeline）
   */
  private resolveThinkingCompat(
    provider: ProviderFileConfig,
    model: ProviderFileModel,
  ): ResolvedThinkingCompat {
    const card = this.bundledCatalog.getType(provider.type);
    const merged = mergeThinkingCompat(
      card?.compat,
      provider.compat,
      model.compat,
    );
    const thinkingFormat = merged?.thinkingFormat ?? 'openai';
    const supportsReasoningEffort =
      merged?.supportsReasoningEffort ??
      defaultSupportsReasoningEffort(thinkingFormat);
    return {
      ...(merged ?? {}),
      thinkingFormat,
      supportsReasoningEffort,
    };
  }

  // ============ 写入 API（原子写） ============

  /** 保存整个供应商实例（新建或全量覆盖）；id 不可变更 */
  async saveProvider(config: ProviderFileConfig): Promise<void> {
    const { id, ...rest } = config;
    if (!id || /[\\/:*?"<>|]/.test(id) || id.startsWith('.')) {
      throw new Error(`Invalid provider id: "${id}"`);
    }
    const content = yaml.dump({ id, ...rest }, {
      lineWidth: -1,
      noRefs: true,
    });
    await fsp.mkdir(this.providersDir, { recursive: true });
    await atomicWriteFile(path.join(this.providersDir, `${id}.yaml`), content);
    await this.loadAll();
  }

  /** 更新单个供应商（部分字段；undefined 字段保持原值） */
  async updateProvider(
    id: string,
    patch: Partial<Omit<ProviderFileConfig, 'id'>>,
  ): Promise<ProviderFileConfig> {
    const existing = this.cache.get(id);
    if (!existing) throw new Error(`Provider not found: ${id}`);
    const merged: ProviderFileConfig = { ...existing, ...patch, id };
    await this.saveProvider(merged);
    return merged;
  }

  /** 启用/禁用供应商 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.updateProvider(id, { enabled });
  }

  /** 删除供应商实例文件（悬空引用语义：modelId 引用保持不变） */
  async deleteProvider(id: string): Promise<boolean> {
    const existed = this.cache.has(id);
    if (!existed) return false;
    const filePath = path.join(this.providersDir, `${id}.yaml`);
    try {
      await fsp.unlink(filePath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
    await this.loadAll();
    return true;
  }

  // ============ 模型级操作 ============

  /**
   * 添加模型（upsert 语义）：
   * - 目录继承模型已在合并视图存在 → 转为写覆盖条目（不产生重复）
   * - 实例已有条目 → 更新该条目
   * - 全新模型 → 追加条目（config 为空时由调用方先用 preset 填充）
   */
  async addModel(providerId: string, model: ProviderFileModel): Promise<void> {
    const provider = this.cache.get(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    const models = provider.models || [];
    const index = models.findIndex((m) => m.modelName === model.modelName);
    if (index >= 0) {
      models[index] = { ...models[index], ...model, modelName: model.modelName };
    } else {
      // 目录继承模型：写覆盖条目（含 deleted 清除），保持单一条目
      models.push(model);
    }
    await this.saveProvider({ ...provider, models });
  }

  /**
   * 更新模型条目（按 modelName 定位，upsert）：
   * 目录继承模型尚未有覆盖条目时创建之——收藏/禁用/删除/参数修正
   * 都通过覆盖条目表达，实例文件保持"零复制"。
   *
   * patch 中显式为 null 的键 = 从条目删除该字段（清除覆盖，回退继承链；
   * js-yaml 会跳过 undefined 键，这里显式 delete 保证语义清晰）。
   */
  async updateModel(
    providerId: string,
    modelName: string,
    patch: Partial<ProviderFileModel>,
  ): Promise<void> {
    const provider = this.cache.get(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    const models = provider.models || [];
    const index = models.findIndex((m) => m.modelName === modelName);
    const clears = Object.keys(patch).filter(
      (k) => (patch as any)[k] === null,
    );
    const effective = { ...patch } as any;
    for (const k of clears) delete effective[k];
    if (index >= 0) {
      models[index] = { ...models[index], ...effective, modelName };
      for (const k of clears) delete models[index][k];
    } else {
      models.push({ modelName, ...effective } as ProviderFileModel);
    }
    await this.saveProvider({ ...provider, models });
  }

  /** 删除模型条目 */
  async deleteModel(providerId: string, modelName: string): Promise<boolean> {
    const provider = this.cache.get(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    const models = (provider.models || []).filter((m) => m.modelName !== modelName);
    if (models.length === (provider.models || []).length) return false;
    await this.saveProvider({ ...provider, models });
    return true;
  }

  onModuleDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    void this.watcher?.close();
  }
}

function modelId(providerId: string, modelName: string): string {
  return `${providerId}:${modelName}`;
}
