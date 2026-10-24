import {
  JOB_READ_DEFAULT_MAX_BYTES,
  JOB_READ_MAX_MAX_BYTES,
  JOB_READ_MIN_MAX_BYTES,
  type JobOutputRead,
  type JobReadOptions,
} from "./job.types";

/**
 * 把一段完整文本按 UTF-8 字节切成 job_read 需要的 tail/offset 片段。
 *
 * 适用对象：子 Agent 最终答案、workflow 快照、scheduler 日志这类“内存里已有完整文本”的读取器。
 * shell 仍走 ProcessManager 的 spool/offset 路径，不复用本函数。
 */
export function sliceJobText(
  text: string,
  options: JobReadOptions = {},
): JobOutputRead {
  const buf = Buffer.from(text ?? "", "utf8");
  const maxBytes = clampMaxBytes(options.maxBytes);
  const requested =
    options.offset === undefined
      ? Math.max(0, buf.length - maxBytes)
      : Math.min(Math.max(0, Math.floor(options.offset)), buf.length);

  // 起点落在多字节字符中间时向后对齐；终点落在字符中间时向前回退。
  const start = alignStart(buf, requested);
  const end = alignEnd(buf, start, Math.min(buf.length, start + maxBytes));

  const slice = buf.subarray(start, end);
  return {
    text: slice.toString("utf8"),
    offset: start,
    nextOffset: end,
    size: buf.length,
    truncated: start > 0 || end < buf.length,
  };
}

function clampMaxBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return JOB_READ_DEFAULT_MAX_BYTES;
  }
  return Math.min(
    JOB_READ_MAX_MAX_BYTES,
    Math.max(JOB_READ_MIN_MAX_BYTES, Math.floor(value)),
  );
}

function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function alignStart(buf: Buffer, start: number): number {
  let next = start;
  while (next < buf.length && isContinuation(buf[next])) next += 1;
  return next;
}

function alignEnd(buf: Buffer, start: number, end: number): number {
  let next = end;
  if (next < buf.length && isContinuation(buf[next])) {
    // end 是下一个字符的续字节：把 end 回退到该字符的首字节。
    let lead = next - 1;
    while (lead >= start && isContinuation(buf[lead])) lead -= 1;
    next = lead >= start ? lead : start;
  }
  return next;
}
