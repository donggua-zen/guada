import { ref, onUnmounted } from 'vue';

/**
 * 性能监控数据结构
 */
export interface PerfMetrics {
  fps: number
  frameTime: number
  longTasks: number
  layoutTime: number
  memoryDelta: number
}

/**
 * 性能监控组合式函数
 * 用于收集拖拽过程中的性能数据
 */
export function usePerfMonitor() {
  const isMonitoring = ref(false);
  const metrics = ref<PerfMetrics>({
    fps: 0,
    frameTime: 0,
    longTasks: 0,
    layoutTime: 0,
    memoryDelta: 0
  });

  let rafId: number | null = null;
  let frameCount = 0;
  let lastTime = 0;
  let longTaskCount = 0;
  let layoutTimeTotal = 0;
  let observer: PerformanceObserver | null = null;
  let startMemory = 0;

  /**
   * 开始监控
   */
  function start() {
    if (isMonitoring.value) return;
    isMonitoring.value = true;

    frameCount = 0;
    longTaskCount = 0;
    layoutTimeTotal = 0;
    lastTime = performance.now();

    // 记录初始内存
    const mem = (performance as any).memory;
    startMemory = mem ? mem.usedJSHeapSize : 0;

    // 监听 LongTask
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 16) {
              longTaskCount++;
            }
            // 累加布局相关耗时
            if (entry.entryType === 'measure') {
              layoutTimeTotal += entry.duration;
            }
          }
        });
        observer.observe({ entryTypes: ['longtask', 'measure'] });
      } catch {
        // 浏览器不支持某些 entryTypes，忽略
      }
    }

    // 帧率计数循环
    const countFrame = () => {
      frameCount++;
      if (isMonitoring.value) {
        rafId = requestAnimationFrame(countFrame);
      }
    };
    rafId = requestAnimationFrame(countFrame);
  }

  /**
   * 停止监控并返回结果
   */
  function stop(): PerfMetrics {
    if (!isMonitoring.value) return metrics.value;
    isMonitoring.value = false;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const endTime = performance.now();
    const duration = (endTime - lastTime) / 1000; // 秒

    // 计算 FPS
    const fps = duration > 0 ? Math.round(frameCount / duration) : 0;
    const frameTime = frameCount > 0 ? (duration * 1000) / frameCount : 0;

    // 计算内存变化
    const mem = (performance as any).memory;
    const endMemory = mem ? mem.usedJSHeapSize : 0;
    const memoryDelta = endMemory - startMemory;

    metrics.value = {
      fps,
      frameTime: Math.round(frameTime * 100) / 100,
      longTasks: longTaskCount,
      layoutTime: Math.round(layoutTimeTotal * 100) / 100,
      memoryDelta
    };

    return metrics.value;
  }

  /**
   * 获取当前实时指标
   */
  function getCurrentMetrics(): Partial<PerfMetrics> {
    const now = performance.now();
    const duration = (now - lastTime) / 1000;
    const fps = duration > 0 ? Math.round(frameCount / duration) : 0;
    return {
      fps,
      longTasks: longTaskCount
    };
  }

  onUnmounted(() => {
    stop();
  });

  return {
    isMonitoring,
    metrics,
    start,
    stop,
    getCurrentMetrics
  };
}
