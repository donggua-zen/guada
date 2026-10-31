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
  /**
   * 卡片级请求体压缩默认值：该类型的所有实例默认对大 JSON 请求体做 gzip。
   * 通用传输能力（任何协议可用）；实例 YAML 显式 false 可覆盖。
   */
  requestCompression?: boolean;
  models: CatalogModel[];
}

/**
 * 类型卡（含来源元数据）
 *
 * builtin = bundled-providers/*.yaml 随应用分发；
 * plugin = 供应商包贡献（禁用/卸载后从查询面消失，但定义可保留）。
 */
export interface ProviderTypeCard extends BundledTypeCard {
  source?: 'builtin' | 'plugin';
  /** 贡献该类型卡的插件 id（source=plugin 时存在） */
  pluginId?: string;
}

/** 类型卡来源快照（供管理面判断「类型是否仍可用」） */
export interface ProviderTypeSource {
  source: 'builtin' | 'plugin';
  pluginId?: string;
  active: boolean;
}

interface PluginCardEntry {
  card: ProviderTypeCard;
  pluginId: string;
  active: boolean;
}

/** 把原始 YAML 文档归一为类型卡（bundled 与插件包共用） */
export function parseProviderTypeCard(
  raw: Record<string, any>,
  fallbackType: string,
): BundledTypeCard {
  const type =
    typeof raw.type === 'string' && raw.type.trim()
      ? raw.type.trim()
      : fallbackType;
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
            modelType: typeof m.modelType === 'string' ? m.modelType : 'text',
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
    raw.thinking &&
    typeof raw.thinking === 'object' &&
    Array.isArray(raw.thinking.defaultEfforts)
      ? { defaultEfforts: raw.thinking.defaultEfforts.map(String) }
      : undefined;
  return {
    type,
    name: typeof raw.name === 'string' ? raw.name : type,
    description:
      typeof raw.description === 'string' ? raw.description : undefined,
    apiKeyUrl: typeof raw.apiKeyUrl === 'string' ? raw.apiKeyUrl : undefined,
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : undefined,
    protocol: typeof raw.protocol === 'string' ? raw.protocol : 'openai',
    defaultApiUrl:
      typeof raw.defaultApiUrl === 'string' ? raw.defaultApiUrl : undefined,
    ...(raw.requestCompression === true ? { requestCompression: true } : {}),
    ...(thinking ? { thinking } : {}),
    ...(compat ? { compat } : {}),
    models,
  };
}

/**
 * 供应商类型目录服务（对齐 DSH pi-ai catalog）
 *
 * bundled-providers/*.yaml 是随应用版本分发的**类型目录数据**：
 * 「可添加供应商」模板与模型目录的唯一权威来源。用户实例文件不复制目录，
 * 运行时按 modelName 条目级继承 + 覆盖（见 ProviderFileStore 的合并逻辑），
 * 目录随应用升级自动流到未覆盖的实例。
 *
 * 插件化扩展：供应商包可通过 registerPluginCards 贡献额外类型卡；
 * 查询面始终是「bundled + 当前启用插件卡」的并集。内置 type 是保留位，
 * 插件不得覆盖（防止伪装官方供应商模板）。
 */
@Injectable()
export class BundledCatalogService {
  private readonly logger = new Logger(BundledCatalogService.name);
  private readonly cards = new Map<string, BundledTypeCard>();
  private readonly pluginCards = new Map<string, PluginCardEntry>();
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
        const card = parseProviderTypeCard(
          doc as Record<string, any>,
          path.basename(entry.name, ext),
        );
        this.cards.set(card.type, card);
      } catch (err) {
        this.logger.warn(`Invalid bundled card "${entry.name}": ${String(err)}`);
      }
    }
    this.logger.log(
      `Bundled provider catalog loaded: ${this.cards.size} type card(s)`,
    );
  }

  // ── 插件贡献 ──

  /** 校验插件类型卡（不落库）；返回冲突/非法原因 */
  validatePluginCards(pluginId: string, cards: ProviderTypeCard[]): string[] {
    this.ensureLoaded();
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      const type = typeof card?.type === 'string' ? card.type.trim() : '';
      if (!type) {
        errors.push(`plugin "${pluginId}" contributed a type card without type`);
        continue;
      }
      if (typeof card.protocol !== 'string' || !card.protocol.trim()) {
        errors.push(`provider type "${type}" must declare a non-empty protocol`);
        continue;
      }
      if (card.models !== undefined && !Array.isArray(card.models)) {
        errors.push(`provider type "${type}" models must be an array`);
        continue;
      }
      if (seen.has(type)) {
        errors.push(`plugin "${pluginId}" contributes duplicate type "${type}"`);
        continue;
      }
      seen.add(type);
      if (this.cards.has(type)) {
        errors.push(
          `type "${type}" is reserved by builtin catalog; plugin "${pluginId}" cannot override it`,
        );
        continue;
      }
      const existing = this.pluginCards.get(type);
      if (existing && existing.pluginId !== pluginId) {
        errors.push(
          `type "${type}" is already contributed by plugin "${existing.pluginId}"; plugin "${pluginId}" cannot override it`,
        );
      }
    }
    return errors;
  }

  /** 整组注册插件类型卡（同插件重载时先清旧卡） */
  registerPluginCards(pluginId: string, cards: ProviderTypeCard[]): void {
    const errors = this.validatePluginCards(pluginId, cards);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    for (const [type, entry] of this.pluginCards) {
      if (entry.pluginId === pluginId) this.pluginCards.delete(type);
    }
    for (const card of cards) {
      const type = card.type.trim();
      const normalized: ProviderTypeCard = {
        ...card,
        type,
        name: card.name || type,
        protocol: card.protocol.trim(),
        models: Array.isArray(card.models) ? card.models : [],
        source: 'plugin',
        pluginId,
      };
      this.pluginCards.set(type, {
        card: normalized,
        pluginId,
        active: true,
      });
      // 与 bundled catalog-lint 同语义的软告警：未声明能力的非 embedding 模型
      // 会按「不能思考」处理，第三方作者容易漏写。
      const missing = normalized.models
        .filter(
          (m) => m.modelType !== 'embedding' && typeof m.supportsThinking !== 'boolean',
        )
        .map((m) => m.modelName);
      if (missing.length > 0) {
        this.logger.warn(
          `Provider type "${type}" (plugin ${pluginId}) has models without supportsThinking: ${missing.join(', ')}`,
        );
      }
    }
    this.logger.log(
      `Plugin ${pluginId} contributed ${cards.length} provider type card(s)`,
    );
  }

  /** 移除某插件的全部类型卡（卸载/重载） */
  removePlugin(pluginId: string): void {
    let removed = 0;
    for (const [type, entry] of this.pluginCards) {
      if (entry.pluginId === pluginId) {
        this.pluginCards.delete(type);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.log(`Removed ${removed} provider type card(s) from plugin ${pluginId}`);
    }
  }

  /** 插件启停：保留定义，仅切换可用性 */
  setPluginActive(pluginId: string, active: boolean): void {
    for (const entry of this.pluginCards.values()) {
      if (entry.pluginId === pluginId) entry.active = active;
    }
  }

  // ── 查询 ──

  /** 类型是否存在且当前可用 */
  hasType(type: string): boolean {
    this.ensureLoaded();
    if (this.cards.has(type)) return true;
    const pluginCard = this.pluginCards.get(type);
    return pluginCard?.active === true;
  }

  getType(type: string): ProviderTypeCard | undefined {
    this.ensureLoaded();
    const bundled = this.cards.get(type);
    if (bundled) return { ...bundled, source: 'builtin' };
    const pluginCard = this.pluginCards.get(type);
    return pluginCard?.active ? pluginCard.card : undefined;
  }

  /** 全部可用类型卡（「可添加供应商」模板列表数据源） */
  listTypes(): ProviderTypeCard[] {
    this.ensureLoaded();
    const out: ProviderTypeCard[] = Array.from(this.cards.values()).map((card) => ({
      ...card,
      source: 'builtin',
    }));
    for (const entry of this.pluginCards.values()) {
      if (entry.active) out.push(entry.card);
    }
    return out;
  }

  /** 全部类型卡（含禁用插件贡献；供管理/诊断，不下发模板列表） */
  listAllTypes(): ProviderTypeCard[] {
    this.ensureLoaded();
    const out: ProviderTypeCard[] = Array.from(this.cards.values()).map((card) => ({
      ...card,
      source: 'builtin',
    }));
    for (const entry of this.pluginCards.values()) out.push(entry.card);
    return out;
  }

  /** 类型来源快照；未知类型返回 undefined */
  getTypeSource(type: string): ProviderTypeSource | undefined {
    this.ensureLoaded();
    if (this.cards.has(type)) return { source: 'builtin', active: true };
    const entry = this.pluginCards.get(type);
    if (entry) {
      return { source: 'plugin', pluginId: entry.pluginId, active: entry.active };
    }
    return undefined;
  }

  /** 类型模型目录（实例继承的默认清单；禁用插件卡不可见） */
  getCatalogModels(type: string): CatalogModel[] {
    this.ensureLoaded();
    const bundled = this.cards.get(type);
    if (bundled) return bundled.models;
    const pluginCard = this.pluginCards.get(type);
    return pluginCard?.active ? pluginCard.card.models : [];
  }
}
