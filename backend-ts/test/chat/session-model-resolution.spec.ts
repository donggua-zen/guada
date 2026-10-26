/**
 * 会话模型解析（单一数据源 = providers/*.yaml）
 *
 * 覆盖三点：
 * - 三级顺序：内存挂载（bot enrich）→ 会话自选 modelId → 智能体 modelId
 * - 会话自选 modelId 必须被真正使用（此前被 session.model 掩盖）
 * - 全部解析不到 → fail-loud（ModelNotResolvedError），不再静默换模型
 */
import { JsonlSessionContext } from '../../src/modules/chat/jsonl-session-context';
import { ModelNotResolvedError } from '../../src/modules/llm-core/model-not-resolved.error';

/// <reference types="jest" />

const FILE_MODEL = {
  id: 'inst1:m1',
  modelName: 'm1',
  name: 'M1',
  provider: { id: 'inst1', type: 'custom', protocol: 'openai' },
  modelType: 'text',
  config: { contextWindow: 8000, features: ['tools'], inputCapabilities: [] },
};

function createContext(opts: {
  session?: any;
  findModel?: (id: string) => any;
}) {
  const modelStore = {
    findModel: jest.fn((id: string) => (opts.findModel ? opts.findModel(id) : undefined)),
  };
  const messageStore = {
    loadContext: jest.fn(async () => []),
    getLastProcessedSeq: jest.fn(async () => 0),
    appendMessages: jest.fn(async () => ({ added: [], revision: 0 })),
  };
  const ctx = new JsonlSessionContext(
    {
      id: 's1',
      sessionType: 'web',
      modelId: undefined,
      settings: { systemPrompt: 'sys' },
      ...(opts.session || {}),
    },
    messageStore as any,
    modelStore as any,
    { resolvePlugins: jest.fn(async () => []) } as any,
    { collectPrompts: jest.fn(async () => []) } as any,
    { resolveSessionWorkspaceDir: jest.fn(async () => '') } as any,
    {
      estimateMessages: jest.fn(async () => 0),
      estimatePerMessage: jest.fn(async () => []),
      estimateTextTokens: jest.fn(async () => 0),
    } as any,
    { publish: jest.fn() } as any,
    { findByIds: jest.fn(async () => []) } as any,
    // RemoteBindingStateService：本用例不涉及远程绑定
    {
      getSnapshotIds: jest.fn(async (_sid: string, live: string[]) => live),
      buildChangeReminder: jest.fn(async () => null),
    } as any,
  );
  return { ctx, modelStore };
}

describe('会话模型解析', () => {
  it('内存挂载优先（bot 路径已 enrich），不查 store', async () => {
    const { ctx, modelStore } = createContext({
      session: { model: FILE_MODEL, modelId: 'inst-ignored:x' },
    });
    await ctx.initialize();

    expect(ctx.getModelConfig().modelName).toBe('m1');
    expect(modelStore.findModel).not.toHaveBeenCalled();
  });

  it('无挂载时使用会话自选 modelId', async () => {
    const { ctx, modelStore } = createContext({
      session: { modelId: 'inst1:m1' },
      findModel: (id) => (id === 'inst1:m1' ? FILE_MODEL : undefined),
    });
    await ctx.initialize();

    expect(modelStore.findModel).toHaveBeenCalledWith('inst1:m1');
    expect(ctx.getModelConfig().modelName).toBe('m1');
  });

  it('会话未配置模型 → 回退智能体默认模型', async () => {
    const agentModel = {
      ...FILE_MODEL,
      id: 'inst-agent:m2',
      modelName: 'm2',
      provider: { id: 'inst-agent', type: 'custom', protocol: 'openai' },
    };
    const { ctx } = createContext({
      session: { modelId: null, agent: { modelId: 'inst-agent:m2' } },
      findModel: (id) => (id === 'inst-agent:m2' ? agentModel : undefined),
    });
    await ctx.initialize();

    expect(ctx.getModelConfig().modelName).toBe('m2');
  });

  it('自选模型解析不到 → fail-loud（不静默换模型）', async () => {
    const { ctx } = createContext({
      session: { modelId: 'inst-deleted:gone' },
      findModel: () => undefined,
    });

    await expect(ctx.initialize()).rejects.toThrow(ModelNotResolvedError);
    try {
      await ctx.initialize();
    } catch (e: any) {
      expect(e.code).toBe('MODEL_NOT_RESOLVED');
      expect(e.message).toContain('inst-deleted:gone');
    }
  });

  it('会话和智能体都没有模型 → fail-loud 提示去配置', async () => {
    const { ctx } = createContext({ session: { modelId: null, agent: null } });

    await expect(ctx.initialize()).rejects.toThrow(ModelNotResolvedError);
  });

  it('智能体模型也解析不到 → fail-loud 并带上模型 id', async () => {
    const { ctx } = createContext({
      session: { modelId: null, agent: { modelId: 'inst-agent:gone' } },
      findModel: () => undefined,
    });

    await expect(ctx.initialize()).rejects.toThrow(ModelNotResolvedError);
    try {
      await ctx.initialize();
    } catch (e: any) {
      expect(e.message).toContain('inst-agent:gone');
    }
  });
});

describe('思考能力由档位菜单承载（gate 与请求校验同源）', () => {
  const makeModel = (thinkingEfforts: string[] | undefined, modelName = 'm1') => ({
    id: `inst1:${modelName}`,
    modelName,
    name: modelName,
    provider: { id: 'inst1', type: 'custom', protocol: 'openai' },
    modelType: 'text',
    thinkingEfforts,
    config: { contextWindow: 8000, features: ['tools'], inputCapabilities: [] },
  });

  const createContextWith = (model: any, thinkingEffort?: string) => {
    const harness = createContext({
      session: { model, settings: { systemPrompt: 'sys', thinkingEffort } },
      findModel: (id) => (id === model.id ? model : undefined),
    });
    return harness;
  };

  it('菜单非空 → 存量档位透传，ModelConfig 携带菜单', async () => {
    const { ctx } = createContextWith(makeModel(['none', 'low', 'high']), 'high');
    await ctx.initialize();

    expect(ctx.getModelConfig().thinkingEfforts).toEqual(['none', 'low', 'high']);
    expect(ctx.getThinkingEffort()).toBe('high');
  });

  it('菜单无 none（[high,max]）且存量为 none → 按请求侧同一策略调整到 high', async () => {
    // 旧实现这里 relay 判定为"关"而实际请求发 high —— 两套规则的分叉
    const { ctx } = createContextWith(makeModel(['high', 'max']), 'none');
    await ctx.initialize();

    expect(ctx.getThinkingEffort()).toBe('high');
  });

  it('菜单为空（不能思考）+ 存量非 none → 不发参数也不报错', async () => {
    const { ctx } = createContextWith(makeModel([]), 'high');
    await ctx.initialize();

    expect(ctx.getThinkingEffort()).toBeUndefined();
  });

  it('只声明 none 的模型同样不能思考', async () => {
    const { ctx } = createContextWith(makeModel(['none']), 'high');
    await ctx.initialize();

    expect(ctx.getThinkingEffort()).toBeUndefined();
  });
});
