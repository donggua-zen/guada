/// <reference types="jest" />

/**
 * 检索质量指标：手算样例校验
 *
 * 这些指标是后续所有"检索优化是否有效"的判据，算错了会让优化方向整个跑偏。
 * 所以每个指标都用**能手算验证**的小样例钉住，而不是"跑一下看着差不多"。
 */

import {
  average,
  compareEval,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
  scoreQuery,
  summarize,
  type EvalQuery,
} from '../../src/modules/knowledge-base/eval/metrics';

describe('检索质量指标', () => {
  describe('average', () => {
    it('空数组返回 0（不是 NaN）', () => {
      expect(average([])).toBe(0);
    });
    it('常规平均', () => {
      expect(average([1, 2, 3])).toBe(2);
    });
  });

  describe('recallAtK', () => {
    it('全部召回 = 1', () => {
      expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBe(1);
    });

    it('部分召回', () => {
      // top-3 里命中 a，相关集有 a、b → 1/2
      expect(recallAtK(['a', 'x', 'y'], ['a', 'b'], 3)).toBe(0.5);
    });

    it('k 截断生效：相关项在第 4 位而 k=3 → 0', () => {
      expect(recallAtK(['x', 'y', 'z', 'a'], ['a'], 3)).toBe(0);
      expect(recallAtK(['x', 'y', 'z', 'a'], ['a'], 4)).toBe(1);
    });

    it('重复 id 不重复计数', () => {
      // 即使 a 出现两次，也只算命中 1 个相关项
      expect(recallAtK(['a', 'a', 'x'], ['a', 'b'], 3)).toBe(0.5);
    });

    it('相关集为空返回 1（没有该找的东西）', () => {
      expect(recallAtK(['a'], [], 3)).toBe(1);
    });

    it('k<=0 返回 0', () => {
      expect(recallAtK(['a'], ['a'], 0)).toBe(0);
    });
  });

  describe('reciprocalRank（MRR 的单查询分量）', () => {
    it('第一个就命中 = 1', () => {
      expect(reciprocalRank(['a', 'b'], ['a'])).toBe(1);
    });
    it('第二个命中 = 1/2', () => {
      expect(reciprocalRank(['x', 'a'], ['a'])).toBe(0.5);
    });
    it('第三个命中 = 1/3', () => {
      expect(reciprocalRank(['x', 'y', 'a'], ['a'])).toBeCloseTo(1 / 3, 12);
    });
    it('k 内没有相关 = 0', () => {
      expect(reciprocalRank(['x', 'y', 'a'], ['a'], 2)).toBe(0);
    });
    it('取的是**第一个**命中，不是最好的', () => {
      // a 在第 2 位、b 在第 1 位，都是相关 → 取第 1 位
      expect(reciprocalRank(['b', 'a'], ['a', 'b'])).toBe(1);
    });
    it('相关集为空 = 0', () => {
      expect(reciprocalRank(['a'], [])).toBe(0);
    });
  });

  describe('ndcgAtK', () => {
    it('理想排序 = 1（二值）', () => {
      expect(ndcgAtK(['a', 'b', 'x'], ['a', 'b'], 3)).toBeCloseTo(1, 12);
    });

    it('二值：相关项排第 2、第 3 时的手算值', () => {
      // 检索序：x(0), a(1), b(1)
      // DCG  = 1/log2(3) + 1/log2(4)
      // IDCG = 1/log2(2) + 1/log2(3)
      const dcg = 1 / Math.log2(3) + 1 / Math.log2(4);
      const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
      expect(ndcgAtK(['x', 'a', 'b'], ['a', 'b'], 3)).toBeCloseTo(dcg / idcg, 12);
    });

    it('分级：高相关项排后面会明显掉分', () => {
      const grades = { high: 3, low: 1 };
      // 理想：high 在前
      const ideal = ndcgAtK(['high', 'low'], ['high', 'low'], 2, grades);
      // 反序：low 在前
      const reversed = ndcgAtK(['low', 'high'], ['high', 'low'], 2, grades);
      expect(ideal).toBeCloseTo(1, 12);
      expect(reversed).toBeLessThan(ideal);
      expect(reversed).toBeGreaterThan(0);
    });

    it('分级：手算反序样例', () => {
      const grades = { high: 3, low: 1 };
      const gain = (r: number) => Math.pow(2, r) - 1;
      // 检索序 low(1), high(3)
      const dcg = gain(1) / Math.log2(2) + gain(3) / Math.log2(3);
      // 理想序 high(3), low(1)
      const idcg = gain(3) / Math.log2(2) + gain(1) / Math.log2(3);
      expect(ndcgAtK(['low', 'high'], ['high', 'low'], 2, grades)).toBeCloseTo(
        dcg / idcg,
        12,
      );
    });

    it('没有任何相关命中 = 0', () => {
      expect(ndcgAtK(['x', 'y'], ['a'], 2)).toBe(0);
    });

    it('相关集为空返回 1', () => {
      expect(ndcgAtK(['x'], [], 2)).toBe(1);
    });

    it('Map 形式的标注同样可用', () => {
      const m = new Map([['a', 3]]);
      expect(ndcgAtK(['a'], ['a'], 1, m)).toBeCloseTo(1, 12);
    });

    it('分级里给 0 的 id 不贡献增益，但相关集里其他项仍计分', () => {
      const gain = (r: number) => Math.pow(2, r) - 1;
      // a 标 0（视为不相关）、b 标 3。检索序 a, b → 只有 b 贡献
      const dcg = gain(3) / Math.log2(3); // a 贡献 0；b 在第 2 位
      const idcg = gain(3) / Math.log2(2); // 理想：b 在第 1 位
      expect(
        ndcgAtK(['a', 'b'], ['a', 'b'], 2, { a: 0, b: 3 }),
      ).toBeCloseTo(dcg / idcg, 12);
    });

    it('全部标 0 等价于"没有相关文档"→ 返回 1（不可评测的查询不拉低均值）', () => {
      // 这是刻意的约定，与 recallAtK 的空相关集口径一致：
      // 一个"其实没有任何相关内容"的查询不该让指标看起来变差。
      // 真要排除这类查询，应在标注流程里把它删掉，而不是靠指标惩罚。
      expect(ndcgAtK(['a', 'x'], ['a'], 2, { a: 0 })).toBe(1);
    });
  });

  describe('scoreQuery / summarize', () => {
    const q: EvalQuery = {
      query: '安装步骤',
      relevantChunkIds: ['c1', 'c2'],
    };

    it('单查询得分形状完整', () => {
      const s = scoreQuery(q, ['c1', 'x', 'c2'], 3);
      expect(s.hitCount).toBe(2);
      expect(s.relevantCount).toBe(2);
      expect(s.recallAtK).toBe(1);
      expect(s.reciprocalRank).toBe(1);
      expect(s.retrieved).toEqual(['c1', 'x', 'c2']);
    });

    it('完全没命中时 hitCount=0 且被计入 zeroHitQueries', () => {
      const s = scoreQuery(q, ['x', 'y'], 2);
      expect(s.hitCount).toBe(0);
      const summary = summarize([s]);
      expect(summary.zeroHitQueries).toBe(1);
      expect(summary.recallAtK).toBe(0);
    });

    it('汇总取各查询均值', () => {
      const s1 = scoreQuery({ query: 'q1', relevantChunkIds: ['a'] }, ['a'], 5);
      const s2 = scoreQuery({ query: 'q2', relevantChunkIds: ['b'] }, ['x', 'b'], 5);
      const summary = summarize([s1, s2]);

      expect(summary.queryCount).toBe(2);
      expect(summary.recallAtK).toBe(1); // 两条都召回了
      expect(summary.mrr).toBeCloseTo((1 + 0.5) / 2, 12);
    });
  });

  describe('compareEval', () => {
    const q1: EvalQuery = { query: 'q1', relevantChunkIds: ['a'] };
    const q2: EvalQuery = { query: 'q2', relevantChunkIds: ['b'] };

    it('能指出变好、变坏的查询，并按变化幅度排序', () => {
      // 基线：q1 命中（rank1）、q2 未命中
      const before = [scoreQuery(q1, ['a'], 5), scoreQuery(q2, ['x'], 5)];
      // 现在：q1 掉到未命中、q2 命中
      const after = [scoreQuery(q1, ['x'], 5), scoreQuery(q2, ['b'], 5)];

      const cmp = compareEval(before, after);
      expect(cmp.delta.recallAtK).toBe(0); // 一升一降，整体持平
      expect(cmp.changedQueries).toHaveLength(2);
      expect(cmp.changedQueries.map((c) => c.query).sort()).toEqual(['q1', 'q2']);
    });

    it('用绝对差而非百分比（基线接近 0 时不产生误导性大数字）', () => {
      const before = [scoreQuery({ query: 'q', relevantChunkIds: ['a', 'b'] }, ['a'], 5)];
      const after = [scoreQuery({ query: 'q', relevantChunkIds: ['a', 'b'] }, ['a', 'b'], 5)];
      const cmp = compareEval(before, after);
      // 0.5 → 1.0 是 +0.5，不是 "+100%"
      expect(cmp.delta.recallAtK).toBeCloseTo(0.5, 12);
    });

    it('没有变化的查询不进 changedQueries', () => {
      const s = [scoreQuery(q1, ['a'], 5)];
      const cmp = compareEval(s, [scoreQuery(q1, ['a'], 5)]);
      expect(cmp.changedQueries).toHaveLength(0);
      expect(cmp.delta.recallAtK).toBe(0);
    });
  });
});
