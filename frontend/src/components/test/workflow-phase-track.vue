<template>
  <!-- 工作流阶段站条演示页（dev-only，路由 /wf-track-test）：
       不开真实工作流——用定时器模拟 run-start → agent-start/end → run-end 事件序列，
       逐条喂给真实 reducer（applyWorkflowEvent）折出 WorkflowRunState，
       再走真实投影（buildPhaseTrackModel）+ 真实组件（WorkflowPhaseTrack）渲染。
       与线上内联卡片的数据链路逐环相同，只是事件源从 SSE 换成定时器。 -->
  <div class="demo-page">
    <h1 class="demo-title">工作流阶段站条 · 演示</h1>

    <div class="demo-controls">
      <button class="demo-btn" @click="replay">▶ 重播</button>
      <button class="demo-btn" @click="togglePlay">{{ playing ? "⏸ 暂停" : "⏵ 继续" }}</button>
      <button class="demo-btn" @click="jumpEnd">⏭ 跳到终态</button>
      <label class="demo-check">
        <input v-model="showFlatFallback" type="checkbox" /> 对照：扁平树兜底（无 phases）
      </label>
      <label class="demo-check">
        <input v-model="darkMode" type="checkbox" /> 暗色主题
      </label>
      容器宽度
      <input v-model.number="containerWidth" type="range" min="280" max="960" step="20" class="demo-range" />
      <span class="demo-width">{{ containerWidth }}px</span>
    </div>

    <div class="demo-cards" :class="{ 'is-dark': darkMode }">
      <!-- 分阶段卡：与线上 WorkflowRunInlineCard 同构的最小卡壳 -->
      <div class="demo-card" :style="{ maxWidth: `${containerWidth}px` }">
        <div class="demo-card-head">
          <WorkflowStatusDot :status="runStatusDot" />
          <span class="demo-card-name">调研报告工作流</span>
          <span class="demo-card-meta">{{ metaText }}</span>
        </div>
        <div class="demo-card-body">
          <WorkflowPhaseTrack :model="trackModel" @open="onOpen" />
        </div>
      </div>

      <!-- 对照组：旧脚本无 phases 声明时的线上形态（扁平成员树兜底） -->
      <div v-if="showFlatFallback" class="demo-card" :style="{ maxWidth: `${containerWidth}px` }">
        <div class="demo-card-head">
          <WorkflowStatusDot :status="runStatusDot" />
          <span class="demo-card-name">旧脚本（无 phases）</span>
          <span class="demo-card-meta">对照：扁平树兜底</span>
        </div>
        <div class="demo-card-body">
          <WorkflowMemberTree :agents="runState.agents" :can-open="false" />
        </div>
      </div>
    </div>

    <div class="demo-eventlog">
      <div class="demo-eventlog-title">
        事件流（已应用 {{ appliedCount }} / {{ eventLog.length }}）
      </div>
      <div
        v-for="(line, i) in eventLog"
        :key="i"
        class="demo-eventlog-line"
        :class="{ 'is-pending': i >= appliedCount }"
      >
        #{{ i + 1 }} {{ line }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import WorkflowStatusDot from "@/components/chat/workflow/WorkflowStatusDot.vue";
import WorkflowPhaseTrack from "@/components/chat/workflow/WorkflowPhaseTrack.vue";
import WorkflowMemberTree from "@/components/chat/workflow/WorkflowMemberTree.vue";
import { buildPhaseTrackModel } from "@/components/chat/workflow/phaseTrack";
import { applyWorkflowEvent } from "@/services/modules/workflowRuns";
import type { WorkflowEventData, WorkflowMemberStatus, WorkflowRunState } from "@/types/stream/workflow.types";

// ── 模拟事件脚本：run-start 声明 4 阶段 → 各阶段成员 start/end（含隐式站与超钉住数）→ run-end ──
const BASE = 1700000000000;
type ScriptEvent = WorkflowEventData & { desc: string };
const ev = (seq: number, kind: WorkflowEventData["kind"], payload: unknown, desc: string): ScriptEvent =>
  ({ runId: "demo", seq, kind, time: BASE + seq * 1000, payload, desc } as ScriptEvent);

const script: ScriptEvent[] = [
  ev(1, "run-start", { name: "调研报告", description: "四阶段编排演示", phases: [
    { title: "情报", detail: "收集背景资料" },
    { title: "分析", detail: "交叉验证" },
    { title: "撰写" },
    { title: "审阅" },
  ] }, "run-start · 声明 4 阶段"),
  ev(2, "agent-start", { callId: "a1", label: "情报员", phase: "情报", subSessionId: "sub-a1" }, "情报 → 情报员启动"),
  ev(3, "agent-end", { callId: "a1", label: "情报员", phase: "情报", status: "completed", outputSummary: "背景资料 12 篇已归档" }, "情报 → 情报员完成"),
  ev(4, "agent-start", { callId: "b1", label: "研究员甲", phase: "分析", subSessionId: "sub-b1" }, "分析 → 研究员甲启动"),
  ev(5, "agent-start", { callId: "b2", label: "研究员乙", phase: "分析", subSessionId: "sub-b2" }, "分析 → 研究员乙启动"),
  ev(6, "agent-start", { callId: "b3", label: "研究员丙", phase: "分析", subSessionId: "sub-b3" }, "分析 → 研究员丙启动"),
  ev(7, "agent-end", { callId: "b1", label: "研究员甲", phase: "分析", status: "completed", outputSummary: "论点 A 成立" }, "分析 → 研究员甲完成"),
  ev(8, "agent-end", { callId: "b2", label: "研究员乙", phase: "分析", status: "completed", outputSummary: "论点 B 待复核" }, "分析 → 研究员乙完成"),
  ev(9, "agent-end", { callId: "b3", label: "研究员丙", phase: "分析", status: "failed" }, "分析 → 研究员丙失败"),
  ev(10, "agent-start", { callId: "c1", label: "撰写员", phase: "撰写" }, "撰写 → 撰写员启动"),
  ev(11, "agent-start", { callId: "c2", label: "校对员", phase: "撰写" }, "撰写 → 校对员启动"),
  ev(12, "agent-end", { callId: "c1", label: "撰写员", phase: "撰写", status: "completed", outputSummary: "初稿 v1 完成" }, "撰写 → 撰写员完成"),
  ev(13, "agent-end", { callId: "c2", label: "校对员", phase: "撰写", status: "completed", outputSummary: "校对通过" }, "撰写 → 校对员完成"),
  ev(14, "agent-start", { callId: "d1", label: "审阅官", phase: "审阅", subSessionId: "sub-d1" }, "审阅 → 审阅官启动"),
  // 隐式站：phase 不在声明内 → 尾部「其他」站
  ev(15, "agent-start", { callId: "x1", label: "机动支援", phase: "跑腿" }, "phase=跑腿 → 隐式「其他」站"),
  ev(16, "agent-end", { callId: "x1", label: "机动支援", phase: "跑腿", status: "completed" }, "其他 → 机动支援完成"),
  ev(17, "agent-end", { callId: "d1", label: "审阅官", phase: "审阅", status: "completed", outputSummary: "结论：可发布" }, "审阅 → 审阅官完成"),
  ev(18, "run-end", { runStatus: "completed", agentCount: 8, durationMs: 86000 }, "run-end · completed"),
];

// ── 播放器：定时器逐条 applyWorkflowEvent（与线上 store 同一 reducer）──
const runState = ref<WorkflowRunState>({
  runId: "demo",
  name: "调研报告",
  status: "running",
  agents: [],
  logs: [],
  startedAt: BASE,
  lastSeq: 0,
});
const playing = ref(false);
const appliedCount = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

/** 每步的驻留时间：agent-start 后停久一点，让脉冲/march 被看见 */
function stepDelay(next: WorkflowEventData): number {
  if (next.kind === "agent-start") return 1600;
  if (next.kind === "agent-end") return 700;
  return 1200;
}

function tick(): void {
  if (appliedCount.value >= script.length) {
    stop();
    return;
  }
  const event = script[appliedCount.value];
  applyWorkflowEvent([runState.value], event);
  appliedCount.value += 1;
  scheduleNext();
}

function scheduleNext(): void {
  stopTimer();
  if (!playing.value) return;
  const next = script[appliedCount.value];
  if (!next) return;
  timer = setTimeout(tick, stepDelay(next));
}

function stopTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}

function stop(): void {
  playing.value = false;
  stopTimer();
}

function togglePlay(): void {
  if (appliedCount.value >= script.length) replay();
  playing.value = !playing.value;
  if (playing.value) scheduleNext();
  else stopTimer();
}

function replay(): void {
  stop();
  runState.value = {
    runId: "demo",
    name: "调研报告",
    status: "running",
    agents: [],
    logs: [],
    startedAt: BASE,
    lastSeq: 0,
  };
  appliedCount.value = 0;
  playing.value = true;
  scheduleNext();
}

function jumpEnd(): void {
  stop();
  for (const event of script.slice(appliedCount.value)) applyWorkflowEvent([runState.value], event);
  appliedCount.value = script.length;
}

onMounted(replay);
onBeforeUnmount(stopTimer);

// ── 与线上卡片相同的消费侧 computed ──
const trackModel = computed(() => buildPhaseTrackModel(
  runState.value.phases,
  runState.value.agents,
  runState.value.status,
));
const runStatusDot = computed<WorkflowMemberStatus>(() => runState.value.status);
const metaText = computed(() => {
  const model = trackModel.value;
  if (!model) return `${runState.value.agents.length} 名成员`;
  if (model.activeIndex !== undefined) {
    const settled = model.stations.reduce((n, s) => n + s.settled, 0);
    const observed = model.stations.reduce((n, s) => n + s.observed, 0);
    return `第 ${model.activeIndex + 1}/${model.stations.length} 阶段 · ${settled}/${observed}`;
  }
  return runState.value.durationMs ? `${Math.round(runState.value.durationMs / 1000)}s` : "已完成";
});

const eventLog = computed(() => script.map((e) => e.desc));
const showFlatFallback = ref(true);
const darkMode = ref(false);
const containerWidth = ref(720);

function onOpen(subSessionId: string): void {
  console.log("[demo] 打开子代理会话:", subSessionId);
}
</script>

<style scoped>
.demo-page {
  min-height: 100vh;
  padding: 24px;
  background: var(--gd-color-sidebar-bg, #f5f6f8);
  font-family: system-ui, sans-serif;
}
.demo-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--gd-color-text);
}
.demo-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--gd-color-text-gray);
}
.demo-btn {
  padding: 4px 12px;
  border: 1px solid var(--gd-color-border, rgba(0, 0, 0, 0.1));
  border-radius: 6px;
  background: var(--gd-color-surface, #fff);
  color: var(--gd-color-text);
  cursor: pointer;
  font-size: 12px;
}
.demo-btn:hover {
  background: var(--gd-color-surface-hover, #ececf0);
}
.demo-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.demo-range {
  width: 140px;
}
.demo-width {
  font-family: var(--font-mono, monospace);
  color: var(--gd-color-text-disabled);
}

.demo-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}
/* 暗色对照：局部覆盖演示卡片底色（真实主题切换由 html[data-theme] 管，这里只做快速目检） */
.demo-cards.is-dark .demo-card {
  background: #1f2128;
  border-color: rgba(255, 255, 255, 0.12);
}
.demo-cards.is-dark .demo-card-name,
.demo-cards.is-dark .demo-card-meta {
  color: #e6e6ea;
}
.demo-card {
  border: 1px solid var(--gd-color-surface-border, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  overflow: hidden;
  background: var(--gd-color-surface, #fff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: max-width 0.2s ease;
}
.demo-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 34px;
}
.demo-card-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--gd-color-text);
}
.demo-card-meta {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}
.demo-card-body {
  padding: 2px 10px 8px;
}

.demo-eventlog {
  padding: 10px 12px;
  border: 1px dashed var(--gd-color-border, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  max-width: 720px;
}
.demo-eventlog-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--gd-color-text-gray);
}
.demo-eventlog-line {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 18px;
  color: var(--gd-color-text);
}
.demo-eventlog-line.is-pending {
  color: var(--gd-color-text-disabled);
  opacity: 0.6;
}
</style>
