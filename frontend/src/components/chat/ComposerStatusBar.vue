<template>
  <!-- 输入区运行时状态胶囊（共享外壳）：单条 28px 药丸内分三段——待办 / 后台进程 / 子代理，
       任一段没有内容就整段不渲染，三段全空整根不渲染；hover 在上方弹出面板按域分段列细节。
       数据契约：待办（REST + todo_updated）、进程（jobs_snapshot + jobs REST 基线）、
       子代理（ChatPage 下传的 subSessions + sessionStore.streamStatus），各域逻辑见
       composables/useTodoStatus.ts、composables/useRunningProcesses.ts、utils/subagentDisplay.ts。
       已结束（冻结）子代理不在本胶囊表达（运行时状态专属），回放入口见子代理列表面板
       （workspace/SubagentListPanel.vue）。 -->
  <div v-if="hasAny" class="composer-status-bar" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <!-- 外壳：唯一一条药丸，段间以细竖线分隔（同形约定见 ChatPanel 的 .composer-status-row 注释） -->
    <div class="csb-capsule">
      <!-- ── 待办段 ── -->
      <span v-if="todoItems.length" class="csb-seg">
        <span class="csb-icon">
          <ArrowRight16Regular v-if="currentTodo?.status === 'in_progress'" class="w-3.5 h-3.5 csb-icon--active" />
          <Checkmark16Regular v-else-if="currentTodo?.status === 'completed'" class="w-3.5 h-3.5 csb-icon--done" />
          <span v-else class="csb-ring"></span>
        </span>
        <span class="csb-text" :title="currentTodo?.content">{{ currentTodo?.content }}</span>
        <span class="csb-count csb-count--done">{{ todoDoneCount }}/{{ todoItems.length }}</span>
      </span>

      <!-- ── 后台进程段：只出数量（接口只返回运行中进程）；
           图标取终端工具同款（TOOL_ICON_MAP 的 terminal → WindowConsole20Filled，
           与对话流里 run_command 工具行一致）——一眼可辨"这是后台命令"；
           命令等详情在 hover 面板里看（三段可能同时出现，文案会互相挤占宽度） ── -->
      <span v-if="processes.length" class="csb-seg">
        <span class="csb-icon">
          <WindowConsole20Filled class="w-3.5 h-3.5 csb-icon--muted" />
        </span>
        <span class="csb-count">{{ processes.length }}</span>
      </span>

      <!-- ── 子代理段：运行中/存活总数（分子=正在跑，分母=未关闭的活跃子代理；
           长期（persist）子代理可重复交互、不 close，只出"运行中"会让空闲期显示成孤零的 0；
           已结束（冻结）项不进本段，详情与回放在 hover 面板与列表面板） ── -->
      <span v-if="activeSubagents.length" class="csb-seg">
        <span class="csb-icon">
          <Bot20Regular class="w-3.5 h-3.5 csb-icon--muted" />
        </span>
        <span class="csb-count" :class="{ 'csb-count--live': runningSubagentCount > 0 }">
          {{ runningSubagentCount }}/{{ activeSubagents.length }}
        </span>
      </span>
    </div>

    <!-- 详情面板（hover 展开）：按域分段，空域不渲染 -->
    <Transition name="csb-panel">
      <div v-if="panelVisible" class="csb-panel">
        <div class="csb-panel-scroll">
          <!-- 待办 -->
          <section v-if="todoItems.length" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.workspace.todoList') }}</span>
              <span class="csb-sec-count">{{ todoDoneCount }}/{{ todoItems.length }}</span>
            </header>
            <div class="csb-list">
              <div v-for="(item, i) in todoItems" :key="i" class="csb-row">
                <span class="csb-icon">
                  <Checkmark16Regular v-if="item.status === 'completed'" class="w-3.5 h-3.5 csb-icon--done" />
                  <ArrowRight16Regular v-else-if="item.status === 'in_progress'" class="w-3.5 h-3.5 csb-icon--active" />
                  <span v-else class="csb-ring"></span>
                </span>
                <span class="csb-row-text" :class="item.status === 'completed'
                  ? 'csb-row-text--done'
                  : item.status === 'in_progress' ? 'csb-row-text--strong' : ''">
                  {{ item.content }}
                </span>
              </div>
            </div>
          </section>

          <!-- 后台进程：点击行开日志标签，行尾终止按钮 -->
          <section v-if="processes.length" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.workspace.processes') }}</span>
              <span class="csb-sec-count">{{ processes.length }}</span>
            </header>
            <div class="csb-list">
              <GdTooltip v-for="p in processes" :key="p.id" :content="p.label" placement="bottom">
                <div class="csb-row csb-row--clickable" @click="openProcessLog(p)">
                  <span class="csb-icon"><span class="csb-spinner"></span></span>
                  <span class="csb-row-text csb-row-text--cmd">{{ shortCommand(p.label) }}</span>
                  <span class="csb-elapsed">{{ elapsedText(p.startedAt) }}</span>
                  <GdTooltip :content="t('chat.workspace.killProcess')" placement="bottom">
                    <button class="csb-kill" @click.stop="killProcess(p)">
                      <Dismiss16Regular class="w-2.5 h-2.5" />
                    </button>
                  </GdTooltip>
                </div>
              </GdTooltip>
            </div>
          </section>

          <!-- 子代理（仅活跃项）：点击行开子代理标签，标题行「详情」进子代理列表面板 -->
          <section v-if="activeSubagents.length" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.workspace.subagents') }}</span>
              <!-- 与胶囊段同口径：运行中/存活总数（0 也要显示，避免"有长期子代理却无计数"） -->
              <span class="csb-sec-count">{{ runningSubagentCount }}/{{ activeSubagents.length }}</span>
              <GdTooltip v-if="openSubagentList" :content="t('chat.workspace.subagentListTab')" placement="bottom">
                <button class="csb-sec-btn ml-auto" @click="openSubagentList?.(props.sessionId)">
                  <Bot20Regular class="w-3.5 h-3.5" />
                </button>
              </GdTooltip>
            </header>
            <div class="csb-list">
              <div v-for="item in activeSubagents" :key="item.id" class="csb-row"
                :class="{ 'csb-row--clickable': !!openSubAgent }" @click="openSubAgent?.(item.id)">
                <WorkflowStatusDot :status="dotStatus(item)" size="sm" />
                <img v-if="item.avatarUrl" :src="item.avatarUrl" class="csb-avatar" alt="" />
                <span class="csb-row-text">{{ item.title }}</span>
                <span class="csb-row-status">{{ statusText(item) }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRight16Regular, Bot20Regular, Checkmark16Regular, Dismiss16Regular, WindowConsole20Filled } from "@vicons/fluent";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import WorkflowStatusDot from "@/components/chat/workflow/WorkflowStatusDot.vue";
import { useTodoStatus } from "@/composables/useTodoStatus";
import { useRunningProcesses } from "@/composables/useRunningProcesses";
import { useSessionStore } from "@/stores/session";
import { shortCommand } from "@/utils/processDisplay";
import { buildSubagentItems, countRunningSubagents, splitSubagents, type SubagentItem } from "@/utils/subagentDisplay";
import type { Session } from "@/types/session";
import type { WorkflowMemberStatus } from "@/types/stream/workflow.types";

const props = defineProps<{
  sessionId?: string;
  /** 子会话列表（ChatPage 维护，经 ChatPanel 下传；含已冻结的，本胶囊只用活跃项） */
  subSessions?: Session[];
}>();

const { t } = useI18n();

const { items: todoItems, doneCount: todoDoneCount, currentItem: currentTodo } = useTodoStatus(
  () => props.sessionId,
);
const { processes, elapsedText, killProcess, openProcessLog } = useRunningProcesses(
  () => props.sessionId,
);

const sessionStore = useSessionStore();

const subagentItems = computed(() =>
  buildSubagentItems(props.subSessions, (id) => sessionStore.peekStreamStatus(id), t("chat.workspace.subagentTab")),
);
const activeSubagents = computed(() => splitSubagents(subagentItems.value).active);
const runningSubagentCount = computed(() => countRunningSubagents(subagentItems.value));

/** 任一段有内容才有胶囊（三段全空 → 整根不渲染，回到底部按钮的 :has() 锚点依赖此行为） */
const hasAny = computed(
  () => todoItems.value.length > 0 || processes.value.length > 0 || activeSubagents.value.length > 0,
);

// ── hover 展开（时序与旧 TODO 胶囊一致：进入 120ms 防误触，离开 80ms 防抖动） ──
const hovered = ref(false);
const panelVisible = computed(() => hovered.value);
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function onMouseEnter(): void {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  openTimer = setTimeout(() => { hovered.value = true; }, 120);
}
function onMouseLeave(): void {
  if (openTimer) { clearTimeout(openTimer); openTimer = null; }
  closeTimer = setTimeout(() => { hovered.value = false; }, 80);
}

// ── 子代理行动作与文案 ──
const openSubAgent = inject<((subSessionId: string) => void) | null>(
  "workspace:openSubAgentSession",
  null,
);

function dotStatus(item: SubagentItem): WorkflowMemberStatus {
  if (item.status === "error") return "failed";
  return item.status;
}

function statusText(item: SubagentItem): string {
  if (item.status === "error") return t("chat.workspace.wfFailed");
  if (item.status === "running") return t("chat.workspace.wfRunning");
  return t("chat.workspace.wfCompleted");
}

/** 打开子代理列表面板（同工作流卡片的「详情」入口模式；无 provide 的宿主不渲染） */
const openSubagentList = inject<((sessionId?: string) => void) | null>(
  "workspace:openSubagentList",
  null,
);
</script>

<style scoped>
.composer-status-bar {
  position: relative;
  display: flex;
  /* 收缩链：行变窄时能一直传到段内文本的 truncate，不把同行的回到底部按钮挤出可视区 */
  min-width: 0;
  max-width: 100%;
}

/* ── 外壳（唯一一条药丸）：与回到底部按钮同形（改这里要同步 ScrollToBottomButton） ── */
.csb-capsule {
  display: flex;
  align-items: center;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--gd-color-border);
  background: var(--gd-color-surface);
  cursor: pointer;
  user-select: none;
  /* 13px 文本的整数行高（28px 胶囊内居中余量保持整像素） */
  line-height: 20px;
  /* 宽度上限必须是定长：百分比上限在内在尺寸计算阶段不可解析、会被忽略（实测 103px 空档）；
     min-width:0 保证行窄时能收缩 */
  max-width: 420px;
  min-width: 0;
  /* 悬停底色是半透明 tint：换 background 会连同不透明底色一起换掉（浮层下文案透出），
     改用 inset 阴影叠在 surface 之上，合成恒为实色 */
  box-shadow: inset 0 0 0 999px transparent;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.csb-capsule:hover {
  box-shadow: inset 0 0 0 999px var(--gd-color-surface-hover);
}

/* ── 段：图标 + 文本 + 计数；段间细竖线分隔 ── */
.csb-seg {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 10px;
  height: 100%;
}
.csb-seg:first-child {
  padding-left: 12px;
}
.csb-seg:last-child {
  padding-right: 12px;
}
.csb-seg + .csb-seg {
  border-left: 1px solid var(--gd-color-surface-border);
}

/* 图标容器用偶数尺寸：奇数会让居中余量成半像素，图标随容器位置跳一个设备像素 */
.csb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
.csb-icon--muted {
  color: var(--gd-color-text-gray);
}
.csb-icon--active {
  color: var(--gd-color-text);
}
.csb-icon--done {
  color: var(--gd-color-success);
}
.csb-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--gd-color-text-disabled);
}

.csb-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--gd-color-text-gray);
}
.csb-count {
  flex: 0 0 auto;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 13px;
  color: var(--gd-color-text-disabled);
}
.csb-count--done {
  color: var(--gd-color-success);
}
.csb-count--live {
  color: var(--gd-color-success);
}

/* 运行中进程的旋转指示（原概览面板 overview-spin 同款） */
.csb-spinner {
  width: 9px;
  height: 9px;
  border: 1px solid var(--gd-color-primary-200);
  border-top-color: var(--gd-color-primary);
  border-radius: 50%;
  animation: csb-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes csb-spin {
  to { transform: rotate(360deg); }
}

/* ── 详情面板 ── */
.csb-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 32px));
  max-height: 288px;
  padding: 8px;
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface);
  border: 1px solid var(--gd-color-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.csb-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 面板分段：标题行 + 列表；段间细分割线（首段无线） */
.csb-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.csb-section + .csb-section {
  padding-top: 7px;
  border-top: 1px solid var(--gd-color-surface-border);
}
.csb-sec-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 2px;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-gray);
}
.csb-sec-title {
  font-weight: 500;
}
.csb-sec-count {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  font-weight: 600;
  color: var(--gd-color-success);
}
/* 分段标题行右对齐图标按钮（子代理列表入口；.ml-auto 走 tailwind） */
.csb-sec-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-disabled);
  cursor: pointer;
}
.csb-sec-btn:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-surface-hover);
}

.csb-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
/* GdTooltip 渲染 inline trigger 包装器：撑满整行，否则 flex 行被压成内容宽、
   hover 底色与右侧时间/终止按钮都不贴边（同 WorkflowMemberTree 的写法） */
.csb-list > .l-tooltip__trigger {
  display: block;
  width: 100%;
}
.csb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 6px;
  min-width: 0;
  transition: background 0.1s ease;
}
.csb-row--clickable {
  cursor: pointer;
}
.csb-row--clickable:hover {
  background: var(--gd-color-surface-hover);
}
.csb-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.csb-row-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 20px;
  color: var(--gd-color-text);
}
.csb-row-text--strong {
  color: var(--gd-color-text);
}
.csb-row-text--done {
  color: var(--gd-color-text-disabled);
  text-decoration: line-through;
}
.csb-row-text--cmd {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  color: var(--gd-color-text-gray);
}
.csb-row-status {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}
.csb-elapsed {
  flex: 0 0 auto;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}
.csb-kill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.csb-row:hover .csb-kill {
  opacity: 1;
}
.csb-kill:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* 面板出入动画：只动 transform 不动 opacity（本环境 rAF 不可靠，opacity 会卡半透明） */
.csb-panel-enter-active,
.csb-panel-leave-active {
  transition: transform 0.12s ease;
}
.csb-panel-enter-from,
.csb-panel-leave-to {
  transform: translateX(-50%) translateY(4px);
}
</style>
