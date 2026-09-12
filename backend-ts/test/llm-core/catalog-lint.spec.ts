import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * 目录 lint：类型卡的每个模型条目必须显式声明思考能力 + compat 值域合法
 *
 * 「能力与档位分离」之后：supportsThinking 表达能不能思考，thinkingEfforts
 * 只表达档位。任何漏声明的条目都会静默变成"不能思考"——只能靠 lint 拦住。
 *
 * 规则：
 * - 非 embedding 条目必须声明 supportsThinking（布尔）
 * - 类型卡不得再出现 provider 级 thinking.defaultEfforts（那是"白送档位"的兜底）
 * - config.features 不得再出现 thinking（档位声明只属于 supportsThinking 的模型）
 * - compat.thinkingFormat 必须在 11 值词表内（legacy style 值视为未声明即失败）
 * - legacy thinking.style 不得再出现（已由 compat.thinkingFormat 取代）
 * - supportsThinking: false 与档位数组不得并存（语义冲突）
 * - on 菜单 × openrouter format = 违规（on 会被当作 effort 值发出）
 */
const CARDS_DIR = path.join(__dirname, '..', '..', 'bundled-providers');

const VALID_FORMATS = new Set([
  'openai',
  'deepseek',
  'zai',
  'qwen',
  'openrouter',
  'together',
  'baseten',
  'ant-ling',
  'string-thinking',
  'qwen-chat-template',
  'chat-template',
]);

interface CardModel {
  modelName?: string;
  modelType?: string;
  supportsThinking?: unknown;
  thinkingEfforts?: unknown;
  thinkingEffortsMap?: unknown;
  thinking?: { style?: unknown };
  compat?: { thinkingFormat?: unknown };
  config?: { features?: string[] };
}

interface Card {
  type?: string;
  thinking?: { defaultEfforts?: unknown; style?: unknown };
  compat?: { thinkingFormat?: unknown };
  models?: CardModel[];
}

const cardFiles = fs
  .readdirSync(CARDS_DIR)
  .filter((f) => f.endsWith('.yaml'));

const isEmbedding = (m: CardModel) =>
  m.modelType === 'embedding' || /embedding|embed/i.test(m.modelName || '');

/** on 菜单只对有真开关字段的 format 有意义；openrouter 会把 'on' 当 effort 值发出 */
const SWITCH_FORMATS = new Set([
  'deepseek',
  'zai',
  'qwen',
  'together',
  'baseten',
  'string-thinking',
  'qwen-chat-template',
  'chat-template',
]);

const menuOf = (m: CardModel): string[] | undefined => {
  if (m.thinkingEffortsMap && typeof m.thinkingEffortsMap === 'object') {
    return Object.entries(m.thinkingEffortsMap as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && v)
      .map(([k]) => k);
  }
  if (Array.isArray(m.thinkingEfforts)) return m.thinkingEfforts.map(String);
  return undefined;
};

describe('类型卡目录 lint', () => {
  it('存在类型卡（防路径写错导致空跑）', () => {
    expect(cardFiles.length).toBeGreaterThan(0);
  });

  for (const file of cardFiles) {
    describe(file, () => {
      const card = yaml.load(
        fs.readFileSync(path.join(CARDS_DIR, file), 'utf8'),
      ) as Card;
      const models = card?.models || [];

      it('不得声明 provider 级 thinking.defaultEfforts（能力必须逐模型声明）', () => {
        expect(card?.thinking?.defaultEfforts).toBeUndefined();
      });

      it('每个非 embedding 条目都显式声明 supportsThinking（能力必须被声明）', () => {
        const missing = models
          .filter((m) => !isEmbedding(m))
          .filter((m) => typeof m.supportsThinking !== 'boolean')
          .map((m) => m.modelName);
        expect(missing).toEqual([]);
      });

      it('supportsThinking: false 与档位数组不得并存（语义冲突）', () => {
        const offenders = models
          .filter((m) => m.supportsThinking === false && Array.isArray(m.thinkingEfforts))
          .map((m) => m.modelName);
        expect(offenders).toEqual([]);
      });

      it('on 菜单 × openrouter format = 违规（on 会被当作 effort 值发出）', () => {
        const cardFormat = card?.compat?.thinkingFormat as string | undefined;
        const offenders: string[] = [];
        for (const m of models) {
          const format = (m.compat?.thinkingFormat as string | undefined) ?? cardFormat;
          const menu = menuOf(m);
          if (format === 'openrouter' && menu?.includes('on')) {
            offenders.push(m.modelName || '(unknown)');
          }
        }
        expect(offenders).toEqual([]);
      });

      it('features 不再携带 thinking 标记', () => {
        const offenders = models
          .filter((m) => (m.config?.features || []).includes('thinking'))
          .map((m) => m.modelName);
        expect(offenders).toEqual([]);
      });

      it('compat.thinkingFormat 在 11 值词表内（provider 级 + 逐模型）', () => {
        const offenders: string[] = [];
        const cardFormat = card?.compat?.thinkingFormat;
        if (cardFormat !== undefined && !VALID_FORMATS.has(cardFormat as string)) {
          offenders.push(`(provider 级: ${String(cardFormat)})`);
        }
        for (const m of models) {
          const f = m.compat?.thinkingFormat;
          if (f !== undefined && !VALID_FORMATS.has(f as string)) {
            offenders.push(`${m.modelName}: ${String(f)}`);
          }
        }
        expect(offenders).toEqual([]);
      });

      it('不再使用 legacy thinking.style（由 compat.thinkingFormat 取代）', () => {
        const offenders: string[] = [];
        if (card?.thinking?.style !== undefined) {
          offenders.push('(provider 级 thinking.style)');
        }
        for (const m of models) {
          if (m.thinking?.style !== undefined) {
            offenders.push(`${m.modelName}: thinking.style`);
          }
        }
        expect(offenders).toEqual([]);
      });
    });
  }
});
