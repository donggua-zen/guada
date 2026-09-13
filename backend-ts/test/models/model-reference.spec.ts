import {
  buildModelIdMap,
  planModelRefRewrite,
} from '../../src/common/database/bootstrap/model-reference-migration';

/**
 * 存量模型引用改写（纯决策层）
 *
 * 迁移可重复执行是硬要求（启动自愈 + 快照还原后重跑），
 * 因此「已是文件 id」「空值」必须稳定跳过，只有旧 id 才进映射。
 */
describe('模型引用改写决策', () => {
  const legacyRows = [
    { id: 'cuid-a', modelName: 'deepseek-v4-flash', providerId: 'inst-deepseek' },
    { id: 'cuid-b', modelName: 'deepseek-v4-flash', providerId: 'inst-custom' },
    { id: 'cuid-c', modelName: 'Qwen/Qwen3-Embedding-8B', providerId: 'inst-sf' },
  ];
  const map = buildModelIdMap(legacyRows);
  const resolvable = (id: string) => id !== 'inst-custom:deepseek-v4-flash';
  const plan = (v: string | null | undefined) => planModelRefRewrite(v, map, resolvable);

  it('映射前缀取实例 id（同名模型分属两个实例时不会串）', () => {
    expect(map.get('cuid-a')).toBe('inst-deepseek:deepseek-v4-flash');
    expect(map.get('cuid-b')).toBe('inst-custom:deepseek-v4-flash');
  });

  it('空值跳过（表示未配置，不是坏引用）', () => {
    expect(plan(null)).toEqual({ kind: 'empty' });
    expect(plan(undefined)).toEqual({ kind: 'empty' });
    expect(plan('')).toEqual({ kind: 'empty' });
  });

  it('已是文件 id 跳过（迁移幂等）', () => {
    expect(plan('inst-deepseek:deepseek-v4-flash')).toEqual({ kind: 'already-file-id' });
    // 含 `/` 的模型名同样按文件 id 处理，不会误判成旧 id
    expect(plan('inst-sf:Qwen/Qwen3-Embedding-8B')).toEqual({ kind: 'already-file-id' });
  });

  it('旧 id 映射成功且目标可解析 → 改写', () => {
    expect(plan('cuid-a')).toEqual({
      kind: 'rewritten',
      from: 'cuid-a',
      to: 'inst-deepseek:deepseek-v4-flash',
    });
    expect(plan('cuid-c')).toEqual({
      kind: 'rewritten',
      from: 'cuid-c',
      to: 'inst-sf:Qwen/Qwen3-Embedding-8B',
    });
  });

  it('映射缺失 → unresolved（保持原值，运行期 fail-loud）', () => {
    expect(plan('cuid-not-in-table')).toEqual({
      kind: 'unresolved',
      from: 'cuid-not-in-table',
    });
  });

  it('映射出的模型文件已不存在 → unresolved，不写坏引用', () => {
    expect(plan('cuid-b')).toEqual({ kind: 'unresolved', from: 'cuid-b' });
  });

  it('buildModelIdMap 丢弃残缺行', () => {
    const m = buildModelIdMap([
      { id: 'x', modelName: '', providerId: 'p' },
      { id: '', modelName: 'm', providerId: 'p' },
      { id: 'y', modelName: 'm', providerId: '' },
      { id: 'z', modelName: 'm', providerId: 'p' },
    ]);
    expect([...m.keys()]).toEqual(['z']);
  });
});
