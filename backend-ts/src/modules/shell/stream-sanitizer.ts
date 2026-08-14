import { Transform } from "node:stream";
import * as iconv from "iconv-lite";

// ============================================================================
// decodeBuffer — 按编码或平台默认解码 Buffer → string
// ============================================================================

export function decodeBuffer(buffer: Buffer, encoding?: string): string {
  if (!buffer || buffer.length === 0) return "";
  try {
    if (encoding) return iconv.decode(buffer, encoding);
    return iconv.decode(
      buffer,
      process.platform === "win32" ? "gbk" : "utf-8",
    );
  } catch {
    return buffer.toString("latin1");
  }
}

// ============================================================================
// StreamingSanitizer — 流式 ANSI 清洗 + \r 进度条重建
// 处理跨 chunk 边界的 ANSI 转义序列和 \r\n 换行
// ============================================================================

export class StreamingSanitizer {
  /** 不完整的 ANSI 转义序列（跨 chunk 边界时暂存） */
  private partialEsc = "";
  /** 不完整的行（最后一个 \n 之后的文本，跨 chunk 边界时暂存） */
  private partialLine = "";

  /**
   * 输入一个 chunk，返回清洗后的文本。
   * ANSI 转义序列和未结束的行跨 chunk 边界时暂存，等下一个 chunk 补全。
   *
   * 行缓冲的必要性：curl 等工具用 \r（无 \n）更新进度条，各帧仅靠 \r 分隔。
   * 若 chunk 边界恰好落在一帧内容和它的 \r 之间，独立处理各 chunk 会导致
   * 每帧内容被分别保留并拼接。通过缓冲到最后一个 \n，确保同一逻辑行内的
   * 所有 \r 帧在一次 feed() 中被正确折叠为最后一帧。
   */
  feed(chunk: string): string {
    let text = this.partialEsc + chunk;
    this.partialEsc = "";

    // 1. 逐字节擦除 ANSI 转义码
    let cleaned = "";
    let i = 0;
    while (i < text.length) {
      if (text.charCodeAt(i) !== 0x1b) {
        cleaned += text[i];
        i++;
        continue;
      }

      // ESC found at position i
      if (i + 1 >= text.length) {
        // ESC at very end — save for next chunk
        this.partialEsc = "\x1b";
        break;
      }

      const next = text.charCodeAt(i + 1);
      if (next === 0x5b) {
        // CSI: ESC [
        const escStart = i;
        i += 2;
        let found = false;
        while (i < text.length) {
          const c = text.charCodeAt(i);
          if (c >= 0x40 && c <= 0x7e) {
            // Line-control CSI sequences → emit \r so step 3 collapse handles them.
            // clack/ora and similar spinner libs redraw via \x1b[2K (erase line) and
            // \x1b[0G/\x1b[1G (cursor to column 0) instead of \r; stripping them
            // silently causes every spinner frame to concatenate on one line.
            const seq = text.substring(escStart, i + 1);
            if (seq === "\x1b[2K" || seq === "\x1b[0G" || seq === "\x1b[1G") {
              cleaned += "\r";
            }
            i++;
            found = true;
            break;
          }
          i++;
        }
        if (!found) {
          this.partialEsc = text.substring(escStart);
          break;
        }
      } else if (next === 0x5d) {
        // OSC: ESC ]
        const escStart = i;
        i += 2;
        let found = false;
        while (i < text.length) {
          if (text.charCodeAt(i) === 0x07) {
            i++;
            found = true;
            break;
          }
          if (
            text[i] === "\x1b" &&
            i + 1 < text.length &&
            text[i + 1] === "\\"
          ) {
            i += 2;
            found = true;
            break;
          }
          i++;
        }
        if (!found) {
          this.partialEsc = text.substring(escStart);
          break;
        }
      } else {
        // Two-byte escape: ESC + char
        i += 2;
      }
    }

    // 2. 行终止符归一化
    // wmic 等 Windows 工具使用 \r\r\n（双CR+LF），需先归一化，否则残留的孤立 \r
    // 会在后续进度条重建步骤中被误判为行首覆盖，导致整行内容被清空
    cleaned = cleaned.replace(/\r\r\n/g, "\n");
    cleaned = cleaned.replace(/\r\n/g, "\n");

    // 2.5 行缓冲：只处理到最后一个 \n 为止的完整行，不完整的尾部留给下一个 chunk
    const lastNl = cleaned.lastIndexOf("\n");
    let complete: string;
    if (lastNl < 0) {
      // 本 chunk 无完整行 — 全部缓冲
      this.partialLine += cleaned;
      return "";
    }
    complete = this.partialLine + cleaned.substring(0, lastNl + 1);
    this.partialLine = cleaned.substring(lastNl + 1);

    // 3. \r 进度条重建：每行只保留最后一个 \r 之后的内容
    const lines = complete.split("\n");
    const processed = lines.map((line) => {
      const lastR = line.lastIndexOf("\r");
      return lastR >= 0 ? line.substring(lastR + 1) : line;
    });
    return processed.join("\n");
  }

  /**
   * 空闲超时冲刷：处理 partialLine 中的残留文本并返回，重置 partialLine。
   * 不重置 partialEsc（ANSI 序列仍在等待补全）。
   *
   * 用途：交互式命令（如 npm install 提示 "Continue? (y/n): "）输出不以 \n
   * 结尾时，partialLine 会一直滞留。空闲超时后主动冲刷，确保 AI 能看到提示。
   * 追加 \n 分隔帧，避免后续数据与已冲刷内容拼接在同一行。
   */
  flushPartialLine(): string {
    if (!this.partialLine) return "";
    const lines = this.partialLine.split("\n");
    const processed = lines.map((line) => {
      const lastR = line.lastIndexOf("\r");
      return lastR >= 0 ? line.substring(lastR + 1) : line;
    });
    const result = processed.join("\n");
    this.partialLine = "";
    return result;
  }

  /** 进程结束时调用，处理残留的不完整行，清空所有缓冲 */
  flush(): string {
    this.partialEsc = "";
    return this.flushPartialLine();
  }
}

// ============================================================================
// SanitizerTransform — 将 StreamingSanitizer 适配为 Transform 流
// 接收 Buffer → 解码 → 清洗 → push string，同时触发副作用回调
// ============================================================================

export class SanitizerTransform extends Transform {
  private sanitizer = new StreamingSanitizer();
  /** 空闲超时计时器：数据流停顿超过阈值时冲刷 partialLine */
  private idleTimer: NodeJS.Timeout | null = null;
  /** 空闲冲刷延迟（毫秒）。curl 进度条更新间隔约 1s，500ms 足以区分进度条与交互提示 */
  private readonly IDLE_FLUSH_MS = 500;
  /** 自动检测出的编码（首次遇到非 ASCII 字节后锁定） */
  private detectedEncoding: string | null = null;

  constructor(
    private encoding: string,
    private onCleaned?: (text: string) => void,
  ) {
    super();
  }

  /** 重置空闲计时器，每个 chunk 到达时调用 */
  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const flushed = this.sanitizer.flushPartialLine();
      if (flushed) {
        // 追加 \n 分隔帧：idle 冲刷是人为断行，避免后续数据与此拼接
        const output = flushed + "\n";
        this.push(output);
        this.onCleaned?.(output);
      }
    }, this.IDLE_FLUSH_MS);
  }

  /**
   * 解析当前 chunk 应使用的编码。
   * - 用户显式指定 encoding → 直接使用
   * - 非 Windows → UTF-8
   * - Windows 未指定 → 自动检测：先尝试 UTF-8，若产生 U+FFFD 替换字符则回退 GBK
   *   检测在首个含非 ASCII 字节的 chunk 上进行，之后锁定（sticky）
   *   若替换字符仅出现在末尾 1-3 位，可能是 chunk 边界截断了多字节序列，推迟判定
   */
  private resolveEncoding(chunk: Buffer): string {
    if (this.encoding) return this.encoding;
    if (process.platform !== "win32") return "utf-8";
    if (this.detectedEncoding) return this.detectedEncoding;

    // 纯 ASCII chunk 无需判定（ASCII 在 UTF-8/GBK 下一致）
    let hasNonAscii = false;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] >= 0x80) {
        hasNonAscii = true;
        break;
      }
    }
    if (!hasNonAscii) return "utf-8";

    // 尝试 UTF-8 解码，检查是否产生替换字符
    const utf8Text = iconv.decode(chunk, "utf-8");
    const fffdIdx = utf8Text.indexOf("\uFFFD");
    if (fffdIdx === -1) {
      this.detectedEncoding = "utf-8";
      return "utf-8";
    }

    // 替换字符仅在末尾 1-3 位 → 可能是 chunk 边界截断了多字节序列，暂不判定
    const lastFffd = utf8Text.lastIndexOf("\uFFFD");
    if (fffdIdx === lastFffd && fffdIdx >= utf8Text.length - 3) {
      return "utf-8";
    }

    this.detectedEncoding = "gbk";
    return "gbk";
  }

  _transform(chunk: Buffer, _enc: string, cb: () => void) {
    const encoding = this.resolveEncoding(chunk);
    const raw = decodeBuffer(chunk, encoding);
    const cleaned = this.sanitizer.feed(raw);
    if (cleaned) {
      this.push(cleaned);
      this.onCleaned?.(cleaned);
    }
    this.resetIdleTimer();
    cb();
  }

  _flush(cb: () => void) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const remaining = this.sanitizer.flush();
    if (remaining) {
      this.push(remaining);
      this.onCleaned?.(remaining);
    }
    cb();
  }
}
