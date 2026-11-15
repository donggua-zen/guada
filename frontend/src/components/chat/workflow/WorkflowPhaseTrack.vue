<template>
  <!-- 阶段站条（借鉴 zcode workflow-timeline 的几何语言）：
       一根横向轨道，阶段是轨道上的站；**每一站下方挂自己的成员药丸列**
       （全部阶段的子代理同时可见、对齐到各自的站——站内纵向堆叠，最多钉 5 枚 + 「还有 n 个」行）。
       状态灯形变：空环=未到 / 脉冲=进行中 / 实点=完成 / 红=失败（WorkflowStatusDot）。
       轨道墨色三态：faint=未到 / strong=走过 / march=正在流入当前站（background-position 流动）。
       药丸 30ms 逐枚落地（对角序：(站序+列内序)×30，已有药丸延迟值恒定不重播）；
       全部只动 opacity/transform + background-position，reduced-motion 下停用。
       model 为 null 时不渲染（宿主回退 WorkflowMemberTree 扁平树）。 -->
  <div v-if="model" ref="trackEl" class="wf-track">
    <div class="wf-track-inner">
      <div v-for="(station, i) in model.stations" :key="station.title || '__other__'" class="wf-col">
        <div class="wf-col-head">
          <span class="wf-col-rail" :class="railClass(i)" aria-hidden="true"></span>
          <WorkflowStatusDot :status="dotStatus(station.status)" size="sm" class="wf-col-lamp" />
        </div>
        <div class="wf-col-caption" :title="station.detail || station.title">
          <span class="wf-col-name" :class="{ 'is-active': station.status === 'active' }">
            {{ station.title || t("chat.workspace.wfPhaseOther") }}
          </span>
          <span v-if="station.observed > 0" class="wf-col-count">
            {{ t("chat.workspace.wfPhaseStationCount", { settled: station.settled, observed: station.observed }) }}
          </span>
        </div>
        <div v-if="station.agents.length" class="wf-col-pills">
          <button
            v-for="(agent, j) in pinnedAgents(station)"
            :key="agent.callId"
            class="wf-pill"
            :class="{ 'is-clickable': !!agent.subSessionId && !!openSubAgent }"
            :style="{ animationDelay: `${pillDelay(i, j)}ms` }"
            :title="agent.label"
            @click="onOpen(agent)"
          >
            <WorkflowStatusDot :status="agent.status" size="sm" />
            <span class="wf-pill-label">{{ agent.label }}</span>
          </button>
          <!-- 超出钉住数的成员只给计数行（借鉴 zcode 的「还有 n 个」名册行） -->
          <span v-if="station.agents.length > ROSTER_PINS" class="wf-pill is-more">
            {{ t("chat.workspace.wfPhaseMore", { count: station.agents.length - ROSTER_PINS }) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import WorkflowStatusDot from "./WorkflowStatusDot.vue";
import { PHASE_DOT, type PhaseStation, type PhaseStationStatus, type PhaseTrackModel } from "./phaseTrack";
import type { WorkflowAgentState, WorkflowMemberStatus } from "@/types/stream/workflow.types";

const props = defineProps<{
  /** 纯函数投影产物（buildPhaseTrackModel）；null 即无 phases 声明 → 不渲染 */
  model: PhaseTrackModel | null;
}>();

const emit = defineEmits<{ (e: "open", subSessionId: string): void }>();

const { t } = useI18n();

/** 每站钉住的药丸数（超出出「还有 n 个」行；借鉴 zcode ROSTER_PINS_CARD 的卡片站口径） */
const ROSTER_PINS = 5;
/** 药丸逐枚落地间隔（借鉴 zcode PILL_STAGGER_MS） */
const PILL_STAGGER_MS = 30;

/** 站状态 → WorkflowStatusDot 形态（词汇表 PHASE_DOT：active→running 等） */
function dotStatus(status: PhaseStationStatus): WorkflowMemberStatus {
  return PHASE_DOT[status] as WorkflowMemberStatus;
}

/** 入站轨道段墨色（列 i 的轨道 = 从 i-1 站流入 i 站的那一段）：
 *  行进中 march 流入当前站、strong 走过、faint 未到；终态后走到过的站之前都算 strong。 */
function railClass(index: number): string {
  const model = props.model;
  if (!model) return "is-faint";
  const active = model.activeIndex;
  if (active !== undefined) {
    return index === active ? "is-march" : index < active ? "is-strong" : "is-faint";
  }
  let last = -1;
  model.stations.forEach((s, i) => {
    if (s.status !== "pending") last = i;
  });
  return index <= last ? "is-strong" : "is-faint";
}

function pinnedAgents(station: PhaseStation): WorkflowAgentState[] {
  return station.agents.slice(0, ROSTER_PINS);
}

/** 落地延迟取对角序 (站序+列内序)：成员追加只新增更大序号，既有药丸的延迟值恒定、动画不重播 */
function pillDelay(stationIndex: number, localIndex: number): number {
  return Math.min((stationIndex + localIndex) * PILL_STAGGER_MS, 300);
}

function onOpen(agent: WorkflowAgentState): void {
  if (agent.subSessionId) emit("open", agent.subSessionId);
}

const openSubAgent = inject<((subSessionId: string) => void) | null>(
  "workspace:openSubAgentSession",
  null,
);

// ── 镜头跟随：active 站变化时把那一列滚进视野（仅横向溢出时才需要）──
const trackEl = ref<HTMLElement | null>(null);
watch(
  () => props.model?.activeIndex,
  async (index) => {
    if (index === undefined) return;
    await nextTick();
    const el = trackEl.value;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const cols = el.querySelectorAll<HTMLElement>(".wf-col");
    cols[index]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  },
);
</script>

<style scoped>
.wf-track {
  margin: 2px 0 0;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.wf-track::-webkit-scrollbar {
  display: none;
}
/* 站列网格：窄时均分撑满，站多时按最小站宽撑开（宿主横向滚动） */
.wf-track-inner {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(var(--wf-col-w, 128px), 1fr);
  column-gap: 12px;
  width: max-content;
  min-width: 100%;
  padding: 2px 4px 0;
}

.wf-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 轨道行：灯落在轨道上（灯心与药丸列左缘连成一条竖脊）；名字在轨道行下方，不被轨道线穿过 */
.wf-col-head {
  position: relative;
  height: 16px;
}
.wf-col-rail {
  position: absolute;
  top: 7px;
  left: -12px; /* 向左延伸进站距，与前一站的轨道连成一根 */
  right: 0;
  height: 2px;
  border-radius: 1px;
  /* 未到：淡虚线 */
  background-image: repeating-linear-gradient(
    90deg,
    var(--gd-color-border) 0 4px,
    transparent 4px 8px
  );
}
.wf-col:first-child .wf-col-rail {
  left: 11px; /* 首站轨道从灯心起（灯心 x = 左距 8 + 半径 3） */
}
.wf-col-rail.is-strong {
  /* 走过：实线 */
  background-image: none;
  background-color: var(--gd-color-text-disabled);
}
.wf-col-rail.is-march {
  /* 正在流入：行进虚线（background-position 流动 = march） */
  background-image: repeating-linear-gradient(
    90deg,
    var(--gd-color-success, #22c55e) 0 4px,
    transparent 4px 8px
  );
  background-size: 16px 2px;
  animation: wf-track-march 0.6s linear infinite;
}
@keyframes wf-track-march {
  0% { background-position: 16px 0; }
  100% { background-position: 0 0; }
}
.wf-col-lamp {
  position: absolute;
  left: 8px;
  top: 5px;
  z-index: 1;
}

.wf-col-caption {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 2px 0 0 8px;
  min-width: 0;
}
.wf-col-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-gray);
  transition: color var(--gd-wf-t-base) var(--gd-wf-ease);
}
.wf-col-name.is-active {
  color: var(--gd-color-text);
  font-weight: 500;
}
.wf-col-count {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 10px;
  line-height: 14px;
  color: var(--gd-color-text-disabled);
}

/* 成员药丸列：纵向堆叠，左缘与灯对齐 */
.wf-col-pills {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin: 4px 0 0 8px;
  min-width: 0;
  max-width: calc(100% - 8px);
}
.wf-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--gd-color-border, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  background: var(--gd-color-sidebar-bg, rgba(128, 128, 128, 0.06));
  cursor: default;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text);
  text-align: left;
}
.wf-pill.is-clickable {
  cursor: pointer;
}
.wf-pill.is-clickable:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.wf-pill.is-more {
  border-style: dashed;
  background: transparent;
  color: var(--gd-color-text-disabled);
}
.wf-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 逐枚落地（opacity+translateY；animationDelay 由内联样式给 stagger，backwards 等待期保持首帧） */
.wf-pill {
  animation: wf-track-pill-drop var(--gd-wf-t-ink) var(--gd-wf-ease) backwards;
}
@keyframes wf-track-pill-drop {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .wf-col-rail.is-march,
  .wf-pill {
    animation: none;
  }
}
</style>
