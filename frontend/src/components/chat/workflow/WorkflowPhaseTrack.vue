<template>
  <!-- 阶段站条：一根横向轨道，阶段是轨道上的站；**每一站下方挂自己的成员药丸列**
       （全部阶段的子代理同时可见、对齐到各自的站——站内纵向堆叠，最多钉 5 枚 + 「还有 n 个」行）。
       状态灯形变：空环=未到 / 脉冲=进行中 / 实点=完成 / 红=失败（WorkflowStatusDot）。
       轨道墨色三态：faint=未到 / strong=走过 / march=正在流入当前站（background-position 流动）。
       药丸 30ms 逐枚落地（对角序：(站序+列内序)×30，已有药丸延迟值恒定不重播）；
       全部只动 opacity/transform + background-position，reduced-motion 下停用。
       model 为 null 时不渲染（宿主回退 WorkflowMemberTree 扁平树）。 -->
  <div v-if="model" class="wf-track-wrap" @pointerenter="sbHover = true" @pointerleave="sbHover = false">
    <!-- 溢出分页箭头：桌面鼠标没有触摸滑动、原生滚动条又已隐藏——
         溢出侧常驻一枚箭头作为可见的滚动入口（点击翻一站），触摸端仍可原生滑动。
         滚到头的一侧箭头消失（与渐隐遮罩同一份 edgeFade 状态）。 -->
    <button v-if="edgeFade.left" class="wf-track-nav is-left" :aria-label="t('chat.workspace.wfPhasePrev')"
      @click="page(-1)">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
    <div ref="trackEl" class="wf-track" :style="trackMask">
      <div class="wf-track-inner">
        <div v-for="(station, i) in model.stations" :key="station.title || '__other__'" class="wf-col">
          <div class="wf-col-head">
            <span class="wf-col-rail" :class="railClass(i)" aria-hidden="true"></span>
            <WorkflowStatusDot :status="dotStatus(station.status)" class="wf-col-lamp" />
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
            <!-- 超出钉住数的成员只给计数行（「还有 n 个」名册行） -->
            <span v-if="station.agents.length > ROSTER_PINS" class="wf-pill is-more">
              {{ t("chat.workspace.wfPhaseMore", { count: station.agents.length - ROSTER_PINS }) }}
            </span>
          </div>
        </div>
      </div>
      <!-- 自绘横向滚动条：原生条隐藏后这是
           PC 上拖拽预览全貌的入口——2px 轨道 + 滑块（按视口比例缩放），拖拽 1:1 映射手势；
           空闲 800ms 自动淡出，hover 卡片/拖拽/滚动时重现。 -->
      <div
        v-if="sbVisible"
        class="wf-sb"
        role="scrollbar"
        aria-orientation="horizontal"
        :aria-valuenow="sbThumb ? Math.round((100 * sbThumb.left) / Math.max(1, sbMax - sbClient)) : 0"
        :aria-valuemin="0"
        :aria-valuemax="100"
        @pointerdown.self="onTrackDown"
      >
        <span
          class="wf-sb-thumb"
          :class="{ 'is-drag': sbDrag }"
          :style="sbThumb ? { left: `${sbThumb.left}px`, width: `${sbThumb.width}px` } : undefined"
          @pointerdown="onThumbDown"
          @pointermove="onThumbMove"
          @pointerup="onThumbUp"
          @pointercancel="onThumbUp"
        ></span>
      </div>
    </div>
    <button v-if="edgeFade.right" class="wf-track-nav is-right" :aria-label="t('chat.workspace.wfPhaseNext')"
      @click="page(1)">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
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

/** 每站钉住的药丸数（超出出「还有 n 个」行） */
const ROSTER_PINS = 5;
/** 药丸逐枚落地间隔 */
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
// behavior 用 auto：smooth 依赖帧调度，IAB 渲染层不排帧时永不落盘（rAF 冻结同源）。
watch(
  () => props.model?.activeIndex,
  async (index) => {
    if (index === undefined) return;
    await nextTick();
    const el = trackEl.value;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const cols = el.querySelectorAll<HTMLElement>(".wf-col");
    cols[index]?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
  },
);

// ── 移动端两侧渐隐：滚到头一侧的遮罩取消（16ms setTimeout 节流，遮罩只动 mask 不动布局）──
// 监听以 trackEl 为依赖挂接：model 后到（v-if 晚一帧渲染）时 onMounted 里 el 还是 null，
// 以 mount 时机挂监听会永远接不上（滚动层晚一帧渲染，元素为依赖才接得上）。
// 节流不用 rAF：IAB/部分内嵌渲染层不排帧，rAF 回调可能永不执行（实测），setTimeout 恒可用。
const trackEl = ref<HTMLElement | null>(null);
const edgeFade = ref<{ left: boolean; right: boolean }>({ left: false, right: false });
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
function updateEdgeFade(): void {
  if (fadeTimer !== null) return;
  fadeTimer = setTimeout(() => {
    fadeTimer = null;
    const el = trackEl.value;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    edgeFade.value = {
      left: el.scrollLeft > 2,
      right: el.scrollLeft < max - 2,
    };
    // 同一份测量喂滚动条几何（避免第二个测量点口径漂移）
    sbClient.value = el.clientWidth;
    sbMax.value = max;
    sbLeft.value = el.scrollLeft;
    markScrolling();
  }, 16);
}

// ── 自绘滚动条（2px 轨道 + 滑块 + 800ms 空闲淡出）──
const SCROLLING_MS = 800;
const sbClient = ref(0);
const sbMax = ref(0);
const sbLeft = ref(0);
const sbDrag = ref(false);
const sbHover = ref(false);
const sbScrolling = ref(false);
let scrollFadeTimer: ReturnType<typeof setTimeout> | null = null;

/** 溢出才有条；滑块宽 = 视口/内容比例 × 轨道宽，最小可抓握 24px */
const sbThumb = computed(() => {
  if (sbClient.value <= 0 || sbMax.value <= 0) return null;
  const trackW = sbClient.value;
  const ratio = trackW / (sbMax.value + trackW);
  const width = Math.max(24, Math.round(trackW * ratio));
  const left = Math.round((sbLeft.value / sbMax.value) * (trackW - width));
  return { left, width };
});
const sbVisible = computed(() => sbThumb.value !== null && (sbHover.value || sbDrag.value || sbScrolling.value));

function markScrolling(): void {
  sbScrolling.value = true;
  if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
  scrollFadeTimer = setTimeout(() => {
    sbScrolling.value = false;
    scrollFadeTimer = null;
  }, SCROLLING_MS);
}

function onTrackDown(event: PointerEvent): void {
  const el = trackEl.value;
  if (!el || !sbThumb.value) return;
  const rect = el.getBoundingClientRect();
  // 点轨道空白：朝点击方向翻一屏
  const direction = event.clientX - rect.left < sbThumb.value.left ? -1 : 1;
  el.scrollBy({ left: direction * el.clientWidth, behavior: "auto" });
}

const sbDragState = { pointerId: -1, startX: 0, startLeft: 0 };
function onThumbDown(event: PointerEvent): void {
  const el = trackEl.value;
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  sbDragState.pointerId = event.pointerId;
  sbDragState.startX = event.clientX;
  sbDragState.startLeft = el.scrollLeft;
  sbDrag.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function onThumbMove(event: PointerEvent): void {
  const el = trackEl.value;
  if (!el || !sbDrag.value || !sbThumb.value || event.pointerId !== sbDragState.pointerId) return;
  // 手势 1px = 内容 ratio px（滑块缩放比的倒数）
  const ratio = (sbMax.value + sbClient.value) / sbClient.value;
  el.scrollLeft = sbDragState.startLeft + (event.clientX - sbDragState.startX) * ratio;
}
function onThumbUp(event: PointerEvent): void {
  if (event.pointerId !== sbDragState.pointerId) return;
  sbDragState.pointerId = -1;
  sbDrag.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}

onBeforeUnmount(() => {
  if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
});
function stopFadeListener(): void {
  trackEl.value?.removeEventListener("scroll", updateEdgeFade);
  if (fadeTimer !== null) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
}
watch(trackEl, (el, prev) => {
  prev?.removeEventListener("scroll", updateEdgeFade);
  stopFadeListener();
  if (el) {
    el.addEventListener("scroll", updateEdgeFade, { passive: true });
    updateEdgeFade();
  }
});
onBeforeUnmount(stopFadeListener);
/** 单层渐变遮罩：有溢出的那侧 12px 渐隐，提示横向还有内容 */
const trackMask = computed(() => {
  const { left, right } = edgeFade.value;
  if (!left && !right) return undefined;
  const stops: string[] = [];
  stops.push(left ? "transparent 0, #000 12px" : "#000 0");
  if (right) stops.push(`#000 calc(100% - 12px), transparent 100%`);
  return { maskImage: `linear-gradient(90deg, ${stops.join(", ")})`, WebkitMaskImage: `linear-gradient(90deg, ${stops.join(", ")})` };
});

/** 分页翻站：按站距步进。
 *  behavior 用 auto：smooth 依赖帧调度，IAB/部分内嵌渲染层不排帧时 smooth 永不落盘（实测），
 *  离散翻页本来也不需要动画。 */
function page(dir: 1 | -1): void {
  const el = trackEl.value;
  if (!el) return;
  const step = (el.querySelector<HTMLElement>(".wf-col")?.offsetWidth ?? 148) + 16;
  el.scrollBy({ left: dir * step, behavior: "auto" });
}
</script>

<style scoped>
/* 外层包壳：承载左右分页箭头与底部滚动条槽位（固定 6px 呼吸带，
   滚动条画在带内不与胶囊相顶；v-if 卸载时高度不变） */
.wf-track-wrap {
  position: relative;
  margin: 2px 0 0;
  padding-bottom: 6px;
  min-width: 0;
}
/* 几何常量：固定站宽 + 固定站距，灯距恒定。
   站宽 STATION_W、站距 GAP_PX，灯心 = 左缘 + LAMP_X。
   轨道段从「上一站灯心」精确画到「本站灯心」——墨色分界落在灯上，不落在列边界上。 */
.wf-track {
  --station-w: 148px;
  --station-gap: 16px;
  --lamp-x: 11px; /* 灯心：外边距 8 + 灯半径 3 */
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  /* 移动端：滚动内容可能被裁切边截断，两侧留出呼吸 + 触控余量；
     scroll-padding 让镜头跟随 scrollIntoView 后站名不贴边 */
  scroll-padding-inline: 12px;
}
.wf-track::-webkit-scrollbar {
  display: none;
}
/* 溢出分页箭头（可见的滚动入口）：14px 圆钮贴在卡片左右内缘、垂直居中于轨道行 */
.wf-track-nav {
  position: absolute;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--gd-color-border, rgba(0, 0, 0, 0.12));
  border-radius: 50%;
  background: var(--gd-color-surface, #fff);
  color: var(--gd-color-text-gray);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.wf-track-nav:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-surface-hover);
}
.wf-track-nav.is-left {
  left: 0;
}
.wf-track-nav.is-right {
  right: 0;
}

/* 自绘横向滚动条：2px 轨道贴底（滑块 hover/拖拽加粗到 4px），空闲淡出。
   槽位化：wrap 底部固定留 6px 呼吸带（padding-bottom），滚动条画在带内——
   不与胶囊相顶（截图反馈），隐藏时只淡 opacity、布局零跳动 */
.wf-sb {
  position: absolute;
  inset-inline: 4px;
  bottom: 1px;
  height: 4px;
  display: flex;
  align-items: center;
  border-radius: 2px;
  background: var(--gd-color-surface, rgba(128, 128, 128, 0.14));
  cursor: pointer;
  animation: wf-sb-in var(--gd-wf-t-base) var(--gd-wf-ease);
}
@keyframes wf-sb-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.wf-sb-thumb {
  position: absolute;
  height: 2px;
  border-radius: 1px;
  background: var(--gd-color-text-disabled);
  transition: height var(--gd-wf-t-fast) var(--gd-wf-ease);
  touch-action: none;
}
.wf-sb:hover .wf-sb-thumb,
.wf-sb-thumb.is-drag {
  height: 4px;
  background: var(--gd-color-text-gray);
}
/* 触控目标：桌面 hover 有卡片壳辅助，移动端没有——药丸加高到 28px 触控最小可接受值 */
@media (pointer: coarse) {
  .wf-pill {
    padding: 5px 10px;
    font-size: 12px;
    line-height: 17px;
  }
  .wf-pill.is-more {
    padding: 4px 10px;
  }
  .wf-col-name {
    font-size: 12px;
    line-height: 17px;
  }
}
/* 固定站宽网格：站多时撑开、宿主横向滚动 + 镜头跟随 */
.wf-track-inner {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: calc(var(--station-w) + var(--station-gap));
  column-gap: 0;
  width: max-content;
  min-width: 100%;
  padding: 2px 4px 0;
}

.wf-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: var(--station-w);
  margin-right: var(--station-gap);
}

/* 轨道行：灯落在轨道上（灯心与药丸列左缘连成一条竖脊）；名字在轨道行下方 */
.wf-col-head {
  position: relative;
  height: 16px;
}
.wf-col-rail {
  position: absolute;
  top: 7px;
  /* 从上一站灯心画到本站灯心：左伸 = 站宽+站距-灯心距，全长 = 站宽+站距
     （相邻站的段在灯心处首尾相接，墨色分界精确落在灯上） */
  left: calc(-1 * (var(--station-w) + var(--station-gap) - var(--lamp-x)));
  width: calc(var(--station-w) + var(--station-gap));
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
  display: none; /* 首站没有入站段 */
}
.wf-col-rail.is-strong {
  /* 走过：实线 */
  background-image: none;
  background-color: var(--gd-color-text-disabled);
}
.wf-col-rail.is-march {
  /* 正在流入：行进虚线向右流动（background-position 递减 = 视觉向右） */
  background-image: repeating-linear-gradient(
    90deg,
    var(--gd-color-success, #22c55e) 0 4px,
    transparent 4px 8px
  );
  background-size: 16px 2px;
  animation: wf-track-march 0.6s linear infinite;
}
@keyframes wf-track-march {
  0% { background-position: 0 0; }
  100% { background-position: 16px 0; }
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
