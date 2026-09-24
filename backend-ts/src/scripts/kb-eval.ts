/**
 * 知识库检索质量评测
 *
 * ## 用途
 *
 * 回答"这次改动让检索变好了还是变坏了"。此前项目只有结构性回归
 * （`kb-search-golden.json` 锁"排序不许变"），没有任何质量度量——
 * 改分块策略、换嵌入模型、调融合权重时无法判断收益。
 *
 * ## 用法
 *
 * ```
 * pnpm --dir backend-ts run kb:eval -- --kb <kbId> --queries <file.jsonl>
 * pnpm --dir backend-ts run kb:eval -- --kb <kbId> --queries q.jsonl --out before.json --label before
 * # 改完代码后再跑，与基线对比：
 * pnpm --dir backend-ts run kb:eval -- --kb <kbId> --queries q.jsonl --baseline before.json
 * ```
 *
 * ## 查询集格式（JSONL，每行一条）
 *
 * ```json
 * {"query": "怎么安装", "relevantChunkIds": ["chunk_3_xxx", "chunk_4_xxx"], "note": "标注依据"}
 * {"query": "报错 E1234", "relevantChunkIds": ["chunk_9_yyy"], "gradedRelevance": {"chunk_9_yyy": 3}}
 * ```
 *
 * ## 重要前提
 *
 * 1. **需要配置好嵌入模型**（会用真实 API 调用把查询向量化）。没配就报错退出，
 *    不会静默产出全 0 的假结果。
 * 2. **标注粒度是分块 id**，而分块 id 会随分块策略变化。改了分块之后必须**重新标注**——
 *    这是分块改造的隐性成本，评测集本身无法规避。
 * 3. 标注一个查询集是**人力活**：建议先用 `--dump-top` 打印各查询的 top-N 结果，
 *    人工挑出真正相关的 id，再回填成标注文件。
 */

import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { AppModule } from "../app.module";
import { KbMetaStore } from "../modules/knowledge-base/kb-meta.store";
import { KbSearchService } from "../modules/knowledge-base/kb-search.service";
import { EmbeddingService } from "../modules/knowledge-base/embedding.service";
import { ProviderFileStore } from "../modules/llm-core/provider-file.store";
import {
  compareEval,
  scoreQuery,
  summarize,
  type EvalQuery,
  type QueryScore,
} from "../modules/knowledge-base/eval/metrics";

interface CliArgs {
  kb?: string;
  queries?: string;
  baseline?: string;
  out?: string;
  label: string;
  top: number;
  dumpTop: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    kb: get("--kb"),
    queries: get("--queries"),
    baseline: get("--baseline"),
    out: get("--out"),
    label: get("--label") ?? "current",
    top: Number(get("--top") ?? 5),
    dumpTop: argv.includes("--dump-top"),
  };
}

/** 读 JSONL；空行与 `#` 开头的注释行跳过 */
function loadQueries(file: string): EvalQuery[] {
  const raw = fs.readFileSync(file, "utf8");
  const out: EvalQuery[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (err: any) {
      throw new Error(`第 ${i + 1} 行不是合法 JSON：${err?.message || err}`);
    }
    if (typeof parsed?.query !== "string" || !parsed.query.trim()) {
      throw new Error(`第 ${i + 1} 行缺少 query`);
    }
    if (!Array.isArray(parsed.relevantChunkIds)) {
      throw new Error(`第 ${i + 1} 行缺少 relevantChunkIds 数组`);
    }
    out.push({
      query: parsed.query,
      relevantChunkIds: parsed.relevantChunkIds.map(String),
      gradedRelevance: parsed.gradedRelevance,
      kbId: parsed.kbId,
      note: parsed.note,
    });
  }
  return out;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function printSummary(label: string, s: ReturnType<typeof summarize>): void {
  console.log(`\n[${label}]`);
  console.log(`  查询数        ${s.queryCount}`);
  console.log(`  recall@k      ${pct(s.recallAtK)}`);
  console.log(`  MRR           ${s.mrr.toFixed(4)}`);
  console.log(`  NDCG@k        ${pct(s.ndcgAtK)}`);
  console.log(`  零命中查询    ${s.zeroHitQueries}`);
}

async function main(): Promise<void> {
  const logger = new Logger("KbEval");
  const args = parseArgs(process.argv.slice(2));

  if (!args.kb || !args.queries) {
    console.error(
      "用法：pnpm --dir backend-ts run kb:eval -- --kb <kbId> --queries <file.jsonl> " +
        "[--top 5] [--out result.json] [--label name] [--baseline prev.json] [--dump-top]",
    );
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(args.queries)) {
    console.error(`查询集文件不存在：${args.queries}`);
    process.exitCode = 1;
    return;
  }

  const queries = loadQueries(args.queries);
  if (queries.length === 0) {
    console.error("查询集为空（至少需要一条标注查询才能评测）");
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const kbMetaStore = app.get(KbMetaStore);
    const searchService = app.get(KbSearchService);
    const embeddingService = app.get(EmbeddingService);
    const providerStore = app.get(ProviderFileStore);

    const kb = await kbMetaStore.getKb(args.kb);
    if (!kb) {
      console.error(`知识库不存在：${args.kb}`);
      process.exitCode = 1;
      return;
    }
    const model = providerStore.findModel(kb.embeddingModelId);
    if (!model) {
      // 明确失败：不静默产出全 0 的假结果
      console.error(
        `向量模型不可用：${kb.embeddingModelId}。评测必须用与入库时同一个嵌入模型，` +
          `否则向量不在同一空间，指标没有意义。`,
      );
      process.exitCode = 1;
      return;
    }

    logger.log(
      `评测开始：kb=${args.kb} 查询数=${queries.length} top=${args.top} 模型=${model.modelName}`,
    );

    const scores: QueryScore[] = [];
    for (const q of queries) {
      const kbId = q.kbId ?? args.kb!;
      const embedding = await embeddingService.getEmbedding(
        q.query,
        model.provider.apiUrl || "",
        model.provider.apiKey || "",
        model.modelName,
      );
      // 用与线上一致的口径（hybridSearch，权重取知识库配置）
      const results = await searchService.hybridSearch(
        kbId,
        embedding,
        q.query,
        args.top,
        typeof kb.semanticWeight === "number" ? kb.semanticWeight : undefined,
        typeof kb.keywordWeight === "number" ? kb.keywordWeight : undefined,
      );
      const retrieved = results.map((r) => r.id);
      scores.push(scoreQuery(q, retrieved, args.top));

      if (args.dumpTop) {
        console.log(`\n--- ${q.query}`);
        console.log(`    标注相关：${q.relevantChunkIds.join(", ") || "(空)"}`);
        results.forEach((r, i) => {
          const mark = q.relevantChunkIds.includes(r.id) ? "✔" : " ";
          console.log(
            `  ${mark} [${i + 1}] ${r.id}  score=${r.score.toFixed(4)}  ` +
              `${(r.metadata?.fileName ?? "?").toString().slice(0, 40)}`,
          );
        });
      }
    }

    const summary = summarize(scores);
    printSummary(args.label, summary);

    // 最值得先看的：零命中查询
    const zeroHit = scores.filter((s) => s.hitCount === 0);
    if (zeroHit.length > 0) {
      console.log(`\n零命中查询（优先排查）：`);
      for (const s of zeroHit) {
        console.log(`  - ${s.query}  (相关 ${s.relevantCount} 条，一条都没召回)`);
      }
    }

    if (args.baseline) {
      if (!fs.existsSync(args.baseline)) {
        console.error(`\n基线文件不存在：${args.baseline}`);
      } else {
        const prev = JSON.parse(fs.readFileSync(args.baseline, "utf8"));
        const prevScores: QueryScore[] = prev.scores ?? [];
        if (prevScores.length === 0) {
          console.error(`\n基线文件里没有 scores，无法对比`);
        } else {
          const cmp = compareEval(prevScores, scores);
          console.log(`\n与基线对比（${prev.label ?? "baseline"} → ${args.label}）`);
          console.log(
            `  recall@k  ${pct(cmp.baseline.recallAtK)} → ${pct(cmp.current.recallAtK)}  ` +
              `Δ ${cmp.delta.recallAtK >= 0 ? "+" : ""}${(cmp.delta.recallAtK * 100).toFixed(1)}pp`,
          );
          console.log(
            `  MRR       ${cmp.baseline.mrr.toFixed(4)} → ${cmp.current.mrr.toFixed(4)}  ` +
              `Δ ${cmp.delta.mrr >= 0 ? "+" : ""}${cmp.delta.mrr.toFixed(4)}`,
          );
          console.log(
            `  NDCG@k    ${pct(cmp.baseline.ndcgAtK)} → ${pct(cmp.current.ndcgAtK)}  ` +
              `Δ ${cmp.delta.ndcgAtK >= 0 ? "+" : ""}${(cmp.delta.ndcgAtK * 100).toFixed(1)}pp`,
          );
          if (cmp.changedQueries.length > 0) {
            console.log(`\n  recall 发生变化的查询（按幅度降序）：`);
            for (const c of cmp.changedQueries.slice(0, 20)) {
              const arrow = c.recallAfter > c.recallBefore ? "↑" : "↓";
              console.log(
                `    ${arrow} ${pct(c.recallBefore)} → ${pct(c.recallAfter)}  ${c.query}`,
              );
            }
          } else {
            console.log(`\n  所有查询的 recall 均未变化`);
          }
        }
      }
    }

    if (args.out) {
      const outPath = path.resolve(args.out);
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          {
            label: args.label,
            kbId: args.kb,
            top: args.top,
            model: model.modelName,
            createdAt: new Date().toISOString(),
            summary,
            scores,
          },
          null,
          2,
        ),
        "utf8",
      );
      logger.log(`结果已写入 ${outPath}`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error(`评测失败：${err?.message || err}`);
  process.exitCode = 1;
});
