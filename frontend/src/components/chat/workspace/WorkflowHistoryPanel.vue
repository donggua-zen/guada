<template>
  <!-- 工作流审阅标签：本会话全部 workflow run（终态归档 + 运行中内存快照合并）。
       行点击展开详情：成员树（可跳子代理会话）+ run-log 播报 + 脚本返回值/错误。 -->
  <div class="workflow-history h-full w-full flex flex-col overflow-hidden">
    <div class="wh-toolbar shrink-0 flex items-center justify-between px-3 h-9">
      <span class="wh-title">{{ t('chat.workspace.workflowHistory') }}</span>
      <span v-if="runs.length" class="wh-count">{{ runs.length }}</span>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
      <div v-if="!runs.length" class="wh-empty">{{ t('chat.workspace.workflowEmpty') }}</div>
      <div v-for="run in runs" :key="run.runId" class="wh-run">
        <div class="wh-run-row" :title="run.description || run.name || run.runId"
          @click="toggleRun(run.runId)">
          <span class="wf-dot" :class="`wf-dot--${run.status}`">
            <span v-if="run.status === 'running'" class="wf-dot-pulse"></span>
          </span>
          <svg class="wh-chevron" :class="{ 'is-open': isExpanded(run.runId) }" width="12" height="12"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span class="wh-name">{{ run.name || run.runId }}</span>
          <span class="wh-meta">{{ runMetaText(run) }}</span>
        </div>
        <div v-if="isExpanded(run.runId)" class="wh-detail">
          <!-- 成员树（与概览面板同款紧凑树；成员可跳子代理会话） -->
          <div v-if="run.agents.length" class="wf-agents">
            <div v-for="agent in run.agents" :key="agent.callId" class="wf-agent"
              :class="{ 'wf-agent--clickable': !!agent.subSessionId }"
              @click="agent.subSessionId && openSubAgent(agent.subSessionId)">
              <div class="wf-agent-row">
                <span class="wf-dot wf-dot--sm" :class="`wf-dot--${agent.status}`"></span>
                <span class="wf-agent-label">{{ agent.label }}</span>
              </div>
              <div class="wf-agent-sub">{{ agentSubText(agent) }}</div>
            </div>
          </div>
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
import { ref, watch, inject, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { apiService } from "@/services/ApiService";
import { streamEventHub, type HubStreamEvent } from "@/services/modules/StreamEventHub";
import { applyWorkflowEvent } from "@/services/modules/workflowRuns";
import type {
  WorkflowRunState,
  WorkflowAgentState,
  WorkflowMemberStatus,
} from "@/types/stream/workflow.types";

const props = defineProps<{ sessionId: string }>();
const { t } = useI18n();

const runs = ref<WorkflowRunState[]>([]);
const expandedIds = ref(new Set<string>());

let unsubscribeWorkflowStream: (() => void) | null = null;

async function load(): Promise<void> {
  if (!props.sessionId) {
    runs.value = [];
    return;
  }
  try {
    const res = await apiService.getWorkflowRuns(props.sessionId);
    runs.value = res.runs || [];
  } catch {
    runs.value = [];
  }
}

function handleStreamChunk(chunk: HubStreamEvent): void {
  if (chunk.type !== "workflow_event") return;
  // WireStreamEvent 信封自带 sessionId，WorkflowEvent 自带 event，无需断言
  const sid = chunk.sessionId;
  if (sid !== props.sessionId) return;
  applyWorkflowEvent(runs.value, chunk.event);
}

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

// 成员行点击 → 跳转子代理会话（复用 ChatPage provide）
const openSubAgent = inject<(subSessionId: string) => void>(
  "workspace:openSubAgentSession",
  () => {},
);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

const STATUS_KEYS: Record<WorkflowMemberStatus | "cancelled", string> = {
  running: "wfRunning",
  completed: "wfCompleted",
  failed: "wfFailed",
  cancelled: "wfCancelled",
};

function statusText(status: WorkflowMemberStatus): string {
  return t(`chat.workspace.${STATUS_KEYS[status]}`);
}

function runMetaText(run: WorkflowRunState): string {
  if (run.status === "running") {
    if (run.agents.length === 0) return t("chat.workspace.wfStarting");
    const active = run.agents.filter((a) => a.status === "running").length;
    return `${run.agents.length - active}/${run.agents.length}`;
  }
  if (run.durationMs !== undefined) return formatDuration(run.durationMs);
  return statusText(run.status);
}

function agentSubText(agent: WorkflowAgentState): string {
  const summary = (agent.outputSummary || "").replace(/\s+/g, " ").trim();
  const truncated = summary.length > 40 ? summary.slice(0, 40) + "…" : summary;
  return truncated ? `${truncated} · ${statusText(agent.status)}` : statusText(agent.status);
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

watch(
  () => props.sessionId,
  () => {
    expandedIds.value = new Set<string>();
    void load();
  },
  { immediate: true },
);

onMounted(() => {
  unsubscribeWorkflowStream = streamEventHub.subscribeAll(handleStreamChunk);
});

onUnmounted(() => {
  unsubscribeWorkflowStream?.();
  unsubscribeWorkflowStream = null;
});
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

/* ── 状态点 + 成员紧凑树（与概览面板同款） ── */
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
  animation: wh-pulse 1.6s ease-out infinite;
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
@keyframes wh-pulse {
  0% { transform: scale(0.5); opacity: 0.9; }
  100% { transform: scale(1.4); opacity: 0; }
}
.wf-agents {
  margin: 4px 0 0 0;
  display: flex;
  flex-direction: column;
}
.wf-agent {
  position: relative;
  /* 与 run 行同宽同起点；左内边距容纳树形线列（线对齐 run 行圆点下方） */
  padding: 3px 4px 3px 24px;
  border-radius: 4px;
}
/* 成员行树形线（与概览面板同款）：竖线画在行盒内部（hover 含线列）、横肘连到圆点；
   run 标题行无线；末成员竖线止于横肘（本面板成员行无包装器，:last-child 直取行本身） */
.wf-agent::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  border-left: 1px solid var(--gd-color-border, #e5e7eb);
}
.wf-agent:last-child::before {
  bottom: auto;
  height: 12px;
}
.wf-agent::after {
  content: '';
  position: absolute;
  top: 12px;
  left: 8px;
  width: 13px;
  border-top: 1px solid var(--gd-color-border, #e5e7eb);
}
.wf-agent--clickable {
  cursor: pointer;
}
.wf-agent--clickable:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.wf-agent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wf-agent-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--gd-color-text);
}
.wf-agent-sub {
  margin: 1px 0 0 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--gd-color-text-gray);
}
</style>
