import * as fsSync from "node:fs";
import { OutputDecoder } from "./stream-sanitizer";

/** 单次 pull 的分块读取大小（同时是复用缓冲的大小） */
const PULL_CHUNK_BYTES = 1024 * 1024;
/** 单次 pull 的读取预算：超大输出分批追平，避免一次调用把事件循环按住太久 */
const PULL_MAX_BYTES = 8 * 1024 * 1024;

/**
 * 输出转写器：把子进程直写出来的原始字节（spool 文件）按偏移增量解码 + 清洗，
 * 追加进给 AI / UI 读的那份 UTF-8 转写（cleaned 文件，即原有的 guada-*.log）。
 *
 * 形状为什么是这样：
 * - 子进程拿 spool 的 fd 直写（见 ProcessManagerService.createProcess），完成信号只认进程 exit，
 *   不再被「继承了写句柄的后代进程」绑架；
 * - 转写发生在读侧、严格按偏移顺序喂 OutputDecoder，所以跨 chunk 多字节、粘性 GBK 判定
 *   这些流式语义照旧成立；
 * - pull() 内部是同步读 + 同步 append：函数返回即「cleaned 已包含读到的这些字节」，
 *   于是读路径不需要任何 flush 协调——旧管道实现里 `await finished(writeStream)` 那一整套
 *   正是为了等一个不受自己控制的事件，这里把它变成了确定的本地 IO。
 *
 * 取舍：结果只包含到「shell 退出」那一刻；仍有后代在写 spool 的话，那些字节属于后续读取
 * （readLogTail / poll 会再 pull 到），不再把本次调用拖住。
 */
export class OutputTailer {
  private readonly decoder: OutputDecoder;
  /** 已转写的原始字节偏移（单调递增，绝不回退） */
  private rawOffset = 0;
  /** 复用缓冲：转写在 500ms ticker 上高频发生，避免每轮都分配 1MB */
  private readonly buffer = Buffer.allocUnsafe(PULL_CHUNK_BYTES);
  /** pull 重入保护 */
  private pulling = false;
  /** 追加失败只报一次，避免刷屏 */
  private appendFailed = false;

  constructor(
    /** 子进程直写的原始输出（spool） */
    readonly rawPath: string,
    /** 清洗后的 UTF-8 转写（AI/UI 读的那份） */
    readonly cleanedPath: string,
    encoding: string,
    private readonly onWarn?: (message: string) => void,
  ) {
    this.decoder = new OutputDecoder(encoding);
  }

  /**
   * 追平 spool：把新写出来的原始字节解码 + 清洗后追加到 cleaned。
   * 可随时调用（读路径进入前、ticker 每轮）；无新数据、spool 不存在时是廉价的空操作。
   * 不抛错：转写失败不能把读路径带崩，留一条 WARN 即可。
   */
  pull(): void {
    if (this.pulling) return;
    this.pulling = true;
    let fd: number | null = null;
    try {
      try {
        fd = fsSync.openSync(this.rawPath, "r");
      } catch {
        // spool 尚未创建或已被回收 —— 不是错误
        return;
      }
      let budget = PULL_MAX_BYTES;
      while (budget > 0) {
        const want = Math.min(PULL_CHUNK_BYTES, budget);
        const read = fsSync.readSync(fd, this.buffer, 0, want, this.rawOffset);
        if (read <= 0) break; // 追平
        this.rawOffset += read;
        budget -= read;
        this.append(this.decoder.feed(this.buffer.subarray(0, read)));
      }
    } catch (err: any) {
      this.warn(`转写原始输出失败 (${this.rawPath}): ${err?.message ?? err}`);
    } finally {
      if (fd !== null) {
        try {
          fsSync.closeSync(fd);
        } catch {
          // ignore
        }
      }
      this.pulling = false;
    }
  }

  /**
   * 空闲冲刷：交出滞留的未结束行（交互式命令的提示词不以 \n 结尾）。
   * 语义与原 SanitizerTransform 的 500ms 空闲冲刷一致：人为断行，后续数据另起一行。
   */
  flushIdle(): void {
    this.append(this.decoder.flushPartialLine());
  }

  /** 进程退出：追平剩余字节并冲刷解码器/行缓冲残留 */
  flushFinal(): void {
    this.pull();
    this.append(this.decoder.flush());
  }

  /**
   * 删除两个输出文件（best-effort）。
   * Windows 上仍有进程攥着 spool fd 时会删不掉——静默交给日志目录的 GC，不当成错误。
   */
  removeFiles(): void {
    for (const p of [this.cleanedPath, this.rawPath]) {
      try {
        fsSync.rmSync(p, { force: true });
      } catch {
        // 被占用 / 已删除 —— 交给 GC
      }
    }
  }

  private append(text: string): void {
    if (!text) return;
    try {
      fsSync.appendFileSync(this.cleanedPath, text, "utf8");
    } catch (err: any) {
      if (this.appendFailed) return;
      this.appendFailed = true;
      this.warn(
        `写入清洗日志失败 (${this.cleanedPath}): ${err?.message ?? err}`,
      );
    }
  }

  private warn(message: string): void {
    this.onWarn?.(message);
  }
}
