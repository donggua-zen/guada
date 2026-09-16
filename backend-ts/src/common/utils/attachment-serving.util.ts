/**
 * 附件目录静态响应的头策略。
 *
 * 背景（安全）：上传目录与前端同源，且是用户可写的。此前对所有文件一律
 * `Content-Disposition: inline`，于是上传一个带 <script> 的 .html/.svg，再访问
 * /uploads/... 就会在应用同源下执行脚本——而前端 token 存在 localStorage 里，
 * 等于把凭证交出去（远程部署形态下的存储型 XSS）。
 *
 * 策略：
 * - 白名单内的位图 → inline + 真实图片 Content-Type（<img src> 需要能渲染）
 * - 其余一律 → attachment + application/octet-stream（浏览器当二进制下载，
 *   不具备任何渲染/执行能力，改扩展名也绕不过去）
 *
 * 注意：白名单分支**不加** nosniff。历史遗留文件存在「扩展名 .png 但字节是 JPEG」
 * （旧版图片上传用 sharp 统一转 JPEG 却保留原扩展名），加了 nosniff 会让这些
 * 存量图片直接显示不出来；而白名单里全是不可执行脚本的位图类型，嗅探本身无风险。
 */

/** 可 inline 展示的位图扩展名 → Content-Type */
const INLINE_IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

/**
 * 计算附件静态响应头。
 * @param filePath 磁盘上的文件路径（只取扩展名做判定）
 */
export function resolveAttachmentResponseHeaders(
  filePath: string,
): Record<string, string> {
  const dotIndex = filePath.lastIndexOf('.');
  const ext = dotIndex >= 0 ? filePath.slice(dotIndex).toLowerCase() : '';
  const inlineContentType = INLINE_IMAGE_CONTENT_TYPES[ext];

  if (inlineContentType) {
    return {
      'Content-Type': inlineContentType,
      'Content-Disposition': 'inline; charset=utf-8',
    };
  }

  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}
