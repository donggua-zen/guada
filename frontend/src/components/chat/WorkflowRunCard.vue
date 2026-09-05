<template>
  <div class="workflow-card w-full py-1.5">
    <div class="workflow-card__panel">
      <!-- Run 行：状态点 + 名称 + 状态 + 成员数 -->
      <button type="button" class="workflow-card__run-row" @click="toggleRun">
        <span class="workflow-card__dot" :class="dotClass(runStatus)"></span>
        <span class="workflow-card__run-name">{{ state.name || t('chat.workflow.defaultName') }}</span>
        <span v-if="durationText" class="workflow-card__run-duration">{{ durationText }}</span>
        <span class="workflow-card__run-status" :class="statusTextClass(runStatus)">{{ statusText(runStatus) }}</span>
        <span class="workflow-card__run-count">{{ t('chat.workflow.memberCount', { count: state.agents.length }) }}</span>
        <el-icon size="12" class="workflow-card__chevron" :class="{ 'is-expanded': runExpanded }">
          <ChevronDown12Regular />
        </el-icon>
      </button>

      <!-- Phase → member 两层 -->
      <div v-if="runExpanded" class="workflow-card__body">
        <div v-for="group in phaseGroups" :key="group.key" class="workflow-card__phase">
          <!-- Phase 行（仅当有标题时显示；未分组成员直接列出） -->
          <button v-if="group.title" type="button" class="workflow-card__phase-row"
            @click.stop="togglePhase(group.key)">
            <span class="workflow-card__phase-title">{{ group.title }}</span>
            <span class="workflow-card__phase-summary">{{ phaseSummary(group) }}</span>
            <el-icon size="11" class="workflow-card__chevron"
              :class="{ 'is-expanded': isPhaseOpen(group) }">
              <ChevronDown12Regular />
            </el-icon>
          </button>

          <!-- Member 行 -->
          <div v-if="!group.title || isPhaseOpen(group)" class="workflow-card__members">
            <div v-for="agent in group.agents" :key="agent.callId" class="workflow-card__member">
              <div class="workflow-card__member-row">
                <span class="workflow-card__dot workflow-card__dot--member" :class="dotClass(agent.status)"></span>
                <span class="workflow-card__member-label" :title="agent.label">{{ agent.label }}</span>
                <span v-if="agent.status === 'running' && agent.subSessionId" class="workflow-card__member-link"
                  @click.stop="openSession(agent.subSessionId)">
                  {{ t('chat.workflow.viewSession') }}
                </span>
                <span class="workflow-card__member-status" :class="statusTextClass(agent.status)">
                  {{ statusText(agent.status) }}
                </span>
                <button v-if="agent.outputSummary" type="button" class="workflow-card__member-toggle"
                  @click.stop="toggleOutput(agent.callId)">
                  <el-icon size="11" class="workflow-card__chevron"
                    :class="{ 'is-expanded': isOutputOpen(agent.callId) }">
                    <ChevronDown12Regular />
                  </el-icon>
                </button>
              </div>
              <!-- 输出摘要（agent-end 携带，截断 200 字） -->
              <div v-if="agent.outputSummary && isOutputOpen(agent.callId)" class="workflow-card__member-output">
                {{ agent.outputSummary }}
              </div>
            </div>
          </div>
        </div>

        <!-- 失败错误信息 -->
        <div v-if="runStatus === 'failed' && state.errorMessage" class="workflow-card__error">
          [{{ state.errorCode }}] {{ state.errorMessage }}
        </div>

        <!-- 进度日志（折叠） -->
        <div v-if="state.logs.length > 0" class="workflow-card__logs">
          <button type="button" class="workflow-card__logs-toggle" @click="logsExpanded = !logsExpanded">
            {{ logsExpanded ? t('chat.workflow.collapseLogs') : t('chat.workflow.viewLogs', { count: state.logs.length }) }}
          </button>
          <div v-if="logsExpanded" class="workflow-card__logs-body">
            <div v-for="(line, i) in state.logs" :key="i" class="workflow-card__log-line">{{ line }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown12Regular } from "@vicons/fluent";
import type {
  WorkflowAgentState,
  WorkflowRunState,
  WorkflowRunStatus,
  WorkflowMemberStatus,
} from "@/types/stream/workflow.types";

const props = defineProps<{
  /** run 卡片状态（streamProjector reducer 从 live/回放事件流累积） */
  state: WorkflowRunState;
}>();

/** ChatPage provide：切换到子代理 Tab（仅运行中且 Tab 已知时可点，对齐 DSH live-only 导航） */
const openSubAgentSession = inject<(subSessionId: string) => void>(
  "workflow:openSubAgentSession",
  () => {},
);

const { t } = useI18n();

// ── run 层展开（对齐 DSH：运行中/异常自动展开，完成自动收起；手动切换后以手动为准） ──
const runExpanded = ref(props.state.status !== "completed");
const runManual = ref(false);
watch(
  () => props.state.status,
  (s) => {
    if (runManual.value) return;
    runExpanded.value = s !== "completed";
  },
);
function toggleRun() {
  runManual.value = true;
  runExpanded.value = !runExpanded.value;
}

// ── phase 层展开（有未完成成员默认展开，全完成收起；按 key 手动覆盖） ──
const phaseOverrides = reactive<Record<string, boolean>>({});
function isPhaseOpen(group: PhaseGroup): boolean {
  return (
    phaseOverrides[group.key] ??
    group.agents.some((a) => a.status !== "completed")
  );
}
function togglePhase(key: string) {
  phaseOverrides[key] = !(phaseOverrides[key] ?? true);
}

// ── member 输出摘要展开 ──
const outputOpen = reactive<Record<string, boolean>>({});
function isOutputOpen(callId: string): boolean {
  return !!outputOpen[callId];
}
function toggleOutput(callId: string) {
  outputOpen[callId] = !outputOpen[callId];
}

const logsExpanded = ref(false);

// ── phase 分组：声明 phases 顺序优先，动态 phase 按首次出现补位；空组不显示（对齐 DSH）──
interface PhaseGroup {
  key: string;
  title: string | null;
  agents: WorkflowAgentState[];
}
const UNASSIGNED = "__unassigned__";
const phaseGroups = computed<PhaseGroup[]>(() => {
  const byPhase = new Map<string, WorkflowAgentState[]>();
  for (const a of props.state.agents) {
    const key = a.phase?.trim() || UNASSIGNED;
    const list = byPhase.get(key);
    if (list) list.push(a);
    else byPhase.set(key, [a]);
  }
  const groups: PhaseGroup[] = [];
  for (const p of props.state.phases ?? []) {
    const agents = byPhase.get(p.title);
    if (agents && agents.length > 0) {
      groups.push({ key: p.title, title: p.title, agents });
    }
  }
  for (const [key, agents] of byPhase) {
    if (props.state.phases?.some((p) => p.title === key)) continue;
    groups.push({ key, title: key === UNASSIGNED ? null : key, agents });
  }
  return groups;
});

/** phase 聚合状态尾巴（如 "3 完成 · 1 运行中"） */
function phaseSummary(group: PhaseGroup): string {
  const counts = new Map<WorkflowMemberStatus, number>();
  for (const a of group.agents) {
    counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  }
  const order: WorkflowMemberStatus[] = ["completed", "running", "failed", "cancelled"];
  const parts: string[] = [];
  for (const s of order) {
    const n = counts.get(s) ?? 0;
    if (n > 0) parts.push(t(`chat.workflow.count.${s}`, { count: n }));
  }
  return parts.join(" · ");
}

const runStatus = computed(() => props.state.status);

const durationText = computed(() => {
  const ms = props.state.durationMs;
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
});

function dotClass(status: WorkflowRunStatus | WorkflowMemberStatus): string {
  switch (status) {
    case "running": return "is-running";
    case "completed": return "is-completed";
    case "failed": return "is-failed";
    case "cancelled": return "is-cancelled";
    default: return "";
  }
}

function statusText(status: WorkflowRunStatus | WorkflowMemberStatus): string {
  const map: Record<string, string> = {
    running: "running",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
  };
  return t(`chat.workflow.status.${map[status] ?? status}`);
}

function statusTextClass(status: WorkflowRunStatus | WorkflowMemberStatus): string {
  switch (status) {
    case "running": return "text-blue-500 dark:text-blue-400";
    case "completed": return "text-emerald-600 dark:text-emerald-400";
    case "failed": return "text-red-500 dark:text-red-400";
    case "cancelled": return "text-gray-400 dark:text-gray-500";
    default: return "";
  }
}

function openSession(subSessionId: string) {
  openSubAgentSession(subSessionId);
}
</script>

<style scoped>
@reference "tailwindcss";

.workflow-card__panel {
  @apply rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/30 overflow-hidden;
}

.workflow-card__run-row {
  @apply w-full flex items-center gap-2 px-3 py-2 text-left select-none
    hover:bg-gray-100/60 dark:hover:bg-gray-800/40 transition-colors;
}

.workflow-card__dot {
  @apply w-2 h-2 rounded-full shrink-0;
}
.workflow-card__dot--member {
  @apply w-1.5 h-1.5;
}
.workflow-card__dot.is-running {
  @apply bg-blue-500 animate-pulse;
}
.workflow-card__dot.is-completed {
  @apply bg-emerald-500;
}
.workflow-card__dot.is-failed {
  @apply bg-red-500;
}
.workflow-card__dot.is-cancelled {
  @apply bg-gray-400;
}

.workflow-card__run-name {
  @apply text-sm font-medium text-gray-700 dark:text-gray-200 truncate;
}

.workflow-card__run-duration {
  @apply text-xs text-gray-400 dark:text-gray-500 shrink-0;
}

.workflow-card__run-status {
  @apply text-xs shrink-0;
}

.workflow-card__run-count {
  @apply text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-auto;
}

.workflow-card__chevron {
  @apply shrink-0 text-gray-400 transition-transform duration-150;
}
.workflow-card__chevron.is-expanded {
  transform: rotate(0deg);
}
.workflow-card__chevron:not(.is-expanded) {
  transform: rotate(-90deg);
}

.workflow-card__body {
  @apply px-3 pb-2 pt-0.5 space-y-1.5 border-t border-gray-200/50 dark:border-gray-700/50;
}

.workflow-card__phase-row {
  @apply w-full flex items-center gap-2 py-1.5 text-left select-none
    hover:bg-gray-100/40 dark:hover:bg-gray-800/30 rounded transition-colors;
}

.workflow-card__phase-title {
  @apply text-xs font-medium text-gray-500 dark:text-gray-400 truncate;
}

.workflow-card__phase-summary {
  @apply text-[11px] text-gray-400 dark:text-gray-500 ml-auto shrink-0;
}

.workflow-card__members {
  @apply space-y-0.5 pl-3;
}

.workflow-card__member-row {
  @apply flex items-center gap-2 py-0.5;
}

.workflow-card__member-label {
  @apply text-xs text-gray-600 dark:text-gray-300 truncate;
}

.workflow-card__member-link {
  @apply text-[11px] text-blue-500 dark:text-blue-400 hover:underline cursor-pointer shrink-0;
}

.workflow-card__member-status {
  @apply text-[11px] shrink-0 ml-auto;
}

.workflow-card__member-toggle {
  @apply shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300;
}

.workflow-card__member-output {
  @apply ml-4 mt-0.5 mb-1 rounded bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60
    px-2 py-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words;
}

.workflow-card__error {
  @apply rounded bg-red-500/5 border border-red-500/20 px-2 py-1.5 text-[11px] text-red-500 dark:text-red-400
    whitespace-pre-wrap break-words;
}

.workflow-card__logs-toggle {
  @apply text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:underline;
}

.workflow-card__logs-body {
  @apply mt-1 rounded bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60
    px-2 py-1.5 max-h-40 overflow-y-auto;
}

.workflow-card__log-line {
  @apply text-[11px] text-gray-500 dark:text-gray-400 font-mono whitespace-pre-wrap break-words leading-relaxed;
}
</style>
