import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import * as yaml from 'js-yaml';
import {
  ProviderThinkingConfig,
  ThinkingCompatConfig,
  ThinkingEffortMap,
  ThinkingEffortPatch,
  mergeThinkingCompat,
  normalizeThinkingFormat,
  normalizeEffortMap,
  normalizeEffortPatch,
  parseThinkingCompat,
} from './thinking/thinking-vocabulary';

/** bundled 类型卡中的模型目录条目 */
export interface CatalogModel {
  modelName: string;
  modelType: string;
  /** 显示名（缺省用 modelName） */
  name?: string;
  /** 能力参数（contextWindow/maxOutputTokens/features/inputCapabilities 等） */
  config?: Record<string, any>;
  /** 逐模型能力声明：能不能思考（缺省 = 未声明，fail-safe 不能思考） */
  supportsThinking?: boolean;
  /** 逐模型档位声明：false=禁用思考；数组=显式菜单；缺省=回退类型默认 */
  thinkingEfforts?: boolean | string[];
  /** 档位→wire 值映射（非 null 键派生菜单，值作为 wire 字符串） */
  thinkingEffortsMap?: ThinkingEffortMap;
  /** 档位→JSON merge patch 映射（该档生效时整体打进请求体） */
  thinkingEffortsPatch?: ThinkingEffortPatch;
  /** 拼法表达式（CEL）：存在时接管思考字段写入（替换内置拼法分派） */
  thinkingPatchExpr?: string;
  /** 逐模型 wire 兼容开关覆盖 */
  compat?: ThinkingCompatConfig;
}

/** bundled 类型卡（一个内置供应商类型的全部静态事实） */
export interface BundledTypeCard {
  type: string;
  name: string;
  description?: string;
  apiKeyUrl?: string;
  avatarUrl?: string;
  protocol: string;
  defaultApiUrl?: string;
  thinking?: ProviderThinkingConfig;
  /** 卡片级 wire 兼容开关（模型条目 compat / 实例 compat 可覆盖） */
  compat?: ThinkingCompatConfig;
  models: CatalogModel[];
}

/**
 * 供应商类型目录服务（对齐 DSH pi-ai catalog）
 *
 * bundled-providers/*.yaml 是随应用版本分发的**类型目录数据**：
 * 「可添加供应商」模板与模型目录的唯一权威来源。用户实例文件不复制目录，
 * 运行时按 modelName 条目级继承 + 覆盖（见 ProviderFileStore 的合并逻辑），
 * 目录随应用升级自动流到未覆盖的实例。
 *
 * 读取一次缓存进程内（bundled 数据仅在应用升级时变化，进程生命周期内不变）。
 */
@Injectable()
export class BundledCatalogService {
  private readonly logger = new Logger(BundledCatalogService.name);
  private readonly cards = new Map<string, BundledTypeCard>();
  private loaded = false;

  private readonly bundledDir: string;

  constructor() {
    this.bundledDir =
      process.env.BUNDLED_PROVIDERS_DIR ||
      path.join(process.cwd(), 'bundled-providers');
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.bundledDir, { withFileTypes: true });
    } catch {
      this.logger.warn(`Bundled providers dir unreadable: ${this.bundledDir}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') continue;
      try {
        const doc = yaml.load(
          fs.readFileSync(path.join(this.bundledDir, entry.name), 'utf8'),
        );
        if (!doc || typeof doc !== 'object') continue;
        const raw = doc as Record<string, any>;
        const type =
          typeof raw.type === 'string' && raw.type.trim()
            ? raw.type.trim()
            : path.basename(entry.name, ext);
        const models: CatalogModel[] = Array.isArray(raw.models)
          ? raw.models
              .filter((m: any) => m && typeof m.modelName === 'string')
              .map((m: any) => {
                // legacy：模型条目 thinking.style 归一到 compat.thinkingFormat
                const legacyFormat = normalizeThinkingFormat(m.thinking?.style);
                const compat = mergeThinkingCompat(
                  legacyFormat ? { thinkingFormat: legacyFormat } : undefined,
                  parseThinkingCompat(m.compat),
                );
                return {
                  modelName: m.modelName,
                  modelType:
                    typeof m.modelType === 'string' ? m.modelType : 'text',
                  name: typeof m.name === 'string' ? m.name : undefined,
                  config:
                    m.config && typeof m.config === 'object' ? m.config : undefined,
                  // 能力声明：显式 supportsThinking 优先，legacy thinkingEfforts 折叠
                  ...(typeof m.supportsThinking === 'boolean'
                    ? { supportsThinking: m.supportsThinking }
                    : m.thinkingEfforts === false
                      ? { supportsThinking: false }
                      : m.thinkingEfforts !== undefined
                        ? { supportsThinking: true }
                        : {}),
                  thinkingEfforts:
                    m.thinkingEfforts === false || Array.isArray(m.thinkingEfforts)
                      ? m.thinkingEfforts
                      : undefined,
                  thinkingEffortsMap: normalizeEffortMap(m.thinkingEffortsMap),
                  thinkingEffortsPatch: normalizeEffortPatch(m.thinkingEffortsPatch),
                  ...(typeof m.thinkingPatchExpr === 'string' && m.thinkingPatchExpr.trim()
                    ? { thinkingPatchExpr: m.thinkingPatchExpr.trim() }
                    : {}),
                  ...(compat ? { compat } : {}),
                };
              })
          : [];
        // legacy：卡片 provider 级 thinking.style 归一到 compat.thinkingFormat
        const legacyCardFormat = normalizeThinkingFormat(raw.thinking?.style);
        const compat = mergeThinkingCompat(
          legacyCardFormat ? { thinkingFormat: legacyCardFormat } : undefined,
          parseThinkingCompat(raw.compat),
        );
        const thinking =
          raw.thinking && typeof raw.thinking === 'object' &&
          Array.isArray(raw.thinking.defaultEfforts)
            ? {
                defaultEfforts: raw.thinking.defaultEfforts.map(String),
              }
            : undefined;
        this.cards.set(type, {
          type,
          name: typeof raw.name === 'string' ? raw.name : type,
          description:
            typeof raw.description === 'string' ? raw.description : undefined,
          apiKeyUrl: typeof raw.apiKeyUrl === 'string' ? raw.apiKeyUrl : undefined,
          avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : undefined,
          protocol:
            typeof raw.protocol === 'string' ? raw.protocol : 'openai',
          defaultApiUrl:
            typeof raw.defaultApiUrl === 'string' ? raw.defaultApiUrl : undefined,
          ...(thinking ? { thinking } : {}),
          ...(compat ? { compat } : {}),
          models,
        });
      } catch (err) {
        this.logger.warn(`Invalid bundled card "${entry.name}": ${String(err)}`);
      }
    }
    this.logger.log(
      `Bundled provider catalog loaded: ${this.cards.size} type card(s)`,
    );
  }

  /** 类型是否存在 */
  hasType(type: string): boolean {
    this.ensureLoaded();
    return this.cards.has(type);
  }

  getType(type: string): BundledTypeCard | undefined {
    this.ensureLoaded();
    return this.cards.get(type);
  }

  /** 全部类型卡（「可添加供应商」模板列表数据源，全量不过滤） */
  listTypes(): BundledTypeCard[] {
    this.ensureLoaded();
    return Array.from(this.cards.values());
  }

  /** 类型模型目录（实例继承的默认清单） */
  getCatalogModels(type: string): CatalogModel[] {
    this.ensureLoaded();
    return this.cards.get(type)?.models || [];
  }
}
