/**
 * 前端性能统计（opt-in，默认关闭）。
 *
 * 开启方式：
 * - dev：URL 加 `?perf=1`，或控制台 `__gdPerf.enable()`
 * - 打包版/Electron：控制台 `localStorage.setItem('gd:perf','1')` 后重启，
 *   或直接 `__gdPerf.enable()`
 * 关闭：`__gdPerf.disable()`；URL `?perf=0` 会清除持久开关。
 *
 * 关闭时所有 API 只有一次布尔判断：不采样、不启动 observer/rAF、不留数字。
 * 指标只保存数字（样本环形缓冲上限 512），不持有块/字符串引用。
 */

const ENABLE_KEY = 'gd:perf';
const MAX_SAMPLES = 512;

export type PerfMeta = Record<string, number | string>;

export interface PerfRow {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meta: PerfMeta;
}

export interface PerfRuntimeSnapshot {
  durationMs: number;
  longTasks: number;
  longTaskMs: number;
  fps: number;
  heapUsedMB: number | null;
  domNodes: number | null;
}

export interface PerfReport {
  enabled: boolean;
  generatedAt: string;
  runtime: PerfRuntimeSnapshot;
  rows: PerfRow[];
}

export interface PerfSpan {
  end(meta?: PerfMeta): void;
}

interface MetricState {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  samples: number[];
  sampleCount: number;
  meta: PerfMeta;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function mergeMeta(target: PerfMeta, meta?: PerfMeta): void {
  if (!meta) return;
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'number') {
      const prev = target[key];
      target[key] = typeof prev === 'number' ? prev + value : value;
    } else {
      target[key] = value;
    }
  }
}

/**
 * 纯聚合器：与浏览器环境解耦，便于单元测试。
 * record 记录耗时样本；count 记录纯计数（如 deep watch 触发次数）。
 */
export function createPerfCollector() {
  const metrics = new Map<string, MetricState>();
  const counters = new Map<string, number>();

  const record = (name: string, durationMs: number, meta?: PerfMeta): void => {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    let state = metrics.get(name);
    if (!state) {
      state = {
        count: 0,
        totalMs: 0,
        minMs: durationMs,
        maxMs: durationMs,
        lastMs: durationMs,
        samples: [],
        sampleCount: 0,
        meta: {},
      };
      metrics.set(name, state);
    }
    state.count += 1;
    state.totalMs += durationMs;
    state.lastMs = durationMs;
    if (durationMs < state.minMs) state.minMs = durationMs;
    if (durationMs > state.maxMs) state.maxMs = durationMs;
    if (state.samples.length < MAX_SAMPLES) {
      state.samples.push(durationMs);
    } else {
      state.samples[state.sampleCount % MAX_SAMPLES] = durationMs;
    }
    state.sampleCount += 1;
    mergeMeta(state.meta, meta);
  };

  const count = (name: string, delta = 1): void => {
    counters.set(name, (counters.get(name) ?? 0) + delta);
  };

  const rows = (): PerfRow[] => {
    const out: PerfRow[] = [];
    for (const [name, state] of metrics) {
      const sorted = [...state.samples].sort((a, b) => a - b);
      out.push({
        name,
        count: state.count,
        totalMs: round(state.totalMs),
        avgMs: round(state.totalMs / state.count),
        p50Ms: round(percentile(sorted, 50)),
        p95Ms: round(percentile(sorted, 95)),
        maxMs: round(state.maxMs),
        meta: { ...state.meta },
      });
    }
    for (const [name, countValue] of counters) {
      out.push({
        name,
        count: countValue,
        totalMs: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
        meta: {},
      });
    }
    return out.sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);
  };

  const reset = (): void => {
    metrics.clear();
    counters.clear();
  };

  return { record, count, rows, reset };
}

// ── 模块级运行态 ──────────────────────────────────────────────

const collector = createPerfCollector();
let enabled = false;
let enabledAt = 0;
let longTaskCount = 0;
let longTaskMs = 0;
let observer: PerformanceObserver | null = null;
let rafId: number | null = null;
let frameCount = 0;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function isPerfEnabled(): boolean {
  return enabled;
}

function startMonitors(): void {
  longTaskCount = 0;
  longTaskMs = 0;
  frameCount = 0;
  if (typeof window === 'undefined') return;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskCount += 1;
          longTaskMs += entry.duration;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }
  }

  if (typeof requestAnimationFrame === 'function') {
    const tick = () => {
      frameCount += 1;
      if (enabled) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
}

function stopMonitors(): void {
  observer?.disconnect();
  observer = null;
  if (rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafId);
  }
  rafId = null;
}

export function enablePerf(): void {
  if (enabled) return;
  enabled = true;
  enabledAt = nowMs();
  startMonitors();
  console.info('[perf] enabled — 复现操作后执行 __gdPerf.report()');
}

export function disablePerf(): void {
  if (!enabled) return;
  enabled = false;
  stopMonitors();
  console.info('[perf] disabled');
}

/**
 * 开始一个计时区间；关闭时返回 null。
 * 建议用 `span?.end({ ... })` 收尾——可选链会短路参数求值，meta 对象在关闭时不会创建。
 */
export function perfStart(name: string): PerfSpan | null {
  if (!enabled) return null;
  const startedAt = nowMs();
  let ended = false;
  return {
    end(meta?: PerfMeta): void {
      if (ended) return;
      ended = true;
      collector.record(name, nowMs() - startedAt, meta);
    },
  };
}

/** 带作用域的计时名（如 live.chunk.text_delta）；关闭时不拼接字符串。 */
export function perfStartScoped(prefix: string, scope: string): PerfSpan | null {
  if (!enabled) return null;
  return perfStart(`${prefix}.${scope}`);
}

/** 同步包裹计时；关闭时直接执行 fn。高频路径建议用 perfStart 避免 meta 对象分配。 */
export function perfMeasure<T>(name: string, fn: () => T, meta?: PerfMeta): T {
  if (!enabled) return fn();
  const startedAt = nowMs();
  try {
    return fn();
  } finally {
    collector.record(name, nowMs() - startedAt, meta);
  }
}

export function perfCount(name: string, delta = 1): void {
  if (!enabled) return;
  collector.count(name, delta);
}

export function resetPerf(): void {
  collector.reset();
  longTaskCount = 0;
  longTaskMs = 0;
  frameCount = 0;
  enabledAt = nowMs();
}

export function perfSnapshot(): PerfReport {
  const durationMs = enabled ? nowMs() - enabledAt : 0;
  const heap = typeof performance !== 'undefined' ? performance.memory : undefined;
  const domNodes = typeof document !== 'undefined'
    ? document.getElementsByTagName('*').length
    : null;
  const fps = durationMs > 0 ? Math.round((frameCount / durationMs) * 1000) : 0;
  return {
    enabled,
    generatedAt: new Date().toISOString(),
    runtime: {
      durationMs: round(durationMs),
      longTasks: longTaskCount,
      longTaskMs: round(longTaskMs),
      fps,
      heapUsedMB: heap ? round(heap.usedJSHeapSize / 1048576) : null,
      domNodes,
    },
    rows: collector.rows(),
  };
}

function compactMeta(meta: PerfMeta): string {
  return Object.entries(meta).map(([key, value]) => `${key}=${value}`).join(' ');
}

export function perfReport(): PerfReport {
  const report = perfSnapshot();
  const table = report.rows.map(({ meta, ...row }) => ({ ...row, meta: compactMeta(meta) }));
  console.group('[perf] GuaDa frontend');
  console.table(table);
  console.log(
    `enabled=${report.enabled} duration=${report.runtime.durationMs}ms ` +
    `longtasks=${report.runtime.longTasks} (${report.runtime.longTaskMs}ms) ` +
    `fps=${report.runtime.fps} ` +
    `heap=${report.runtime.heapUsedMB ?? 'N/A'}MB ` +
    `dom=${report.runtime.domNodes ?? 'N/A'}`,
  );
  console.groupEnd();
  return report;
}

export function exportPerf(): string {
  return JSON.stringify(perfSnapshot(), null, 2);
}

function readEnvFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('perf') === '0') {
      window.localStorage.removeItem(ENABLE_KEY);
      return false;
    }
    if (params.get('perf') === '1') return true;
    return window.localStorage.getItem(ENABLE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface PerfGlobal {
  enable: typeof enablePerf;
  disable: typeof disablePerf;
  reset: typeof resetPerf;
  report: typeof perfReport;
  snapshot: typeof perfSnapshot;
  exportJSON: typeof exportPerf;
  help: () => void;
  readonly enabled: boolean;
}

declare global {
  interface Window {
    __gdPerf?: PerfGlobal;
  }
}

/** 安装 `window.__gdPerf`；带 ?perf=1 / localStorage 开关时自动开启。 */
export function installPerfGlobal(): void {
  if (typeof window === 'undefined') return;
  if (readEnvFlag()) enablePerf();
  if (window.__gdPerf) return;
  window.__gdPerf = {
    enable: enablePerf,
    disable: disablePerf,
    reset: resetPerf,
    report: perfReport,
    snapshot: perfSnapshot,
    exportJSON: exportPerf,
    help: () => {
      console.info(
        [
          '[perf] 用法：',
          '  __gdPerf.enable()      开启统计',
          '  __gdPerf.report()      打印按操作归因的耗时表',
          '  __gdPerf.snapshot()    返回结构化报告（不打印）',
          '  __gdPerf.exportJSON()  导出 JSON 字符串',
          '  __gdPerf.reset()       清空统计（切换场景前调用）',
          '  __gdPerf.disable()     关闭统计',
          '  URL ?perf=1 开启；?perf=0 关闭并清除 localStorage 开关',
        ].join('\n'),
      );
    },
    get enabled() {
      return enabled;
    },
  };
}
