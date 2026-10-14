import { Logger } from "@nestjs/common";
import type { Jieba } from "@node-rs/jieba";

/**
 * 知识库检索分词（**写入与查询必须共用同一个实例与口径**）
 *
 * `chunk_fts.content` 存的是本模块输出的分词文本，查询侧再对 query 做同样分词。
 * 两侧口径一旦分叉，中文检索会静默失效（无报错、只是搜不到），所以统一收在这里，
 * 不要在别处另建分词逻辑。
 *
 * 英文/代码片段保持原样（FTS5 自带 tokenizer 足够），中文才走 jieba。
 */

let jieba: Jieba | null = null;
let jiebaFailed = false;
const logger = new Logger("KbTokenizer");

function getJieba(): Jieba | null {
  if (jieba || jiebaFailed) return jieba;
  try {
    // 延迟 require，不能用顶层 import：jieba 的原生绑定动态链接 VC++ 运行时
    // （vcruntime140*.dll），干净系统上 require 阶段就会抛（拿不到绑定，回退 WASI
    // 也不存在），顶层 import 会让整个后端进程在启动时退出。降级才符合本模块约定。
    const { Jieba: JiebaImpl } = require("@node-rs/jieba") as typeof import("@node-rs/jieba");
    jieba = new JiebaImpl();
  } catch (err: any) {
    // 失败只记一次：jieba 是可选增强，缺失时中文按整串匹配（能力下降但不崩）
    jiebaFailed = true;
    logger.warn(`jieba 初始化失败，中文分词退化为整串匹配：${err?.message || err}`);
  }
  return jieba;
}

export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 中文按词切开（搜索模式），英文原样返回——用于写入 FTS */
export function tokenizeForSearch(text: string): string {
  if (!hasChinese(text)) return text;
  const j = getJieba();
  if (!j) return text;
  try {
    return j.cut(text, true).join(" ");
  } catch {
    return text;
  }
}

/**
 * 切成 token 数组，**不做任何过滤**（保留 jieba 吐出的空格/标点 token）。
 *
 * 供 BM25 重排使用：那些 token 同样计入文档长度，过滤会改变 BM25 分母，
 * 与旧实现产生分数偏差。查询侧要过滤请用 tokenizeQuery。
 */
export function cutChinese(text: string): string[] {
  const j = getJieba();
  if (!j) return text.split(/\s+/);
  try {
    return j.cut(text, true);
  } catch {
    return text.split(/\s+/);
  }
}

/**
 * 查询串分词（与 tokenizeForSearch 同口径，并额外 trim/过滤空 token）。
 *
 * 连字符词额外拆分子词并保留原词（`DV430FBM-N20` → 原词 + `DV430FBM` + `N20`），
 * 因为 jieba 对型号/代码标识符会把连字符当作边界，不拆会漏召回。
 */
export function tokenizeQuery(text: string): string[] {
  const rawTokens = hasChinese(text)
    ? cutChinese(text)
    : text.split(/\s+/).filter((t) => t);

  const tokens: string[] = [];
  for (const raw of rawTokens) {
    const token = raw.trim();
    if (!token) continue;
    if (/-/.test(token)) {
      tokens.push(token);
      for (const part of token.split("-")) {
        if (part) tokens.push(part);
      }
    } else {
      tokens.push(token);
    }
  }
  return tokens;
}
