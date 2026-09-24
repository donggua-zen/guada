/**
 * 分块「文档类型」判定：决定预处理与切分策略。
 *
 * ## 为什么需要它
 *
 * 原来的分块对**所有**文件用同一套预处理（`replace(/\s+/g, " ")` + 按句子切分），
 * 于是 Markdown 的标题/列表/代码围栏全塌成一行、代码缩进丢失（Python 直接不可读）、
 * 表格列对齐消失。而知识库明确支持 37 种文本/代码扩展名——"支持这些格式"和
 * "把它们的结构抹平"是自相矛盾的。
 *
 * 这里的分类只影响**保真度**，不影响检索口径：FTS 侧仍然统一走 jieba 分词
 * （见 kb-tokenizer.ts），所以改了分类不会让检索行为漂移。
 *
 * ## 扩展名集合的来源
 *
 * 与 `file-parser.service.ts` 的 `TEXT_EXTENSIONS` 对齐，但**用途不同**：
 * 那边回答"能不能按文本解析"，这边回答"该用哪种保真策略"。刻意不合并成一个集合，
 * 因为将来新增可解析格式时未必需要新的分块策略（新格式多半归入现有某一类）。
 * 若两边出现分歧，以 file-parser 为准（它决定文件能否入库）。
 */

export type ChunkKind =
  /** 代码/配置：最高保真，不归一化、不折叠空白 */
  | "code"
  /** Markdown：保留空白与标题层级，但做 Unicode 归一化（正文以散文为主） */
  | "markdown"
  /** 表格（CSV/TSV）：按行分组，重复表头 */
  | "table"
  /** 纯文本/散文：沿用原有的空白折叠 + 句子切分 */
  | "prose";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);

const CODE_EXTENSIONS = new Set([
  // 语言
  "py", "js", "jsx", "ts", "tsx", "java", "c", "h", "cpp", "hpp", "cc", "cxx",
  "go", "rs", "rb", "php", "swift", "kt", "kts", "scala", "cs", "m", "mm",
  "lua", "pl", "r", "dart", "vue", "svelte",
  // 声明文件（编辑器里常出现，结构敏感）
  "dts", "dtsi",
  // 配置/数据（缩进与换行都有语义）
  "json", "jsonc", "xml", "yaml", "yml", "toml", "ini", "conf", "properties",
  "env", "lock",
  // 标记/样式
  "html", "htm", "xhtml", "css", "scss", "sass", "less",
  // 查询/脚本
  "sql", "sh", "bash", "zsh", "fish", "bat", "cmd", "ps1", "psm1",
  // 构建
  "mk", "makefile", "cmake", "gradle", "dockerfile", "gitignore",
]);

/** 去掉前导点、转小写 */
export function normalizeExtension(ext: string | null | undefined): string {
  return (ext ?? "").trim().toLowerCase().replace(/^\./, "");
}

/**
 * 由扩展名判定分块类型。未知扩展名归入 `prose`（保守：最接近原行为）。
 */
export function chunkKindForExtension(ext: string | null | undefined): ChunkKind {
  const e = normalizeExtension(ext);
  if (!e) return "prose";
  if (MARKDOWN_EXTENSIONS.has(e)) return "markdown";
  if (TABLE_EXTENSIONS.has(e)) return "table";
  if (CODE_EXTENSIONS.has(e)) return "code";
  return "prose";
}

/** 该类型是否需要保留原始换行与缩进 */
export function preservesWhitespace(kind: ChunkKind): boolean {
  return kind !== "prose";
}

/** 该类型是否做 NFKC 归一化（代码与表格不归一化：字符本身可能有意义） */
export function normalizesUnicode(kind: ChunkKind): boolean {
  return kind === "prose" || kind === "markdown";
}

// ============================================================================
// 策略版本标记
// ============================================================================

/**
 * 当前分块策略版本。
 *
 * 每次**改变切分或预处理方式**都要 +1。它的作用是让"这条分块是哪个版本产出的"可查，
 * 从而支撑两件事：
 *
 * 1. 前端提示用户"该文件用旧方案分块，建议重新处理"（重处理会重新调用嵌入模型，有成本，
 *    所以由用户决定，不自动做）。
 * 2. 排查检索质量问题时能区分"算法问题"与"数据是旧版"。
 *
 * v1 = 历史版本（策略标记统一为 `"token"`，所有格式都折叠空白 + 按句子切分）。
 * v2 = 按文件类型分流预处理与切分（本版）。
 */
export const CHUNK_STRATEGY_VERSION = "v2";

/** 生成某类型的策略标记，形如 `md-heading-v2` */
export function chunkStrategyTag(kind: ChunkKind): string {
  const base: Record<ChunkKind, string> = {
    markdown: "md-heading",
    code: "code-block",
    table: "table-rows",
    prose: "sentence",
  };
  return `${base[kind]}-${CHUNK_STRATEGY_VERSION}`;
}

/**
 * 判断一条分块是否为**旧方案**产出（需要提示重新处理）。
 *
 * 判据是策略标记是否带当前版本后缀。历史数据的标记是 `"token"`（不带版本），
 * 所以会被判为旧；空值也判为旧（更保守：宁可不提示也不要漏提示）。
 */
export function isLegacyChunkStrategy(
  strategy: string | null | undefined,
): boolean {
  if (!strategy) return true;
  return !strategy.endsWith(`-${CHUNK_STRATEGY_VERSION}`);
}
