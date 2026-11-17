<template>
  <!-- 输入区运行时状态胶囊（共享外壳）：单条 28px 药丸内分三段——目标 / 待办 / 后台任务，
       任一段没有内容就整段不渲染，三段全空整根不渲染；hover 在上方弹出面板按域分段列细节。
       数据契约：目标（REST + goal_updated + onConnected 补拉）、待办（REST + todo_updated）、
       后台任务（jobs_snapshot + jobs REST 基线；shell 后台进程与后台子代理已统一为 job 托管，
       按 kind 拆组展示），各域逻辑见 composables/useGoalStatus.ts、composables/useTodoStatus.ts、
       composables/useBackgroundJobs.ts。
       前台子代理（对话流内阻塞运行的 spawn）不是 job，不进本胶囊——由消息流行内头像动画表达。
       已结束（冻结）子代理不在本胶囊表达（运行时状态专属），回放入口见子代理列表面板
       （workspace/SubagentListPanel.vue）。 -->
  <div v-if="hasAny" class="composer-status-bar" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <!-- 外壳：唯一一条药丸，段间以细竖线分隔（同形约定见 ChatPanel 的 .composer-status-row 注释） -->
    <div class="csb-capsule">
      <!-- ── 会话目标段：截断的目标 + 迭代数/阶段；active/paused 时给暂停/恢复按钮。
           active 但 armed=false（后端重启）时显示恢复按钮重新激活自动推进。 ── -->
      <span v-if="goal" class="csb-seg">
        <span class="csb-icon">
          <Target20Regular class="w-3.5 h-3.5 csb-icon--muted" />
        </span>
        <span class="csb-text" :title="goal.objective">{{ goal.objective }}</span>
        <span class="csb-count">{{ goalCapsuleText }}</span>
        <button v-if="goal.phase === 'active' && goalState?.armed !== false" class="csb-goal-btn" :title="t('chat.goal.pause')"
          :aria-label="t('chat.goal.pause')" @click.stop="pauseGoal">
          <Pause16Regular class="w-2.5 h-2.5" />
        </button>
        <button v-else-if="goal.phase === 'paused' || (goal.phase === 'active' && goalState?.armed === false)"
          class="csb-goal-btn" :title="goalState?.armed === false ? t('chat.goal.resumeDisarmed') : t('chat.goal.resume')"
          :aria-label="goalState?.armed === false ? t('chat.goal.resumeDisarmed') : t('chat.goal.resume')"
          @click.stop="resumeGoal">
          <Play16Regular class="w-2.5 h-2.5" />
        </button>
      </span>

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

      <!-- ── 后台任务段：只出总数（shell 后台进程 + 后台子代理，统一 job 托管）；
           图标随构成变化——纯进程用终端图标、纯子代理用机器人图标、混合并排，
           一眼可辨后台任务的类型构成；分类明细在 hover 面板里看 ── -->
      <span v-if="backgroundJobCount" class="csb-seg">
        <span class="csb-icon">
          <WindowConsole20Filled v-if="!subagentJobs.length" class="w-3.5 h-3.5 csb-icon--muted" />
          <Bot20Regular v-else-if="!processJobs.length" class="w-3.5 h-3.5 csb-icon--muted" />
          <template v-else>
            <WindowConsole20Filled class="w-3.5 h-3.5 csb-icon--muted" />
            <Bot20Regular class="w-3.5 h-3.5 csb-icon--muted csb-icon--pair" />
          </template>
        </span>
        <span class="csb-count" :class="{ 'csb-count--live': stoppingCount === 0 }">{{ backgroundJobCount }}</span>
      </span>
    </div>

    <!-- 详情面板（hover 展开）：按域分段，空域不渲染 -->
    <Transition name="csb-panel">
      <div v-if="panelVisible" class="csb-panel">
        <div class="csb-panel-scroll">
          <!-- 会话目标：目标全文、阶段、迭代数、token 用量、清除按钮 -->
          <section v-if="goal" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.goal.title') }}</span>
              <span class="csb-sec-count">{{ goalPhaseText }}</span>
              <GdTooltip :content="t('chat.goal.clear')" placement="bottom">
                <button class="csb-sec-btn ml-auto" @click="clearGoal">
                  <Dismiss16Regular class="w-3.5 h-3.5" />
                </button>
              </GdTooltip>
            </header>
            <div class="csb-list">
              <div class="csb-row">
                <span class="csb-row-text csb-goal-objective">{{ goal.objective }}</span>
              </div>
              <div class="csb-row">
                <span class="csb-row-status">{{ t('chat.goal.iteration', { n: goal.iteration }) }}</span>
                <span class="csb-elapsed ml-auto">{{ goalTokensText }}</span>
              </div>
              <div v-if="goal.blockedReason" class="csb-row">
                <span class="csb-row-text csb-goal-objective">{{ goal.blockedReason }}</span>
              </div>
              <div v-if="goalState?.failure" class="csb-row">
                <span class="csb-row-text csb-goal-objective">
                  {{ t('chat.goal.failure') }}: {{ goalState.failure }}
                </span>
              </div>
            </div>
          </section>

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

          <!-- 后台任务（统一 job 托管）：按分类分组——终端进程 / 子代理；空组不渲染。
               进程行点击开日志标签；子代理行点击开子代理标签，行尾同样给终止按钮
               （subagent job 的 kill 协议与进程完全同构）。 -->
          <section v-if="backgroundJobCount" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.workspace.backgroundJobs') }}</span>
              <span class="csb-sec-count">{{ backgroundJobCount }}</span>
              <GdTooltip v-if="subagentJobs.length && openSubagentList" :content="t('chat.workspace.subagentListTab')" placement="bottom">
                <button class="csb-sec-btn ml-auto" @click="openSubagentList?.(props.sessionId)">
                  <Bot20Regular class="w-3.5 h-3.5" />
                </button>
              </GdTooltip>
            </header>

            <!-- 终端进程组：等宽命令摘要 + 已运行时长 + 终止 -->
            <template v-if="processJobs.length">
              <div class="csb-group-label">{{ t('chat.workspace.processes') }}</div>
              <div class="csb-list">
                <GdTooltip v-for="p in processJobs" :key="p.id" :content="p.label" placement="bottom">
                  <div class="csb-row csb-row--clickable" @click="openProcessLog(p)">
                    <span class="csb-icon"><span class="csb-spinner"></span></span>
                    <span class="csb-row-text csb-row-text--cmd">{{ shortCommand(p.label) }}</span>
                    <span class="csb-row-status">{{ jobStatusText(p) }}</span>
                    <span class="csb-elapsed">{{ elapsedText(p.startedAt) }}</span>
                    <GdTooltip :content="t('chat.workspace.killProcess')" placement="bottom">
                      <button class="csb-kill" @click.stop="killJob(p)">
                        <Dismiss16Regular class="w-2.5 h-2.5" />
                      </button>
                    </GdTooltip>
                  </div>
                </GdTooltip>
              </div>
            </template>

            <!-- 子代理组：头像（subSessions 按 handle 富集）+ 名称 + 已运行时长 + 终止 -->
            <template v-if="subagentJobs.length">
              <div class="csb-group-label">{{ t('chat.workspace.subagents') }}</div>
              <div class="csb-list">
                <GdTooltip v-for="s in subagentJobs" :key="s.id" :content="s.label" placement="bottom">
                  <div class="csb-row csb-row--clickable"
                    :class="{ 'csb-row--plain': !openSubAgent }" @click="openSubAgent?.(subSessionIdOf(s))">
                    <span class="csb-icon"><span class="csb-spinner"></span></span>
                    <img v-if="subagentAvatar(s)" :src="subagentAvatar(s)" class="csb-avatar" alt="" />
                    <Bot20Regular v-else class="w-3.5 h-3.5 csb-icon--muted csb-avatar-fallback" />
                    <span class="csb-row-text">{{ s.label }}</span>
                    <span class="csb-row-status">{{ jobStatusText(s) }}</span>
                    <span class="csb-elapsed">{{ elapsedText(s.startedAt) }}</span>
                    <GdTooltip :content="t('chat.workspace.killProcess')" placement="bottom">
                      <button class="csb-kill" @click.stop="killJob(s)">
                        <Dismiss16Regular class="w-2.5 h-2.5" />
                      </button>
                    </GdTooltip>
                  </div>
                </GdTooltip>
              </div>
            </template>
          </section>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRight16Regular, Bot20Regular, Checkmark16Regular, Dismiss16Regular, Pause16Regular, Play16Regular, Target20Regular, WindowConsole20Filled } from "@vicons/fluent";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import { useGoalStatus } from "@/composables/useGoalStatus";
import { useTodoStatus } from "@/composables/useTodoStatus";
import { useBackgroundJobs } from "@/composables/useBackgroundJobs";
import { apiService } from "@/services/ApiService";
import { toast } from "@/components/ui/toastService";
import { shortCommand } from "@/utils/processDisplay";
import type { UiJobInfo } from "@/services/ApiService";
import type { Session } from "@/types/session";

const props = defineProps<{
  sessionId?: string;
  /** 子会话列表（ChatPage 维护，经 ChatPanel 下传）：仅用于按 job.handle 富集子代理头像 */
  subSessions?: Session[];
}>();

const { t } = useI18n();

const { state: goalState, refresh: refreshGoal } = useGoalStatus(
  () => props.sessionId,
);
const goal = computed(() => goalState.value?.goal ?? null);

const { items: todoItems, doneCount: todoDoneCount, currentItem: currentTodo } = useTodoStatus(
  () => props.sessionId,
);
const { processJobs, subagentJobs, elapsedText, killJob, openProcessLog } = useBackgroundJobs(
  () => props.sessionId,
);

/** 后台任务总数（统一 job 托管：终端进程 + 后台子代理） */
const backgroundJobCount = computed(
  () => processJobs.value.length + subagentJobs.value.length,
);
/** 停止中数量：>0 时胶囊计数用中性色（任务已不可再交互，等快照确认终态） */
const stoppingCount = computed(
  () => [...processJobs.value, ...subagentJobs.value].filter((j) => j.status === "stopping").length,
);

/** 子代理 job.handle = 子会话 id：点击打开子代理标签的入参 */
function subSessionIdOf(job: UiJobInfo): string {
  return typeof job.handle === "string" ? job.handle : job.id;
}

/** 按 handle（= 子会话 id）从 subSessions 查头像；查不到回落机器人图标 */
function subagentAvatar(job: UiJobInfo): string | undefined {
  const sid = subSessionIdOf(job);
  const sub = props.subSessions?.find((s) => s.id === sid);
  return sub?.avatarUrl || sub?.agent?.avatarUrl || undefined;
}

/** stopping 显示「停止中」，其余（running）不赘述——spinner 已表达 */
function jobStatusText(job: UiJobInfo): string {
  return job.status === "stopping" ? t("chat.workspace.jobStopping") : "";
}

/** 详情页阶段文案（胶囊在非 active/paused 阶段也复用） */
const goalPhaseText = computed(() =>
  goal.value ? t(`chat.goal.status.${goal.value.phase}`) : '',
);

/** 胶囊右侧短文案：进行中/暂停显示迭代数，其余阶段显示阶段名 */
const goalCapsuleText = computed(() => {
  const g = goal.value;
  if (!g) return '';
  return g.phase === 'active' || g.phase === 'paused'
    ? t('chat.goal.iteration', { n: g.iteration })
    : goalPhaseText.value;
});

/** 目标 token 用量：无预算时只显示已用，有预算显示「已用 / 预算」 */
const goalTokensText = computed(() => {
  const g = goal.value;
  if (!g) return '';
  return g.tokenBudget === null || g.tokenBudget === undefined
    ? `${g.tokensUsed} tok`
    : `${g.tokensUsed} / ${g.tokenBudget} tok`;
});

/** 目标 REST 变更：成功与否都补拉一次，避免本地投影与后端状态漂移 */
async function mutateGoal(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error("Failed to update session goal:", error);
    toast.error(t('chat.command.goalError'));
  }
  void refreshGoal();
}

function pauseGoal(): void {
  const sid = props.sessionId;
  const g = goal.value;
  if (!sid || !g) return;
  void mutateGoal(() => apiService.pauseSessionGoal(sid, g.revision));
}

function resumeGoal(): void {
  const sid = props.sessionId;
  const g = goal.value;
  if (!sid || !g) return;
  void mutateGoal(() => apiService.resumeSessionGoal(sid, g.revision));
}

function clearGoal(): void {
  const sid = props.sessionId;
  const g = goal.value;
  if (!sid || !g) return;
  void mutateGoal(() => apiService.clearSessionGoal(sid, g.revision));
}

/** 任一段有内容才有胶囊（三段全空 → 整根不渲染，回到底部按钮的 :has() 锚点依赖此行为） */
const hasAny = computed(
  () => !!goal.value || todoItems.value.length > 0 || backgroundJobCount.value > 0,
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

// ── 子代理行动作：打开子代理标签（无 provide 的宿主行不可点） ──
const openSubAgent = inject<((subSessionId: string) => void) | null>(
  "workspace:openSubAgentSession",
  null,
);

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
  color: var(--gd-color-text-gray);
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

/* 面板内分类组标签（终端进程/子代理）：比 sec-head 更轻的次级标题 */
.csb-group-label {
  padding: 3px 2px 1px;
  font-size: 10px;
  line-height: 14px;
  color: var(--gd-color-text-gray);
}

/* 胶囊段内双图标并排（进程+子代理混合构成）：收紧间距避免占满宽度 */
.csb-icon--pair {
  margin-left: -3px;
}

/* 子代理无头像时的回落图标：与 img 头像同尺寸同对齐 */
.csb-avatar-fallback {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
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
/* 无 provide 宿主（如 Bot 会话面板）：子代理行不可点，但仍展示信息 */
.csb-row--plain {
  cursor: default;
}
.csb-row--plain:hover {
  background: transparent;
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
/* 目标全文：面板里折行展示（胶囊里才截断），覆盖 .csb-row-text 的 nowrap */
.csb-goal-objective {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.csb-row-status {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--gd-color-text-gray);
}
.csb-elapsed {
  flex: 0 0 auto;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  color: var(--gd-color-text-gray);
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

/* 目标段暂停/恢复按钮：常驻（不像终止进程那样仅 hover 显示，避免找不到入口） */
.csb-goal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-disabled);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.csb-goal-btn:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-surface-hover);
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
