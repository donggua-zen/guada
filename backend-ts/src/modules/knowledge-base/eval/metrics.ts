/**
 * 检索质量评测指标（纯函数，无 IO、无依赖，可单测）
 *
 * ## 为什么需要它
 *
 * 在此之前项目只有**结构性**回归（`kb-search-golden.json` 锁"排序不许变"），
 * 没有任何**质量**度量。后果是：改分块、换嵌入模型、调融合权重时，无法回答
 * "变好了还是变坏了"——只能靠体感。本模块提供可复现的判据。
 *
 * 三个指标的取舍：
 *
 * | 指标 | 回答的问题 | 适用场景 |
 * |---|---|---|
 * | `recall@k` | 该找的东西**有没有被找回来** | 召回能力（最重要：没召回就无从谈排序） |
 * | `MRR` | **第一个**正确结果排多前 | 问答式检索（用户只看前几条） |
 * | `NDCG@k` | 整条排序**整体质量**，且支持分级相关性 | 有"部分相关"标注时的精细对比 |
 *
 * ## 标注口径
 *
 * 相关性由**人工标注**（`relevantChunkIds`）。分块 id 会随分块策略变化，
 * 所以评测集在"改了分块"之后需要重新标注——这是分块改造的隐性成本，必须显式承认。
 * 若标注粒度想更稳，可用"文件级"标注（`relevantFileIds`），代价是精度下降。
 */

/** 一条评测查询 */
export interface EvalQuery {
  /** 查询文本 */
  query: string;
  /** 人工标注的相关分块 id（无序） */
  relevantChunkIds: string[];
  /**
   * 可选的分级相关性（chunkId → 等级 0..3，0 表示不相关）。
   * 提供时 `ndcgAtK` 用它算增益；不提供时按二值（相关=1）处理。
   */
  gradedRelevance?: Record<string, number>;
  /** 可选：该查询只在指定知识库上跑 */
  kbId?: string;
  /** 可选：备注，便于回溯标注依据 */
  note?: string;
}

/** 单个查询的评测结果 */
export interface QueryScore {
  query: string;
  /** 实际召回的 id 序列（按分数降序） */
  retrieved: string[];
  recallAtK: number;
  reciprocalRank: number;
  ndcgAtK: number;
  /** 命中的相关 id 数（便于定位"完全没召回"的查询） */
  hitCount: number;
  /** 该查询的相关 id 总数 */
  relevantCount: number;
}

/** 一组查询的汇总 */
export interface EvalSummary {
  queryCount: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  /** 一个都没召回的查询数（最值得优先看的） */
  zeroHitQueries: number;
}

/** 算术平均；空数组返回 0 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * recall@k = |相关 ∩ top_k| / |相关|
 *
 * 相关集为空时返回 **1**（没有该找的东西，视为"没有遗漏"）——而不是 0，
 * 否则一条空标注会把整体均值拉低，让人误判。空标注本身应该在标注流程里被拦掉。
 */
export function recallAtK(
  retrieved: string[],
  relevant: Iterable<string>,
  k: number,
): number {
  const relevantSet = new Set(relevant);
  if (relevantSet.size === 0) return 1;
  if (k <= 0) return 0;
  const top = retrieved.slice(0, k);
  let hit = 0;
  const seen = new Set<string>();
  for (const id of top) {
    if (relevantSet.has(id) && !seen.has(id)) {
      seen.add(id);
      hit++;
    }
  }
  return hit / relevantSet.size;
}

/**
 * 第一个相关结果的倒数排名（1/rank，rank 从 1 开始）；前 k 条内没有相关则 0。
 *
 * 多查询的 MRR = 各查询 reciprocalRank 的均值。
 */
export function reciprocalRank(
  retrieved: string[],
  relevant: Iterable<string>,
  k?: number,
): number {
  const relevantSet = new Set(relevant);
  if (relevantSet.size === 0) return 0;
  const top = k === undefined ? retrieved : retrieved.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (relevantSet.has(top[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * NDCG@k（含分级相关性支持）
 *
 * - DCG  = Σ (2^rel_i - 1) / log2(i + 1)
 * - IDCG = 把全部相关文档按等级降序排列后的 DCG（理想排序）
 * - NDCG = DCG / IDCG；IDCG 为 0（无相关文档）时返回 1，理由同 `recallAtK`
 *
 * 二值标注时 rel ∈ {0, 1}，`2^1 - 1 = 1`，退化为标准二值 NDCG。
 *
 * ## 分级标注与相关集的优先级
 *
 * `gradedRelevance` 里**显式给出**的等级优先于 `relevantChunkIds` 的成员关系：
 * 标 0 或负数即视为不相关（允许"先按文件粗标相关、再用分级排除个别分块"这种流程）。
 * 只有标注表里**没有**该 id 时，才退化为"在相关集里 = 等级 1"。
 */
export function ndcgAtK(
  retrieved: string[],
  relevant: Iterable<string>,
  k: number,
  gradedRelevance?: Record<string, number> | Map<string, number>,
): number {
  if (k <= 0) return 0;

  /** 标注表里显式给出的等级；没给返回 undefined */
  const rawGrade = (id: string): number | undefined => {
    if (!gradedRelevance) return undefined;
    const g =
      gradedRelevance instanceof Map
        ? gradedRelevance.get(id)
        : gradedRelevance[id];
    return typeof g === "number" && Number.isFinite(g) ? g : undefined;
  };

  const relevantSet = new Set(relevant);

  const effectiveGrade = (id: string): number => {
    if (!relevantSet.has(id)) return 0;
    const g = rawGrade(id);
    if (g !== undefined) return g > 0 ? g : 0;
    return 1; // 未分级 → 二值相关
  };

  const gain = (rel: number) => Math.pow(2, rel) - 1;
  const discount = (rank1Based: number) => Math.log2(rank1Based + 1);

  let dcg = 0;
  const top = retrieved.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    const rel = effectiveGrade(top[i]);
    if (rel > 0) dcg += gain(rel) / discount(i + 1);
  }

  // 理想排序：所有相关文档按等级降序
  const idealGrades = [...relevantSet]
    .map((id) => effectiveGrade(id))
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);

  if (idealGrades.length === 0) return 1;

  let idcg = 0;
  for (let i = 0; i < idealGrades.length; i++) {
    idcg += gain(idealGrades[i]) / discount(i + 1);
  }
  return idcg === 0 ? 1 : dcg / idcg;
}

/** 对单个查询算出全部指标 */
export function scoreQuery(
  query: EvalQuery,
  retrieved: string[],
  k: number,
): QueryScore {
  const relevantSet = new Set(query.relevantChunkIds);
  let hitCount = 0;
  const seen = new Set<string>();
  for (const id of retrieved.slice(0, k)) {
    if (relevantSet.has(id) && !seen.has(id)) {
      seen.add(id);
      hitCount++;
    }
  }
  return {
    query: query.query,
    retrieved: retrieved.slice(0, k),
    recallAtK: recallAtK(retrieved, relevantSet, k),
    reciprocalRank: reciprocalRank(retrieved, relevantSet, k),
    ndcgAtK: ndcgAtK(retrieved, relevantSet, k, query.gradedRelevance),
    hitCount,
    relevantCount: relevantSet.size,
  };
}

/** 汇总一组查询的指标 */
export function summarize(scores: QueryScore[]): EvalSummary {
  return {
    queryCount: scores.length,
    recallAtK: average(scores.map((s) => s.recallAtK)),
    mrr: average(scores.map((s) => s.reciprocalRank)),
    ndcgAtK: average(scores.map((s) => s.ndcgAtK)),
    zeroHitQueries: scores.filter((s) => s.hitCount === 0).length,
  };
}

/**
 * 对比两份评测结果，产出"变好还是变坏"的结论。
 *
 * 用**绝对差**而非百分比：当基线接近 0 时百分比会给出误导性的大数字
 * （例如 0.01 → 0.02 是"提升 100%"，但实际没有意义）。
 */
export interface EvalComparison {
  baseline: EvalSummary;
  current: EvalSummary;
  delta: { recallAtK: number; mrr: number; ndcgAtK: number };
  /** 按 |recall 变化| 降序排列、且确实发生了变化的查询 */
  changedQueries: Array<{
    query: string;
    recallBefore: number;
    recallAfter: number;
  }>;
}

export function compareEval(
  baselineScores: QueryScore[],
  currentScores: QueryScore[],
): EvalComparison {
  const baseline = summarize(baselineScores);
  const current = summarize(currentScores);

  const before = new Map(baselineScores.map((s) => [s.query, s]));
  const changedQueries = currentScores
    .map((after) => {
      const prev = before.get(after.query);
      if (!prev) return null;
      if (Math.abs(prev.recallAtK - after.recallAtK) < 1e-9) return null;
      return {
        query: after.query,
        recallBefore: prev.recallAtK,
        recallAfter: after.recallAtK,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort(
      (a, b) =>
        Math.abs(b.recallAfter - b.recallBefore) -
        Math.abs(a.recallAfter - a.recallBefore),
    );

  return {
    baseline,
    current,
    delta: {
      recallAtK: current.recallAtK - baseline.recallAtK,
      mrr: current.mrr - baseline.mrr,
      ndcgAtK: current.ndcgAtK - baseline.ndcgAtK,
    },
    changedQueries,
  };
}
