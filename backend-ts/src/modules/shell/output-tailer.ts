import * as fsSync from "node:fs";
import { OutputDecoder } from "./stream-sanitizer";

/**
 * 输出写入器：把管道里读出的原始字节块（stdout/stderr 合一）流式解码 + 清洗，
 * 追加进给 AI / UI 读的单个 UTF-8 日志文件。
 *
 * 形状为什么是这样：
 * - 子进程树直写管道写端（native：CreatePipe 的 inheritable 写端；legacy：Node stdio pipe），
 *   完成信号只认直接子进程 exit，不再被「继承了写句柄的后代进程」绑架——EOF 只影响
 *   还能不能再读到字节，不影响完成判定；
 * - 清洗发生在读侧、严格按到达顺序喂 OutputDecoder，所以跨 chunk 多字节、粘性 GBK 判定
 *   这些流式语义照旧成立；
 * - append 是同步本地 IO：函数返回即「文件已包含这些字节」，读路径不需要任何 flush 协调。
 */export class OutputTailer {
  private readonly decoder: OutputDecoder;
  /** 追加失败只报一次，避免刷屏 */
  private appendFailed = false;

  constructor(
    /** 清洗后的 UTF-8 日志（AI/UI 读的那份，也是唯一一份） */
    readonly logPath: string,
    encoding: string,
    private readonly onWarn?: (message: string) => void,
  ) {
    this.decoder = new OutputDecoder(encoding);
  }

  /**
   * 喂一段从管道读出的原始字节：解码 + 清洗后追加到日志文件。
   * 不抛错：清洗/写入失败不能把泵带崩，留一条 WARN 即可。
   */
  feed(bytes: Buffer): void {
    if (!bytes || bytes.length === 0) return;
    this.append(this.decoder.feed(bytes));
  }

  /**
   * 空闲冲刷：交出滞留的未结束行（交互式命令的提示词不以 \n 结尾）。
   * 语义与原 SanitizerTransform 的 500ms 空闲冲刷一致：人为断行，后续数据另起一行。
   */
  flushIdle(): void {
    this.append(this.decoder.flushPartialLine());
  }

  /** 直接子进程退出：交出解码器残留字节并冲刷行缓冲 */
  flushFinal(): void {
    this.append(this.decoder.flush());
  }

  /** 删除日志文件（best-effort）。Windows 上被占用时交给日志目录 GC。 */
  removeFiles(): void {
    try {
      fsSync.rmSync(this.logPath, { force: true });
    } catch {
      // 被占用 / 已删除 —— 交给 GC
    }
  }

  private append(text: string): void {
    if (!text) return;
    try {
      fsSync.appendFileSync(this.logPath, text, "utf8");
    } catch (err: any) {
      if (this.appendFailed) return;
      this.appendFailed = true;
      this.warn(`写入日志失败 (${this.logPath}): ${err?.message ?? err}`);
    }
  }

  private warn(message: string): void {
    this.onWarn?.(message);
  }
}
