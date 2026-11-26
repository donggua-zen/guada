/**
 * 本地路径工具：file:// URL ↔ 本地绝对路径，以及「是否在工作区内」判定。
 *
 * 独立成无业务依赖的纯函数模块，原因有两个：
 * 1. 可测——盘符 / UNC / POSIX / 转义字符这些分支靠手点是测不全的；
 * 2. workspacePreview（预览入口）与 FilePreviewPanel（面板）都要用，避免各写一份。
 *
 * 约定：
 * - 返回的路径统一用 "/" 作分隔符（UNC 保持 "\\\\server\\share" 形式），
 *   因为后端 Node 在 Windows 上两者都吃，而前端比较/拼接一律按 "/" 归一。
 * - Windows 下路径比较大小写不敏感（盘符与用户输入都可能大小写不同）。
 */

/** 是否为 Windows 运行时（渲染进程没有 process，退回 UA 判定） */
function detectWindowsPlatform(): boolean {
  try {
    if (typeof process !== "undefined" && process?.platform) {
      return process.platform === "win32";
    }
  } catch {
    // 某些构建下访问 process 会抛错，忽略
  }
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    return /Windows/i.test(navigator.userAgent);
  }
  return false;
}

export const IS_WINDOWS_PATH_STYLE = detectWindowsPlatform();

/** Windows 盘符形式：C:/ 或 C:\ 或 C: 本身 */
const WINDOWS_DRIVE_RE = /^[A-Za-z]:(?:[/\\]|$)/;

/**
 * decodeURIComponent 的容错版：非法转义序列（模型常写出 "%" 或残缺的 %2）
 * 原样保留，而不是让整个链接解析失败。
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 去掉 #片段 与 ?查询（标记里的 #L42 按需求直接忽略） */
function stripFragmentAndQuery(value: string): string {
  const hashIndex = value.indexOf("#");
  const noHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = noHash.indexOf("?");
  return queryIndex >= 0 ? noHash.slice(0, queryIndex) : noHash;
}

/**
 * file:// URL → 本地绝对路径。
 *
 * 非 file: 协议、空串一律返回 null（调用方据此回退到外部浏览器）。
 *
 * 支持的形态：
 * - `file:///C:/ws/a.ts`（标准 Windows）
 * - `file://C:/ws/a.ts`（少一条斜杠，模型常见写法）
 * - `file:///home/u/a.ts` / `file://localhost/home/u/a.ts`（POSIX）
 * - `file://server/share/a.ts`（UNC）
 * - `file:/C:/ws/a.ts`、`file:C:/ws/a.ts`
 */
export function fileUrlToPath(
  url: string,
  isWindows: boolean = IS_WINDOWS_PATH_STYLE,
): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!/^file:/i.test(trimmed)) return null;

  let body = stripFragmentAndQuery(trimmed.slice("file:".length));
  if (!body) return null;

  let uncAuthority = "";

  if (body.startsWith("//")) {
    const afterSlashes = body.slice(2);
    // file://C:/a 这种「盘符被当成 authority」的写法，整段仍是路径
    if (WINDOWS_DRIVE_RE.test(afterSlashes)) {
      body = afterSlashes;
    } else {
      const slashIndex = afterSlashes.indexOf("/");
      const authority = slashIndex >= 0 ? afterSlashes.slice(0, slashIndex) : afterSlashes;
      const pathPart = slashIndex >= 0 ? afterSlashes.slice(slashIndex) : "";
      if (authority && authority.toLowerCase() !== "localhost") {
        // 非 localhost 的主机名即 UNC 共享
        uncAuthority = safeDecode(authority);
        body = pathPart;
      } else {
        body = pathPart;
      }
    }
  }

  let decoded = safeDecode(body);

  if (uncAuthority) {
    const uncPath = decoded.replace(/\//g, "\\");
    return `\\\\${uncAuthority}${uncPath}`;
  }

  // Windows 盘符路径去掉 "file:///" 留下的前导斜杠
  if (isWindows && decoded.startsWith("/") && WINDOWS_DRIVE_RE.test(decoded.slice(1))) {
    decoded = decoded.slice(1);
  }

  if (isWindows) {
    // 统一成 "/"（UNC 已在上面单独返回）
    decoded = decoded.replace(/\\/g, "/");
  }

  if (!decoded) return null;
  return decoded;
}

/** 比较用归一：统一 "/"、去尾部分隔符、Windows 下小写 */
function normalizeForCompare(value: string, isWindows: boolean): string {
  let result = value.replace(/\\/g, "/");
  // 保留 root（"/" 与 "C:/" 不能被压成空串）
  if (result.length > 1) result = result.replace(/\/+$/, "");
  return isWindows ? result.toLowerCase() : result;
}

/**
 * child 是否位于 parent 目录内（含 parent 自身）。
 *
 * 边界安全：`/a/bc` 不算在 `/a/b` 内（按分隔符对齐，而不是裸前缀）。
 */
export function isPathInside(
  child: string,
  parent: string,
  isWindows: boolean = IS_WINDOWS_PATH_STYLE,
): boolean {
  if (!child || !parent) return false;

  const c = normalizeForCompare(child, isWindows);
  const p = normalizeForCompare(parent, isWindows);
  if (!c || !p) return false;
  if (c === p) return true;

  const prefix = p.endsWith("/") ? p : `${p}/`;
  return c.startsWith(prefix);
}

/**
 * 是否为本地绝对路径。
 *
 * 用途：预览入口收到的路径既可能是工作区相对路径，也可能是模型/工具给出的
 * 本机绝对路径（Windows 盘符、UNC、POSIX 前导斜杠）。后者不能当相对路径拼到
 * 工作目录下，否则会拼出 `D:/ws/C:/Users/...` 这种无效路径。
 */
export function isAbsoluteLocalPath(
  value: string,
  isWindows: boolean = IS_WINDOWS_PATH_STYLE,
): boolean {
  if (!value) return false;
  if (WINDOWS_DRIVE_RE.test(value)) return true;
  // UNC：原始形态 \\server\share，归一形态 //server/share
  if (value.startsWith("\\\\") || value.startsWith("//")) return true;
  if (!isWindows && value.startsWith("/")) return true;
  return false;
}

/**
 * 绝对路径 → 会话附件存储引用（`sessions/<id>/<rel>`），不属于该会话目录返回 null。
 *
 * 会话图片/预览图落在 `<sessionsBase>/<sessionId>/images|previews/...`，取图走
 * 鉴权端点（见 utils/url 的 toResourceUrl）。工具行给出的是拼好的本机绝对路径，
 * 这里把它还原成自包含存储引用，避免再交给工作区 raw-file（工作区外必然 403）。
 */
export function toSessionAttachmentStoragePath(
  absolutePath: string,
  sessionId: string,
  isWindows: boolean = IS_WINDOWS_PATH_STYLE,
): string | null {
  if (!absolutePath || !sessionId) return null;

  const normalized = absolutePath.replace(/\\/g, "/");
  const marker = `/sessions/${sessionId}/`;
  const haystack = isWindows ? normalized.toLowerCase() : normalized;
  const needle = isWindows ? marker.toLowerCase() : marker;
  const index = haystack.lastIndexOf(needle);
  if (index < 0) return null;

  // 用原始坐标切片，保留真实大小写
  const rel = normalized.slice(index + marker.length);
  if (!rel) return null;

  // 附件相对路径只允许普通段：挡掉空段、`.`/`..` 上跳与盘符冒号
  const segments = rel.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) {
    return null;
  }
  return `sessions/${sessionId}/${rel}`;
}

/**
 * markdown 链接 href → 本机绝对路径；不是本地文件路径返回 null。
 *
 * 模型常把本地文件写成这些形态，都会被浏览器当成「非 http(s) 协议」：
 * - `/D:/a/b.png`（前导斜杠 + 盘符，markdown 站内根路径的写法）
 * - `D:/a/b.png`、`D:\\a\\b.png`（盘符被解析成 URL scheme `d:`）
 * - `\\\\server\\share\\a.png`（UNC，反斜杠形态）
 * - POSIX `/home/u/a.png`
 * - `file:///D:/a/b.png`（交给 fileUrlToPath）
 *
 * 其余协议（http/https/mailto/data/vscode…）一律 null，保持原有外链行为。
 */
export function localPathFromHref(
  href: string,
  isWindows: boolean = IS_WINDOWS_PATH_STYLE,
): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (/^file:/i.test(trimmed)) return fileUrlToPath(trimmed, isWindows);

  // 单字母 `C:` 是盘符而不是协议；长度 ≥2 的 scheme 一律按外链处理
  const scheme = trimmed.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && scheme[1].length > 1) return null;

  // 行号片段与查询串不属于磁盘路径（与 fileUrlToPath 同一语义）
  let candidate = stripFragmentAndQuery(trimmed);
  if (!candidate) return null;

  if (isWindows) {
    // `/D:/...` → `D:/...`（只裁掉紧跟盘符的那一条前导斜杠）
    if (/^\/[A-Za-z]:([/\\]|$)/.test(candidate)) candidate = candidate.slice(1);

    if (WINDOWS_DRIVE_RE.test(candidate)) {
      return safeDecode(candidate).replace(/\\/g, "/");
    }
    // UNC：只认反斜杠形态。`//host/path` 与 protocol-relative URL 同形，
    // 交给外链流程处理，避免把网页链接误开成本地文件。
    if (candidate.startsWith("\\\\")) return safeDecode(candidate);
    return null;
  }

  // POSIX：只有前导斜杠才是本地绝对路径
  return candidate.startsWith("/") ? safeDecode(candidate) : null;
}

/**
 * 绝对路径 → 相对工作区根目录的路径（工作区外返回 null）。
 *
 * 返回值统一用 "/" 且不带前导分隔符，可直接作为 workspace 接口的 path 参数。
 */
export function toWorkspaceRelative(
  absolutePath: string,
  workspaceDir: string,
  isWindows: boolean = IS_WINDOWS_PATH_STYLE,
): string | null {
  if (!isPathInside(absolutePath, workspaceDir, isWindows)) return null;

  const c = normalizeForCompare(absolutePath, isWindows);
  const p = normalizeForCompare(workspaceDir, isWindows);
  if (c === p) return "";

  const prefixLength = p.endsWith("/") ? p.length : p.length + 1;
  // 用原始（未小写）坐标切片，保留真实大小写
  const normalizedAbsolute = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedAbsolute.slice(prefixLength);
}

/** 取路径末段文件名（分隔符两种都吃）；空路径返回空串 */
export function baseNameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/** 取小写扩展名（含点）；无扩展名返回空串 */
export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index).toLowerCase() : "";
}
