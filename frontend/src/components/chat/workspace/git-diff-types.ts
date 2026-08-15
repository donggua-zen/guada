/**
 * Git diff 行类型定义（GitChangesPanel / GitDiffRow 共用）。
 * 数据管线：selectedLines(DiffLine[]) → unifiedToSplit → splitLines(SplitDiffLine[])
 *   → displaySplitLines（gap 展开，带 srcIdx）
 *   → split 视图直接渲染；unified 视图再派生 displayUnifiedLines（pair 拆成 del+add）。
 */

export interface DiffLine {
  /** gap = hunk 之间的未修改行折叠条；binary = 二进制文件不支持预览 */
  type: "add" | "del" | "ctx" | "hunk" | "gap" | "binary";
  sign: string;
  html: string;
  /** 原始文本（仅 add/del/ctx 代码行）：降级模式整段高亮前的暂存，高亮 pass 后 html 才有值 */
  text?: string;
  /** 旧侧高亮（全文模式的 del/ctx 行；split 旧列用，缺省回退 html） */
  oldHtml?: string;
  /** 新侧高亮（全文模式的 add/ctx 行；split 新列用，缺省回退 html） */
  newHtml?: string;
  /** gap 行：未修改的行数 */
  gap?: number;
  /** gap 行：新文件侧未修改的行数（split 视图右列条用） */
  newGap?: number;
  /** 旧文件行号（del/ctx 行），add 行与 hunk 行为空 */
  oldLine?: number;
  /** 新文件行号（add/ctx 行），del 行与 hunk 行为空 */
  newLine?: number;
}

/**
 * 拆分视图（两列：旧文件 | 新文件）的扁平行，也是所有视图共享的渲染行模型。
 * 核心：del 行与 add 行**配对**成一行（type="pair"，左=旧右=新，VS Code 风格），
 * 保证左右两列行数一一对应；配不完的多余 del/add 单独成行（del-only/add-only）。
 * gap = hunk 间未修改行折叠条（可点击展开）；gap-close = 展开后的收起条。
 */
export interface SplitDiffLine {
  type: "pair" | "del" | "add" | "ctx" | "gap" | "gap-close" | "binary" | "hunk";
  /** 旧文件行号（pair/del/ctx 行；gap 行 = 区间起点） */
  oldLine?: number;
  /** 新文件行号（pair/add/ctx 行；gap 行 = 新文件区间起点） */
  newLine?: number;
  /** 旧列内容（pair/del/ctx 行；add-only 行为空） */
  oldHtml: string;
  /** 新列内容（pair/add/ctx 行；del-only 行为空） */
  newHtml: string;
  /** gap/binary/hunk 跨两列占满行的内容 */
  html?: string;
  gap?: number;
  /** gap 行：新文件侧跳过的行数（split 视图右列条） */
  newGap?: number;
  /** 该行在解析层 splitLines 中的原始索引（gap/gap-close 展开状态 key，display 层设置） */
  srcIdx?: number;
}

/** display 层行：带解析层原始索引（gap 展开/收起用） */
export interface DisplaySplitLine extends SplitDiffLine {
  srcIdx: number;
}
