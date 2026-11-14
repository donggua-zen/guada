<template>
  <!-- 小台账（≤100 行）：普通流式渲染，分组头 sticky 生效 -->
  <div v-if="!virtualMode" class="flex flex-col text-xs">
    <template v-for="row in rows" :key="row.key">
      <TrajectoryRow
        :row="row"
        :expanded="expanded.has(row.key)"
        @toggle="emit('toggle', $event)"
        @open-sub-trajectory="emit('open-sub-trajectory', $event)"
      />
    </template>
  </div>

  <!-- 大台账（>100 行）：@tanstack/vue-virtual 动态计量虚拟化
       （dsh trajectory-virtual-rows 思路：行高动态测量；虚拟模式下分组头不做 sticky） -->
  <div v-else ref="scrollEl" class="h-full w-full overflow-y-auto text-xs">
    <div class="relative" :style="{ height: `${totalSize}px` }">
      <div
        v-for="vRow in virtualRows"
        :key="rows[vRow.index]!.key"
        :ref="measureElement"
        :data-index="vRow.index"
        class="absolute left-0 top-0 w-full"
        :style="{ transform: `translateY(${vRow.start}px)` }"
      >
        <TrajectoryRow
          :row="rows[vRow.index]!"
          :expanded="expanded.has(rows[vRow.index]!.key)"
          @toggle="emit('toggle', $event)"
          @open-sub-trajectory="emit('open-sub-trajectory', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 轨迹台账（dsh TrajectoryTable 的精简版）：回合分界 + SYSTEM 快照 + 消息行。
 * 双模式：小台账普通渲染（sticky 分组头），大台账虚拟化（>100 行，dsh 同阈值思路）；
 * 行组件统一由 TrajectoryRow 承载，展开状态由 Panel 层 Set 管理。
 */
import { computed, ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { LedgerRow } from '@/composables/useTrajectory';
import TrajectoryRow from './TrajectoryRow.vue';

/** 虚拟化阈值（对齐 dsh VIRTUALIZATION_THRESHOLD 的行数量级） */
const VIRTUALIZATION_THRESHOLD = 100;

const props = defineProps<{
  rows: LedgerRow[];
  expanded: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [key: string];
  'open-sub-trajectory': [subSessionId: string];
}>();

const virtualMode = computed(() => props.rows.length > VIRTUALIZATION_THRESHOLD);
const scrollEl = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.rows.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 28,
    overscan: 12,
    getItemKey: (index: number) => props.rows[index]?.key ?? index,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
const measureElement = (el: any) => virtualizer.value.measureElement(el);

</script>
