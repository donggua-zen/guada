<template>
  <!-- 输入区运行时状态胶囊（共享外壳）：单条 28px 药丸内分「目标 / 待办 / 后台进程 / 后台子代理」四段，
       任一段没有内容就整段不渲染，四段全空整根不渲染；展开后在上方弹出面板按域分段列细节。
       展开方式按设备分家（见 onCapsuleActivate）：
       - 桌面：hover 即展开（进入 120ms 防误触、离开 80ms 防抖动），移开即收起；
       - 移动端：点击开/关（触屏没有可靠的 hover，悬停展开等于打不开），
         另加点击外部与 Esc 关闭，与 DropdownMenu / GdPopover 的收口方式一致。
       后台任务之所以拆成两段而不是一段双图标：两类同时存在时，两个 14px 图标塞不进
       同一个 16px 图标容器，负边距叠压后小尺寸下糊成一团，且合并计数看不出类型构成。
       数据契约：目标（REST + goal_updated + onConnected 补拉）、待办（REST + todo_updated）、
       后台任务（jobs_snapshot + jobs REST 基线；shell 后台进程与后台子代理已统一为 job 托管，
       按 kind 拆段展示），各域逻辑见 composables/useGoalStatus.ts、composables/useTodoStatus.ts、
       composables/useBackgroundJobs.ts。
       前台子代理（对话流内阻塞运行的 spawn）不是 job，不进本胶囊——由消息流行内头像动画表达。
       已结束的子代理不在本胶囊表达（运行时状态专属），回放入口见子代理列表面板
       （workspace/SubagentListPanel.vue）。 -->
  <div v-if="hasAny" ref="rootRef" class="composer-status-bar"
    :class="{ 'is-mobile': isMobile, 'is-open': panelVisible }"
    @mouseenter="onMouseEnter" @mouseleave="onMouseLeave" @click="onCapsuleActivate">
    <!-- 外壳：唯一一条药丸，段间以细竖线分隔（同形约定见 ChatPanel 的 .composer-status-row 注释） -->
    <div class="csb-capsule">
      <!-- ── 会话目标段：截断的目标 + 迭代数/阶段；active/paused 时给暂停/恢复按钮。
           active 但 armed=false（后端重启）时显示恢复按钮重新激活自动推进。 ── -->
      <span v-if="goal" class="csb-seg">
        <span class="csb-icon">
          <Target20Regular class="w-4 h-4 csb-icon--muted" />
        </span>
        <span class="csb-text" v-tooltip="tip(goal.objective)">{{ goal.objective }}</span>
        <span class="csb-count">{{ goalCapsuleText }}</span>
        <button v-if="goal.phase === 'active' && goalState?.armed !== false" class="csb-goal-btn" v-tooltip="tip(t('chat.goal.pause'))"
          :aria-label="t('chat.goal.pause')" @click.stop="pauseGoal">
          <Pause16Regular class="w-2.5 h-2.5" />
        </button>
        <button v-else-if="goal.phase === 'paused' || (goal.phase === 'active' && goalState?.armed === false)"
          class="csb-goal-btn" v-tooltip="tip(goalState?.armed === false ? t('chat.goal.resumeDisarmed') : t('chat.goal.resume'))"
          :aria-label="goalState?.armed === false ? t('chat.goal.resumeDisarmed') : t('chat.goal.resume')"
          @click.stop="resumeGoal">
          <Play16Regular class="w-2.5 h-2.5" />
        </button>
      </span>

      <!-- ── 待办段 ── -->
      <span v-if="todoItems.length" class="csb-seg">
        <span class="csb-icon">
          <ArrowRight16Regular v-if="currentTodo?.status === 'in_progress'" class="w-4 h-4 csb-icon--active" />
          <Checkmark16Regular v-else-if="currentTodo?.status === 'completed'" class="w-4 h-4 csb-icon--done" />
          <span v-else class="csb-ring"></span>
        </span>
        <span class="csb-text" v-tooltip="tip(currentTodo?.content)">{{ currentTodo?.content }}</span>
        <span class="csb-count csb-count--done">{{ todoDoneCount }}/{{ todoItems.length }}</span>
      </span>

      <!-- ── 后台任务段（按 kind 拆成两段：进程 / 子代理，各自图标 + 各自计数）。
           拆段的理由：两类同时存在时，两个 14px 图标挤不进同一个 16px 图标容器，
           只能靠负边距互相叠压 → 小尺寸下糊成一团、右缘顶到计数，看不出"几个进程几个子代理"。
           拆开后段间沿用胶囊统一的细竖线分隔，与 hover 面板里的分组（后台进程 / 子代理）一致。
           两类各自的 stopping 计数独立，某一类全部停手中只让那一格变中性色。 ── -->
      <span v-if="processJobs.length" class="csb-seg csb-seg--bg">
        <span class="csb-icon">
          <!-- 与对话流工具组里的命令行工具同源图标（ToolTerminalIcon，16px 原生网格线条），
               不是 fluent 的 WindowConsole：同一条命令在对话流和胶囊里应长得一样 -->
          <ToolTerminalIcon class="csb-icon--muted" />
        </span>
        <span class="csb-count" :class="{ 'csb-count--live': processStoppingCount === 0 }">{{ processJobs.length }}</span>
      </span>

      <span v-if="subagentJobs.length" class="csb-seg csb-seg--bg csb-seg--subagent">
        <span class="csb-icon">
          <!-- 复用智能体专属头像（对话流 SubAgentToolRow 同一个组件），替掉通用机器人图标：
               子代理有自己的视觉身份，胶囊里也该认得出来。只有 running 时挂眨眼/左顾右盼动画
               （全部 stopping 时眼睛停下，与计数转中性色表达同一件事）。 -->
          <SubAgentFace :running="subagentFaceAnimating" />
        </span>
        <span class="csb-count" :class="{ 'csb-count--live': subagentStoppingCount === 0 }">{{ subagentJobs.length }}</span>
      </span>
    </div>

    <!-- 详情面板（桌面 hover 展开 / 移动端点击展开）：按域分段，空域不渲染。
         移动端面板在胶囊的点击区内，@click.stop 拦住冒泡——否则点面板空白处会被
         胶囊的 toggle 当成"再点一次"而收起。 -->
    <Transition name="csb-panel">
      <div v-if="panelVisible" class="csb-panel" @click.stop>
        <div class="csb-panel-scroll">
          <!-- 会话目标：目标全文、阶段、迭代数、token 用量、清除按钮 -->
          <section v-if="goal" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.goal.title') }}</span>
              <span class="csb-sec-count">{{ goalPhaseText }}</span>
              <button v-tooltip:bottom="tip(t('chat.goal.clear'))" class="csb-sec-btn ml-auto" @click="clearGoal">
                  <Dismiss16Regular class="w-3.5 h-3.5" />
                </button>
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

          <!-- 后台任务（统一 job 托管）：每条任务一张两行卡片——首行身份块 + 可折两行的标题，
               次行「已运行 x 分 y 秒」+ 常显的「停止」按钮。
               进程行点击开日志标签；子代理行点击开子代理标签，行尾同一套停止协议
               （subagent job 的 kill 协议与进程完全同构）。
               两类平铺在同一张列表里，不设分组小标题：身份块已经把类型区分得很清楚
               （终端线条图标 vs 子代理脸/自定义头像），标题只会多一层视觉噪音。
               排序按「进程在前、子代理在后」，与胶囊里两段的顺序一致。 -->
          <section v-if="backgroundJobCount" class="csb-section">
            <header class="csb-sec-head">
              <span class="csb-sec-title">{{ t('chat.workspace.backgroundJobs') }}</span>
              <span class="csb-sec-count">{{ backgroundJobCount }}</span>
              <button v-if="subagentJobs.length && openSubagentList" v-tooltip:bottom="tip(t('chat.workspace.subagentListTab'))" class="csb-sec-btn ml-auto" @click="handleOpenSubagentList">
                  <Bot20Regular class="w-3.5 h-3.5" />
                </button>
            </header>

            <div class="csb-list">
              <!-- 终端进程 -->
              <div v-for="p in processJobs" :key="p.id" v-tooltip:bottom="tip(p.label)" class="csb-task csb-task--clickable"
                @click="handleOpenProcessLog(p)">
                <span class="csb-task-badge">
                  <ToolTerminalIcon />
                </span>
                <div class="csb-task-body">
                  <span class="csb-task-title csb-task-title--cmd">{{ shortCommand(p.label, 120) }}</span>
                  <div class="csb-task-meta">
                    <span class="csb-task-info">
                      <span class="csb-task-elapsed">{{ elapsedLabel(p.startedAt) }}</span>
                      <span v-if="jobStatusText(p)" class="csb-task-stopping">{{ jobStatusText(p) }}</span>
                    </span>
                    <button v-tooltip:bottom="tip(t('chat.workspace.killProcess'))" class="csb-task-stop"
                      :disabled="p.status === 'stopping'" @click.stop="killJob(p)">
                      <RecordStop12Regular class="w-3 h-3" />
                      <span>{{ t('chat.workspace.jobStop') }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 子代理：头像（subSessions 按 handle 富集）+ 名称 + 已运行时长 + 停止 -->
              <div v-for="s in subagentJobs" :key="s.id" v-tooltip:bottom="tip(s.label)" class="csb-task"
                :class="{ 'csb-task--clickable': !!openSubAgent }" @click="handleOpenSubAgent(s)">
                <!-- 自定义头像与大纲图标同尺寸；无自定义头像时用智能体专属头像
                     （与胶囊段、对话流同一个组件），不再回落机器人图标 -->
                <img v-if="subagentAvatar(s)" :src="subagentAvatar(s)" class="csb-task-avatar" alt="" />
                <span v-else class="csb-task-face">
                  <SubAgentFace :running="s.status === 'running'" />
                </span>
                <div class="csb-task-body">
                  <span class="csb-task-title">{{ s.label }}</span>
                  <div class="csb-task-meta">
                    <span class="csb-task-info">
                      <span class="csb-task-elapsed">{{ elapsedLabel(s.startedAt) }}</span>
                      <span v-if="jobStatusText(s)" class="csb-task-stopping">{{ jobStatusText(s) }}</span>
                    </span>
                    <button v-tooltip:bottom="tip(t('chat.workspace.stopSubagent'))" class="csb-task-stop"
                      :disabled="s.status === 'stopping'" @click.stop="killJob(s)">
                      <RecordStop12Regular class="w-3 h-3" />
                      <span>{{ t('chat.workspace.jobStop') }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRight16Regular, Bot20Regular, Checkmark16Regular, Dismiss16Regular, Pause16Regular, Play16Regular, RecordStop12Regular, Target20Regular } from "@vicons/fluent";
import { ToolTerminalIcon } from "@/components/icons/toolIcons";
import SubAgentFace from "./message-item/SubAgentFace.vue";
import { useGoalStatus } from "@/composables/useGoalStatus";
import { useTodoStatus } from "@/composables/useTodoStatus";
import { useBackgroundJobs } from "@/composables/useBackgroundJobs";
import { isMobileDevice } from "@/composables/useDevice";
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
const { processJobs, subagentJobs, elapsedParts, killJob, openProcessLog } = useBackgroundJobs(
  () => props.sessionId,
);

/** 后台任务总数（统一 job 托管：终端进程 + 后台子代理）；胶囊已按 kind 拆两段，这里只供面板/显隐判据用 */
const backgroundJobCount = computed(
  () => processJobs.value.length + subagentJobs.value.length,
);
/** 停止中数量（分类）：>0 时该段的计数用中性色（任务已不可再交互，等快照确认终态）。
    按类拆分而非合计——进程全部停手但子代理仍在跑时，只有进程那格该变灰。 */
const processStoppingCount = computed(
  () => processJobs.value.filter((j) => j.status === "stopping").length,
);
const subagentStoppingCount = computed(
  () => subagentJobs.value.filter((j) => j.status === "stopping").length,
);
/** 子代理头像是否做眨眼/左顾右盼：还有 running 的才动（全部停手就静止，避免"还在跑"的误读）。
    一个胶囊只挂一张脸，不按 job 数量叠多张——密度和高度都不允许。 */
const subagentFaceAnimating = computed(
  () => subagentJobs.value.some((j) => j.status === "running"),
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

/** stopping 时元信息行追加「停止中」：按钮已转禁用，靠这段文字说明为什么点不动 */
function jobStatusText(job: UiJobInfo): string {
  return job.status === "stopping" ? t("chat.workspace.jobStopping") : "";
}

/** 已运行时长按档位拼成本地化文案（「已运行 1 分 18 秒」）；非法时间戳不出这一段 */
function elapsedLabel(startedAt: number): string {
  const parts = elapsedParts(startedAt);
  if (!parts) return "";
  const duration =
    parts.hours > 0
      ? t("chat.workspace.jobDurationHours", { hours: parts.hours, minutes: parts.minutes })
      : parts.minutes > 0
        ? t("chat.workspace.jobDurationMinutes", { minutes: parts.minutes, seconds: parts.seconds })
        : t("chat.workspace.jobDurationSeconds", { seconds: parts.seconds });
  return t("chat.workspace.jobElapsed", { duration });
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

/** 任一段有内容才有胶囊（四段全空 → 整根不渲染，回到底部按钮的 :has() 锚点依赖此行为） */
const hasAny = computed(
  () => !!goal.value || todoItems.value.length > 0 || backgroundJobCount.value > 0,
);

// ── 展开态：桌面走 hover，移动端走点击（触屏的 hover 不可靠，悬停展开等于打不开） ──
const isMobile = isMobileDevice;
const rootRef = ref<HTMLElement | null>(null);

/** 桌面 hover 态（进入 120ms 防误触，离开 80ms 防抖动——与旧 TODO 胶囊时序一致） */
const hovered = ref(false);
/** 移动端点击态（开/关由胶囊自身 toggle，外部点击与 Esc 收起） */
const tapped = ref(false);

const panelVisible = computed(() => (isMobile ? tapped.value : hovered.value));

let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function onMouseEnter(): void {
  // 移动端不参与 hover：部分触屏浏览器会在 tap 后补发 mouseenter，
  // 若放行会让「点开再点关」变成「点开→补发 hover→面板粘住」
  if (isMobile) return;
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  openTimer = setTimeout(() => { hovered.value = true; }, 120);
}
function onMouseLeave(): void {
  if (isMobile) return;
  if (openTimer) { clearTimeout(openTimer); openTimer = null; }
  closeTimer = setTimeout(() => { hovered.value = false; }, 80);
}

/** 胶囊点击：仅移动端生效，开↔关。段内按钮（暂停/恢复目标）自带 @click.stop，不会走到这里 */
function onCapsuleActivate(): void {
  if (!isMobile) return;
  tapped.value = !tapped.value;
}

/** 移动端点外部收起：用 pointerdown 捕获（比 click 更早，避免先触发内部按钮再收起） */
function onDocPointerDown(event: PointerEvent): void {
  const root = rootRef.value;
  if (!root || root.contains(event.target as Node)) return;
  tapped.value = false;
}

function onDocKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") tapped.value = false;
}

// 面板只在移动端点击态下挂全局监听（桌面 hover 不需要），收起时立即解绑
watch(tapped, (open) => {
  if (!isMobile) return;
  if (open) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown);
  }
});

// 胶囊整体消失（任务全部结束 / 切到无目标无待办的会话）→ 复位展开态。
// 否则下次出现时 tapped 仍是 true，面板会在用户没点的情况下自己弹出来；
// 同时把全局监听解绑，避免留一份挂空的 pointerdown。
watch(hasAny, (any) => {
  if (any) return;
  tapped.value = false;
  hovered.value = false;
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
});

onBeforeUnmount(() => {
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
});

/** 移动端点击面板内的跳转项：工作区会整屏接管，面板随之一并收起（桌面保持原行为） */
function closeOnMobile(): void {
  if (isMobile) tapped.value = false;
}

/** 移动端一律不挂 tooltip：触屏没有悬停，点击会补发 mouseenter 把浮层弹出来，
    正好压在刚展开的面板上（且 tooltip 只在滚动/缩放时收起，会一直赖着）。
    桌面原样透传文案。 */
function tip(text: string | undefined | null): string {
  return isMobile ? "" : (text ?? "");
}

/** 进程行点击 → 打开日志标签（移动端同时收起面板） */
function handleOpenProcessLog(job: UiJobInfo): void {
  openProcessLog(job);
  closeOnMobile();
}

/** 子代理行点击 → 打开子代理标签（移动端同时收起面板） */
function handleOpenSubAgent(job: UiJobInfo): void {
  if (!openSubAgent) return;
  openSubAgent(subSessionIdOf(job));
  closeOnMobile();
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

/** 子代理列表入口：移动端打开后同样收起胶囊面板 */
function handleOpenSubagentList(): void {
  if (!openSubagentList) return;
  openSubagentList(props.sessionId);
  closeOnMobile();
}
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
.csb-seg:first-child:not(.csb-seg--bg) {
  padding-left: 12px;
}
.csb-seg:last-child:not(.csb-seg--bg) {
  padding-right: 12px;
}
.csb-seg + .csb-seg {
  border-left: 1px solid var(--gd-color-surface-border);
}
/* 后台任务的两个分类段（进程 / 子代理）内容只有「图标 + 数字」，比文本段短得多：
   收紧段内间距，避免拆成两段后把胶囊撑长。首末段也统一 8px——药丸两端的圆角留白
   按 16px 图标算 8px 已足够，不必跟文本段一样留 12px。 */
.csb-seg--bg {
  gap: 4px;
  padding: 0 8px;
}
/* 子代理段：头像的身份色由对话流侧 .subagent-block 下发，胶囊不在那个子树里，
   这里补一份同样的变量（跟随主题主色，与 SubAgentToolRow 的取值保持同源）。
   头像是 16×16 的实心块，视觉重量约为细线图标的两倍，故与计数之间多留 1px。 */
.csb-seg--subagent {
  --sa-identity-face: var(--gd-color-primary);
  gap: 5px;
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
/* 容器与图标同为 16px：居中余量是 0，图标与文本基线严丝合缝，也不会出现
   "容器 − 图标 = 奇数" 导致的半像素偏移。胶囊内图标一律 w-4 h-4，不要再写 w-3.5
   （14px 会在容器里留 2px 空档，视觉上图标偏小且与 13px 文本不对称）。 */
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

/* 运行中进程的旋转指示已随旧单行布局下线：两行卡片用身份块承载辨识，
   状态交给元信息行的「停止中」与停用按钮表达，不再叠一个小转圈。 */

/* ── 详情面板 ── */
.csb-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  /* 392px：两行卡片 + 常显「停止」后，标题需要更长的折行宽度才不会两行都截断 */
  width: min(392px, calc(100vw - 32px));
  max-height: 340px;
  padding: 6px;
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
  /* 横向 4px 与 .csb-task 的 padding 一致：面板 6px + 4px = 10px，
     标题文字与卡片里的图标/正文同一起点（改任一处都要同步） */
  padding: 0 4px 2px;
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
  gap: 2px;
}

/* ── 后台任务卡片：首行身份块 + 标题，次行「已运行 X」+ 常显停止按钮 ──
   padding 4px：四边等值，条目自身收紧，条与条之间靠 .csb-list 的 gap 分隔；
   横向 4px 与段标题的 padding-inline 对齐，图标/文字与标题同一起点。
   border-radius 8px 与胶囊 8px 同形。 */
.csb-task {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px;
  border-radius: 8px;
  min-width: 0;
  transition: background 0.1s ease;
}
.csb-task--clickable {
  cursor: pointer;
}
.csb-task--clickable:hover {
  background: var(--gd-color-surface-hover);
}

/* 进程身份块：只占位、不画底色——与对话流工具组的图标一样是纯线条（无灰底方块），
   20px 槽位里放 16px 原生网格图标，与子代理脸同宽对齐。
   颜色用 text-subtle，对齐 MessageToolCalls 的 .tool-call-icon。 */
.csb-task-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  color: var(--gd-color-text-subtle);
}
/* 子代理脸：SubAgentFace 自带 16×16，这里垫到 20px 槽位与进程块对齐 */
.csb-task-face {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}
.csb-task-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 auto;
}

.csb-task-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
/* 标题：最多两行（line-clamp），整行不再省略成一行——参考图里长标题折行更易读 */
.csb-task-title {
  min-width: 0;
  font-size: 13px;
  /* 13 × 18 = 234 整数（subpixel R1） */
  line-height: 18px;
  color: var(--gd-color-text);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow-wrap: anywhere;
}
/* 进程标题是命令：等宽 + 次一级灰，与子代理（正文色）区分开 */
.csb-task-title--cmd {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  /* 12 × 16 = 192 整数 */
  line-height: 16px;
  color: var(--gd-color-text-gray);
}

/* 元信息行：时长靠左、停止按钮靠右 */
.csb-task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.csb-task-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
}
.csb-task-elapsed {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  /* 11 × 16 = 176 整数 */
  line-height: 16px;
  color: var(--gd-color-text-gray);
}
/* 停止中：任务已不可再交互（按钮停用），靠这格文字说明原因 */
.csb-task-stopping {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-disabled);
}

/* 停止按钮：常显（参考图布局），图标 + 文字合成一个次级按钮。
   hover 才转危险色——常显红色会让整块面板像一堆报错。 */
.csb-task-stop {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gd-color-text-gray);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.csb-task-stop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--gd-color-danger) 10%, transparent);
  color: var(--gd-color-danger);
}
.csb-task-stop:disabled {
  color: var(--gd-color-text-disabled);
  cursor: default;
  opacity: 0.6;
}

/* 目标 / 待办段的行（后台任务已迁到 .csb-task 卡片，这里只服务前两段） */
.csb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 6px;
  min-width: 0;
  transition: background 0.1s ease;
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
/* 目标全文：面板里折行展示（胶囊里才截断），覆盖 .csb-row-text 的 nowrap */
.csb-goal-objective {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  line-height: 18px;
  overflow-wrap: anywhere;
}
/* 目标段的迭代数 / token 用量（旧后台任务行共用过这两档，现在只剩前两段） */
.csb-row-status,
.csb-elapsed {
  flex: 0 0 auto;
  font-size: 11px;
  /* 11 × 16 = 176 整数 */
  line-height: 16px;
  color: var(--gd-color-text-gray);
}
.csb-elapsed {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
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

/* ==================== 移动端（html.mobile 门控 + .is-mobile 组件态） ====================

   判定用 useDevice 的 isMobileDevice（非 Electron 且移动 UA / 粗指针），
   与全站移动适配同一开关；这里只用它做触屏专属的尺寸与命中区增强。

   为什么不用 @media (pointer: coarse)：组件态的点击开关已经由 isMobile 决定，
   样式再走另一套判据会出现「点击态生效但样式没生效」的错位。 */

/* 胶囊：整条是点击开关，触屏命中区抬高到 36px（28px 对拇指偏小）。
   宽度不设上限——移动端胶囊内容短，max-width 420px 用不到 */
.composer-status-bar.is-mobile .csb-capsule {
  height: 36px;
  border-radius: 10px;
}
/* 触屏没有 hover：胶囊不做悬停底色反馈，改用「面板打开」态表达（见下） */
.composer-status-bar.is-mobile .csb-capsule:hover {
  box-shadow: inset 0 0 0 999px transparent;
}
/* 展开中：胶囊描边转主色，用户能看出"这块点开过"（用组件态而非 :has，避免依赖选择器支持） */
.composer-status-bar.is-mobile.is-open .csb-capsule {
  border-color: var(--gd-color-primary);
}

/* 段内文字/计数随胶囊高度同步放大一档（13 → 14px），36px 高度里 13px 显得空 */
.composer-status-bar.is-mobile .csb-text,
.composer-status-bar.is-mobile .csb-count {
  font-size: 14px;
}
/* 段内按钮（目标暂停/恢复）命中区扩到 28px：16px 在触屏上点不准 */
.composer-status-bar.is-mobile .csb-goal-btn {
  width: 28px;
  height: 28px;
  margin: 0 -6px;
}

/* ── 面板：移动端改为铺满宽度的大面板，而不是 392px 的小浮层 ──
   手机上 392px 已接近满宽，但 max-height 340px 只够看三条，且左右各留 16px 边距后
   卡片区实际只剩 344px——标题折行后几乎都要两行。
   这里改成：宽度铺满视口（减 24px 安全边距）、高度取 60vh 但硬顶 420px，
   面板内部滚动，卡片保持两行布局。

   420px 上限不是随意定的：面板是 absolute 浮层，向上溢出部分会被
   .scroll-container（overflow: auto）裁掉。手机竖屏可视对话区通常 500-700px，
   减去输入区与胶囊后余量约 400-620px；420px 在所有常见机型上都放得下，
   而纯 60vh 在键盘弹起（vh 不含键盘）时会超出可用区。 */
.composer-status-bar.is-mobile .csb-panel {
  width: min(480px, calc(100vw - 24px));
  max-height: min(60vh, 420px);
  padding: 8px;
  /* 移动端没有"贴在胶囊正上方"的必要（胶囊常在屏幕中下部），
     保留向上弹出但允许越过视口顶部：由 max-height 兜住 */
  bottom: calc(100% + 8px);
}

/* 移动端卡片：字号放大一档，内边距四边同为 6px（比桌面多 2px 给触屏一点余量） */
.composer-status-bar.is-mobile .csb-task {
  padding: 6px;
  gap: 10px;
}
.composer-status-bar.is-mobile .csb-task-title {
  font-size: 14px;
  /* 14 × 20 = 280 整数 */
  line-height: 20px;
}
.composer-status-bar.is-mobile .csb-task-title--cmd {
  font-size: 13px;
  /* 13 × 18 = 234 整数 */
  line-height: 18px;
}
.composer-status-bar.is-mobile .csb-task-elapsed,
.composer-status-bar.is-mobile .csb-task-stopping {
  font-size: 12px;
  /* 12 × 16 = 192 整数 */
  line-height: 16px;
}

/* 停止按钮：触屏命中区抬到 32px（20px 太难点），文字同 12px */
.composer-status-bar.is-mobile .csb-task-stop {
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 16px;
  border-radius: 6px;
  /* 触屏没有 hover：常显一档极淡的底色，让"这是个按钮"可辨 */
  background: color-mix(in srgb, var(--gd-color-text) 6%, transparent);
}
/* 移动端没有 hover 态：禁用态之外一律用常显底色，不再有 hover 变红 */
.composer-status-bar.is-mobile .csb-task-stop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--gd-color-text) 6%, transparent);
  color: var(--gd-color-text-gray);
}
.composer-status-bar.is-mobile .csb-task-stop:active:not(:disabled) {
  background: color-mix(in srgb, var(--gd-color-danger) 14%, transparent);
  color: var(--gd-color-danger);
}
/* 触屏：按下时整卡给出反馈（替代 hover 底色） */
.composer-status-bar.is-mobile .csb-task--clickable:hover {
  background: transparent;
}
.composer-status-bar.is-mobile .csb-task--clickable:active {
  background: var(--gd-color-surface-hover);
}

/* 面板内的段标题同步放大一档 */
.composer-status-bar.is-mobile .csb-sec-head {
  font-size: 12px;
  line-height: 18px;
}
/* 面板内其余行（目标 / 待办）跟随放大，避免两段 13px、后台任务 14px 的割裂 */
.composer-status-bar.is-mobile .csb-row-text {
  font-size: 14px;
  line-height: 20px;
}
.composer-status-bar.is-mobile .csb-row-status,
.composer-status-bar.is-mobile .csb-elapsed {
  font-size: 12px;
  line-height: 16px;
}
.composer-status-bar.is-mobile .csb-row {
  padding: 5px 4px;
}
/* 目标清除 / 子代理列表入口：20px 图标按钮在触屏偏小，扩到 28px */
.composer-status-bar.is-mobile .csb-sec-btn {
  width: 28px;
  height: 28px;
}

</style>
