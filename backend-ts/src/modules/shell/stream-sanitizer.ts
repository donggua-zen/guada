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

  /**
   * 输入一个 chunk，返回清洗后的文本。
   * ANSI 转义序列跨 chunk 边界时暂存在 partialEsc 中，等下一个 chunk 补全。
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

    // 3. \r 进度条重建：每行只保留最后一个 \r 之后的内容
    const lines = cleaned.split("\n");
    const processed = lines.map((line) => {
      const lastR = line.lastIndexOf("\r");
      return lastR >= 0 ? line.substring(lastR + 1) : line;
    });
    return processed.join("\n");
  }

  /** 进程结束时调用，丢弃不完整的 ANSI 转义序列 */
  flush(): string {
    this.partialEsc = "";
    return "";
  }
}

// ============================================================================
// SanitizerTransform — 将 StreamingSanitizer 适配为 Transform 流
// 接收 Buffer → 解码 → 清洗 → push string，同时触发副作用回调
// ============================================================================

export class SanitizerTransform extends Transform {
  private sanitizer = new StreamingSanitizer();

  constructor(
    private encoding: string,
    private onCleaned?: (text: string) => void,
  ) {
    super();
  }

  _transform(chunk: Buffer, _enc: string, cb: () => void) {
    const raw = decodeBuffer(chunk, this.encoding);
    const cleaned = this.sanitizer.feed(raw);
    if (cleaned) {
      this.push(cleaned);
      this.onCleaned?.(cleaned);
    }
    cb();
  }

  _flush(cb: () => void) {
    this.sanitizer.flush();
    cb();
  }
}
