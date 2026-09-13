import {
  MODEL_PRESETS,
  findModelPreset,
} from '../../src/modules/llm-core/model-preset-library';
import {
  GENERIC_EFFORT_MENU,
  resolveThinkingEfforts,
} from '../../src/modules/llm-core/thinking/resolve-thinking-efforts';

/**
 * 预设库契约测试
 *
 * 覆盖两类曾经无测试保护的风险：
 * 1. **顺序**：匹配是"按数组顺序，首个命中即返回"，更具体的模式必须排在
 *    catch-all 前面（如 `gpt-4.1` 必须先于 `gpt-4-general`，`mistral-medium`
 *    先于 `mistral`）。顺序写错会让模型静默拿到错误规格。
 * 2. **声明完整**：每条预设都要显式声明 supportsThinking，否则该模型会退化成
 *    "不能思考"（能力必须被声明的 fail-safe）。
 */

/** 抽取关键规格，便于断言 */
const specOf = (modelName: string) => {
  const p = findModelPreset(modelName);
  if (!p) return null;
  return {
    id: p.id,
    ctx: p.config?.contextWindow,
    max: p.config?.maxOutputTokens,
    input: (p.config?.inputCapabilities || []).join('+'),
    tools: (p.config?.features || []).includes('tools'),
    // 与运行时同链：模型名决定 preset，preset 决定能力/档位
    menu: resolveThinkingEfforts(
      {
        modelName,
        supportsThinking: p.supportsThinking,
        thinkingEfforts: p.thinkingEfforts as any,
      },
      undefined,
    ),
  };
};

describe('预设库：顺序（具体模式必须先于 catch-all）', () => {
  const cases: Array<[string, string]> = [
    // [模型名, 期望命中的 preset id]
    ['gpt-4.1', 'gpt-4.1'],
    ['gpt-4.1-mini', 'gpt-4.1'],
    ['gpt-4.1-nano', 'gpt-4.1'],
    ['gpt-4o', 'gpt-4o'],
    ['gpt-4-turbo', 'gpt-4-turbo'],
    ['gpt-4', 'gpt-4-general'], // 兜底：未被上面更具体规则吃掉的 gpt-4
    ['gpt-realtime-2.1', 'gpt-realtime'],
    ['gpt-5.6-sol', 'gpt-5.6'],
    ['gpt-5.5', 'gpt-5.5'],
    ['gpt-5.4', 'gpt-5.4'],
    ['gpt-5-mini', 'gpt-5-mini'],
    ['gpt-3.5-turbo', 'gpt-3.5'],
    // Mistral：medium/small/large/devstral/magistral 必须先于 mistral-general
    ['mistral-medium-2604', 'mistral-medium'],
    ['mistral-medium-3.5', 'mistral-medium'],
    ['mistral-small-latest', 'mistral-small'],
    ['mistral-large-2512', 'mistral-large'],
    ['magistral-medium-latest', 'magistral'],
    ['devstral-2512', 'devstral'],
    ['ministral-8b-latest', 'mistral-general'],
    ['pixtral-12b', 'mistral-general'],
    ['codestral-latest', 'mistral-general'],
    ['voxtral-small-latest', 'mistral-general'],
    // Grok：4.5 有真档位，其余走 general
    ['grok-4.5', 'grok-4.5'],
    ['grok-4.6', 'grok-general'],
    ['grok-build-0.1', 'grok-general'],
    // MiniMax
    ['MiniMax-M3', 'minimax-m3'],
    ['MiniMax-M2.7', 'minimax-m2.7'],
    ['MiniMax-M2.5', 'minimax-general'],
    // MiMo
    ['mimo-v2.5', 'mimo-v2.5'],
    ['mimo-v2.5-pro', 'mimo-v2.5'],
    ['mimo-v2-flash', 'mimo-v2'],
    // Ant Ling
    ['Ring-2.6-1T', 'ant-ring'],
    ['Ling-2.6-1T', 'ant-ling'],
    // Google
    ['gemma-4-31b-it', 'gemma-4'],
    ['deep-research-preview-04-2026', 'gemini-deep-research'],
    ['gemini-3.1-pro-preview', 'gemini-3-pro'],
    ['gemini-2.5-flash', 'gemini-2.5'],
    // 既有家族不回归
    ['claude-opus-5', 'claude-opus-5'],
    ['deepseek-v4-pro', 'deepseek-v4'],
    ['kimi-k2.5', 'kimi-general'],
    ['glm-5', 'glm-5'],
    ['qwen3.5-397b-a17b', 'qwen-general'],
    ['text-embedding-3-small', 'embedding-openai-small'],
    // 开源权重家族（聚合站常见）
    ['gpt-oss-120b', 'gpt-oss'],
    ['openai/gpt-oss-20b', 'gpt-oss'],
    ['gemma-3-12b-it', 'gemma'],
    ['google.gemma-3-4b-it', 'gemma'],
    ['meta-llama/Llama-3.3-70B-Instruct', 'llama'],
    ['meta/muse-spark-1.2', 'llama'],
    ['bytedance/seed-1.8', 'seed-doubao'],
    ['seed-2.0-code', 'seed-doubao'],
    ['doubao-seed-1.6', 'seed-doubao'],
    ['hy3', 'hunyuan'],
    ['tencent/hy3-preview', 'hunyuan'],
    ['step-3.7-flash', 'stepfun'],
    ['nvidia/nemotron-3-ultra-550b-a55b', 'nemotron'],
    ['amazon/nova-pro-v1', 'nova-amazon'],
    ['amazon.nova-lite-v1:0', 'nova-amazon'],
    ['meituan/longcat-2.0', 'longcat'],
    ['solar-pro4', 'solar-upstage'],
    ['thinkingmachines/inkling', 'inkling'],
    ['poolside/laguna-s-2.1', 'laguna'],
    ['kwaipilot/kat-coder-pro-v2', 'kat-coder'],
    ['cohere/command-a', 'general-open-weight'],
    ['ai21/jamba-large-1.7', 'general-open-weight'],
    ['ibm-granite/granite-4.1-8b', 'general-open-weight'],
    ['inception/mercury-2', 'general-open-weight'],
    ['arcee-ai/trinity-mini', 'general-open-weight'],
    // 裸 k3（kimi-coding 上的短名）必须也能命中
    ['k3', 'kimi-k3'],
    ['k3-256k', 'kimi-k3-256k'],
    // 编码专用：for-coding 已升级到 K3 级（1M），须与 k2.7-code（256K）区分
    ['kimi-for-coding', 'kimi-for-coding'],
    ['kimi-for-coding-highspeed', 'kimi-for-coding'],
    ['kimi-k2.7-code', 'kimi-code'],
  ];

  for (const [model, expected] of cases) {
    it(`${model} → ${expected}`, () => {
      expect(findModelPreset(model)?.id).toBe(expected);
    });
  }
});

describe('预设库：声明完整性', () => {
  it('每条**对话**预设都显式声明 supportsThinking（布尔）', () => {
    // embedding 预设豁免：解析链对嵌入模型横切返回空菜单，能力声明无意义
    const missing = MODEL_PRESETS.filter((p) => p.modeType !== 'embedding')
      .filter((p) => typeof p.supportsThinking !== 'boolean')
      .map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it('embedding 预设不声明思考能力（横切排除，声明会误导）', () => {
    const offenders = MODEL_PRESETS.filter((p) => p.modeType === 'embedding')
      .filter((p) => p.supportsThinking !== undefined)
      .map((p) => p.id);
    expect(offenders).toEqual([]);
  });

  it('supportsThinking: false 的条目不得携带档位数组', () => {
    const offenders = MODEL_PRESETS.filter(
      (p) => p.supportsThinking === false && Array.isArray(p.thinkingEfforts),
    ).map((p) => p.id);
    expect(offenders).toEqual([]);
  });

  it('每条预设的档位都在正典词表内', () => {
    const canonical = new Set([
      'none',
      'on',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    const offenders: string[] = [];
    for (const p of MODEL_PRESETS) {
      for (const e of p.thinkingEfforts || []) {
        if (!canonical.has(e)) offenders.push(`${p.id}: ${e}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('每条预设都有 config 且带 contextWindow（避免空规格入库）', () => {
    const offenders = MODEL_PRESETS.filter(
      (p) => !p.config || !p.config.contextWindow,
    ).map((p) => p.id);
    expect(offenders).toEqual([]);
  });

  it('正则 pattern 均不含全局标志（g 会因 lastIndex 造成间歇性漏匹配）', () => {
    const offenders: string[] = [];
    for (const p of MODEL_PRESETS) {
      for (const r of p.patterns) {
        if (r.global || r.sticky) offenders.push(`${p.id}: ${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('预设库：档位与兜底的边界', () => {
  it('未命中预设的模型走通用兜底（而非误命中某条 catch-all）', () => {
    const unknown = 'some-company-internal-llm-v3';
    expect(findModelPreset(unknown)).toBeNull();
    expect(
      resolveThinkingEfforts({ modelName: unknown }, undefined),
    ).toEqual(GENERIC_EFFORT_MENU);
  });

  it('grok-4.5 声明低/中/高三档（官方无 off）', () => {
    const p = findModelPreset('grok-4.5')!;
    expect(p.supportsThinking).toBe(true);
    expect(p.thinkingEfforts).toEqual(['low', 'medium', 'high']);
  });

  it('grok 4.3/4.6 为纯开关型（强度值上不了 wire）', () => {
    for (const m of ['grok-4.6', 'grok-4.3']) {
      const p = findModelPreset(m)!;
      expect(p.supportsThinking).toBe(true);
      expect(p.thinkingEfforts).toEqual(['none', 'on']);
    }
  });

  it('gemma-4 只声明 minimal/high（官方低中档显式不支持）', () => {
    expect(findModelPreset('gemma-4-31b-it')!.thinkingEfforts).toEqual([
      'minimal',
      'high',
    ]);
  });

  it('Ring 强制推理（无 none，不可关）', () => {
    const menu = specOf('Ring-2.6-1T')!.menu;
    expect(menu).toEqual(['high', 'xhigh']);
    expect(menu).not.toContain('none');
  });

  it('MiniMax 与 Ling 系按既有约定声明不可思考', () => {
    expect(specOf('MiniMax-M3')!.menu).toEqual([]);
    expect(specOf('Ling-2.6-1T')!.menu).toEqual([]);
  });
});

describe('预设库：规格抽样（对照 DSH 目录）', () => {
  it('MiMo v2.5 为 1M 多模态', () => {
    const s = specOf('mimo-v2.5')!;
    expect(s.ctx).toBe(1000000);
    expect(s.input).toBe('text+image');
    expect(s.tools).toBe(true);
  });

  it('Gemma 4 为 262K 多模态', () => {
    const s = specOf('gemma-4-31b-it')!;
    expect(s.ctx).toBe(262144);
    expect(s.max).toBe(32000);
    expect(s.input).toBe('text+image');
  });

  it('gpt-4.1 为 1M 多模态（非 8K，验证未被 gpt-4-general 抢走）', () => {
    const s = specOf('gpt-4.1-mini')!;
    expect(s.ctx).toBe(1000000);
    expect(s.input).toBe('text+image');
  });

  it('gpt-4 走兜底为 8K 纯文本', () => {
    const s = specOf('gpt-4')!;
    expect(s.ctx).toBe(8000);
    expect(s.input).toBe('text');
  });

  it('mistral-medium 为 262K 多模态', () => {
    const s = specOf('mistral-medium-latest')!;
    expect(s.ctx).toBe(262144);
    expect(s.input).toBe('text+image');
  });
});
