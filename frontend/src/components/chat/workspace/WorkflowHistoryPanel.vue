<template>
  <!-- 工作流审阅标签：本会话全部 workflow run（终态归档 + 运行中内存快照合并）。
       行点击展开详情：成员树（可跳子代理会话）+ run-log 播报 + 脚本返回值/错误。 -->
  <div class="workflow-history h-full w-full flex flex-col overflow-hidden">
    <div class="wh-toolbar shrink-0 flex items-center justify-between px-3 h-9">
      <span class="wh-title">{{ t('chat.workspace.workflowHistory') }}</span>
      <span v-if="runs.length" class="wh-count">{{ runs.length }}</span>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
      <div v-if="!runs.length" class="wh-empty">
        {{ workflowStore.isPending(props.sessionId) ? t('common.loading') : t('chat.workspace.workflowEmpty') }}
      </div>
      <div v-for="run in runs" :key="run.runId" class="wh-run">
        <div class="wh-run-row" :title="run.description || run.name || run.runId"
          @click="toggleRun(run.runId)">
          <WorkflowStatusDot :status="run.status" />
          <svg class="wh-chevron" :class="{ 'is-open': isExpanded(run.runId) }" width="12" height="12"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span class="wh-name">{{ run.name || run.runId }}</span>
          <span class="wh-meta">{{ runMetaText(run) }}</span>
        </div>
        <div v-if="isExpanded(run.runId)" class="wh-detail">
          <!-- 成员树（与对话流内联卡片同款紧凑树；成员可跳子代理会话） -->
          <WorkflowMemberTree :agents="run.agents" :can-open="!!openSubAgent"
            @open="(subSessionId: string) => openSubAgent?.(subSessionId)" />
          <!-- run-log 播报 -->
          <div v-if="run.logs.length" class="wh-logs">
            <div v-for="(line, i) in run.logs" :key="i" class="wh-log-line">{{ line }}</div>
          </div>
          <!-- 错误 / 脚本返回值 -->
          <div v-if="run.errorMessage" class="wh-block">
            <div class="wh-block-title">{{ t('chat.workspace.workflowError') }}</div>
            <pre class="wh-pre wh-pre--error">{{ run.errorMessage }}</pre>
          </div>
          <div v-else-if="run.status === 'completed' && run.result !== undefined" class="wh-block">
            <div class="wh-block-title">{{ t('chat.workspace.workflowResult') }}</div>
            <pre class="wh-pre">{{ formatResult(run.result) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject } from "vue";
import { useI18n } from "vue-i18n";
import WorkflowStatusDot from "@/components/chat/workflow/WorkflowStatusDot.vue";
import WorkflowMemberTree from "@/components/chat/workflow/WorkflowMemberTree.vue";
import { useWorkflowRunsStore } from "@/stores/workflowRuns";
import { formatWorkflowResult, workflowRunMetaText } from "@/utils/workflowDisplay";
import type { WorkflowRunState } from "@/types/stream/workflow.types";

const props = defineProps<{ sessionId: string }>();
const { t } = useI18n();
const tr = (key: string) => t(key);
const workflowStore = useWorkflowRunsStore();

/** 本会话全部 run：运行中在前、完成后按结束时间倒序。
 *  数据由 store 常驻消费（REST 基线 + workflow_event SSE），本面板不再自建请求/订阅。 */
const runs = computed(() => workflowStore.getSessionRuns(props.sessionId));
const expandedIds = ref(new Set<string>());

function toggleRun(runId: string): void {
  if (expandedIds.value.has(runId)) {
    expandedIds.value.delete(runId);
  } else {
    expandedIds.value.add(runId);
  }
}

function isExpanded(runId: string): boolean {
  return expandedIds.value.has(runId);
}

// 成员行点击 → 跳转子代理会话（复用 ChatPage provide；无 provide 的宿主下不可点）
const openSubAgent = inject<((subSessionId: string) => void) | null>(
  "workspace:openSubAgentSession",
  null,
);

function runMetaText(run: WorkflowRunState): string {
  return workflowRunMetaText(tr, run);
}

function formatResult(result: unknown): string {
  return formatWorkflowResult(result);
}

watch(
  () => props.sessionId,
  (id) => {
    expandedIds.value = new Set<string>();
    if (id) void workflowStore.ensureLoaded(id);
  },
  { immediate: true },
);
</script>

<style scoped>
/* ── 工具条 ── */
.wh-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wh-title {
  font-size: 12px;
  color: var(--gd-color-text-gray);
}
.wh-count {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}
.wh-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}

/* ── run 行 ── */
.wh-run + .wh-run {
  margin-top: 2px;
}
.wh-run-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 5px;
  cursor: pointer;
  min-width: 0;
}
.wh-run-row:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.wh-chevron {
  flex-shrink: 0;
  color: var(--gd-color-text-disabled);
  transition: transform 0.15s ease;
}
.wh-chevron.is-open {
  transform: rotate(90deg);
}
.wh-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: var(--gd-color-text);
}
.wh-meta {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}

/* ── 详情区 ── */
.wh-detail {
  margin: 2px 0 6px 12px;
  padding-left: 10px;
}
.wh-logs {
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--gd-color-surface, rgba(128, 128, 128, 0.06));
}
.wh-log-line {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  line-height: 18px;
  color: var(--gd-color-text-gray);
  word-break: break-all;
}
.wh-block {
  margin-top: 6px;
}
.wh-block-title {
  font-size: 11px;
  color: var(--gd-color-text-disabled);
  margin-bottom: 3px;
}
.wh-pre {
  margin: 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--gd-color-surface, rgba(128, 128, 128, 0.06));
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  line-height: 18px;
  color: var(--gd-color-text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow-y: auto;
}
.wh-pre--error {
  color: #ef4444;
}
</style>
