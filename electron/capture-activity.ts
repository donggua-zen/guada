/**
 * 截图期间的合成器取帧泵。
 *
 * 窗口失焦/被其他窗口遮挡时，Chromium 会暂停或大幅压低 renderer 的帧生产；
 * 后台 webview 即使被临时设为可渲染，也可能因为宿主窗口被判定为 occluded
 * 而拿不到第一帧，表现为 capturePage / Page.captureScreenshot 长时间不返回。
 *
 * 这里对目标（guest + 宿主 renderer）持续发起 1×1 的 capturePage：
 * CopyFromSurface 会迫使 Viz 产帧，同时不改变页面布局、DPR 或交互状态。
 * 每个 target 同时最多一份 in-flight，避免读回堆积；调用方在 finally 中 stop。
 */

export interface CapturePumpTarget {
  capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<unknown>;
  isDestroyed?(): boolean;
}

export interface CapturePumpOptions {
  /** 两次取帧之间的间隔，默认 120ms（约 8Hz） */
  intervalMs?: number;
  /** 自动停止的兜底时间，默认 15s */
  deadlineMs?: number;
}

const DEFAULT_INTERVAL_MS = 120;
const DEFAULT_DEADLINE_MS = 15_000;
const PROBE_RECT = { x: 0, y: 0, width: 1, height: 1 } as const;

export function startCapturePump(
  targets: Array<CapturePumpTarget | null | undefined>,
  options: CapturePumpOptions = {},
): () => void {
  const active = targets.filter(
    (target): target is CapturePumpTarget =>
      Boolean(target) && !(target as CapturePumpTarget).isDestroyed?.(),
  );
  const intervalMs = Math.max(16, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const deadlineMs = Math.max(intervalMs, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const inFlight = new Set<CapturePumpTarget>();
  const deadline = Date.now() + deadlineMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const pump = () => {
    if (stopped) return;
    if (Date.now() >= deadline || active.length === 0) {
      stop();
      return;
    }
    for (const target of active) {
      if (inFlight.has(target)) continue;
      if (target.isDestroyed?.()) continue;
      inFlight.add(target);
      void target
        .capturePage(PROBE_RECT)
        .catch(() => undefined)
        .finally(() => {
          inFlight.delete(target);
        });
    }
    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(pump, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  schedule();
  return stop;
}
