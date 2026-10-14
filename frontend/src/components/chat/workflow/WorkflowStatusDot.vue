<template>
  <!-- 工作流状态点：run 行 8px / 成员行 6px；运行中自带脉冲环。
       单一来源——对话流内联卡片、审阅面板的 run 行与成员树共用，避免各处再抄一份 scoped 样式。 -->
  <span class="wf-dot" :class="[size === 'sm' ? 'wf-dot--sm' : '', `wf-dot--${status}`]">
    <span v-if="status === 'running'" class="wf-dot-pulse"></span>
  </span>
</template>

<script setup lang="ts">
import type { WorkflowMemberStatus } from "@/types/stream/workflow.types";

withDefaults(
  defineProps<{
    status: WorkflowMemberStatus;
    /** md = run 行（8px），sm = 成员行（6px） */
    size?: "md" | "sm";
  }>(),
  { size: "md" },
);
</script>

<style scoped>
.wf-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--gd-color-text-disabled);
  position: relative;
}
.wf-dot--sm {
  width: 6px;
  height: 6px;
}
.wf-dot--running {
  background: var(--gd-color-success, #22c55e);
}
.wf-dot--running .wf-dot-pulse {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1px solid var(--gd-color-success, #22c55e);
  opacity: 0;
  animation: wf-pulse 1.6s ease-out infinite;
}
.wf-dot--completed {
  background: var(--gd-color-text-disabled);
}
.wf-dot--failed {
  background: #ef4444;
}
.wf-dot--cancelled {
  background: var(--gd-color-text-disabled);
}
@keyframes wf-pulse {
  0% { transform: scale(0.5); opacity: 0.9; }
  100% { transform: scale(1.4); opacity: 0; }
}
</style>
