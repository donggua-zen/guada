/**
 * 文件路径的行内展示拆分：文件名（主识别信息）+ 父目录（次要、可截断）。
 *
 * 交互对齐 ZCode 的 read/edit 行头：动作文案之后先显示文件名（空间不足才省略），
 * 目录串保留尾斜杠（如 `server/jobs/`）且优先被截断。
 */

export interface FilePathDisplay {
  /** basename（最后一段，不含分隔符） */
  fileName: string;
  /** 父目录，保留尾斜杠（如 "server/jobs/"）；裸文件名（无目录）时为 null */
  dirPath: string | null;
  /** 原始路径（分隔符未归一），供 hover 提示与打开文件透传 */
  fullPath: string;
}

/**
 * 把任意分隔符风格的路径拆成「文件名 + 目录」两段展示。
 *
 * - 反斜杠统一按 "/" 处理（Windows 路径与 POSIX 同构）；
 * - 去掉结尾分隔符后再取末段，"a/b/" 与 "a/b" 视为同一文件；
 * - 目录串用 `lastIndexOf("/" + fileName)` 定位并保留尾斜杠——
 *   即使目录段里恰好有与文件名同名的子串也不会截错位置；
 * - 空串返回 null（调用方按 falsy 走纯文本分支）。
 */
export function splitPathDisplay(filePath: string): FilePathDisplay | null {
  const fullPath = filePath;
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return null;

  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1];
  if (!fileName) return null;

  const fileNameIndex = normalized.lastIndexOf(`/${fileName}`);
  const dirPath =
    fileNameIndex > 0
      ? normalized.slice(0, fileNameIndex + 1)
      : segments.length > 1 && normalized.length > fileName.length
        ? normalized.slice(0, normalized.length - fileName.length)
        : null;

  return { fileName, dirPath, fullPath };
}
