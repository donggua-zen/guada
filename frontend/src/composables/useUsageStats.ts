import { ref } from "vue";

import { apiService } from "@/services/ApiService";
import type {
  UsageRange,
  UsageSnapshot,
} from "@/services/modules/usage.api";

/**
 * 用量统计页的数据加载器。
 *
 * 每个页面实例独立持有状态；请求序号防止快速切换范围时旧响应覆盖新响应。
 * 热力图由后端固定为近 30 天，因此不随 range 变化。
 */
export function useUsageStats(initialRange: UsageRange = "7d") {
  const range = ref<UsageRange>(initialRange);
  const snapshot = ref<UsageSnapshot | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let requestSeq = 0;

  async function load(target: UsageRange = range.value): Promise<void> {
    const seq = ++requestSeq;
    loading.value = true;
    error.value = null;
    try {
      const result = await apiService.fetchUsageStats({ range: target });
      if (seq !== requestSeq) return;
      snapshot.value = result;
      range.value = target;
    } catch (err: any) {
      if (seq !== requestSeq) return;
      error.value = err?.message || String(err);
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  function setRange(next: UsageRange): void {
    if (next === range.value && snapshot.value) return;
    range.value = next;
    void load(next);
  }

  return {
    range,
    snapshot,
    loading,
    error,
    load,
    setRange,
    refresh: () => load(range.value),
  };
}
