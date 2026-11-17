/**
 * 工具卡片的大文本预览切片。
 *
 * 写入/编辑类工具的参数里带着整份文件（单页 HTML 常到 MB 级），
 * 而卡片只渲染前 N 行。必须先切片、再高亮/diff：
 * 否则 tokenize 成本随原文件线性增长，展开一次就卡住主线程。
 *
 * 切片只做一次线性扫描（indexOf 找换行），不调用 `split("\n")`——
 * MB 级文本会因此多分配一个「每行一个字符串」的数组。
 */

export interface TextPreview {
  /** 预览文本：前 maxLines 行，且不超过 maxChars 字符 */
  text: string;
  /** 原文总行数，语义与 `content.split("\n").length` 一致（空串为 1 行） */
  totalLines: number;
  /** 是否因行数或字符数上限被截断 */
  truncated: boolean;
}

/**
 * 取文本预览切片。
 *
 * @param content 原文（可能非常大）
 * @param maxLines 行数上限；第 maxLines+1 行起不进入预览
 * @param maxChars 字符数硬上限；优先于行数上限，防止单行 minified 文件撑爆 DOM
 */
export function takeTextPreview(
  content: string,
  maxLines: number,
  maxChars: number = Number.POSITIVE_INFINITY,
): TextPreview {
  // 空串 split("\n") 也是 1 行，保持行头展示语义不变
  if (!content) return { text: "", totalLines: 1, truncated: false };

  let totalLines = 1;
  let lineCut = -1;
  let pos = 0;
  while (true) {
    const newline = content.indexOf("\n", pos);
    if (newline === -1) break;
    totalLines += 1;
    // 第 maxLines 行末尾的换行 → 从下一行起全部截掉
    if (lineCut === -1 && totalLines > maxLines) lineCut = newline;
    pos = newline + 1;
  }

  let cut = lineCut === -1 ? content.length : lineCut;
  if (cut > maxChars) cut = maxChars;
  const text = cut >= content.length ? content : content.slice(0, cut);
  return { text, totalLines, truncated: text.length < content.length };
}
