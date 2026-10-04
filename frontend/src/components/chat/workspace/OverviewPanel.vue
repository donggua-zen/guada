<template>
  <!-- 工作区概览：常驻于聊天内容右侧（占位挤宽），与 WorkspaceSidebar 解耦。
       数据源：GitStore（git 状态/统计/分支/提交弹窗）、browserWebview store、会话待办、后台进程。
       布局：分组标题 + 下属行（Git 工具 / 待办事项 / 后台进程 / 浏览器），默认平铺展开。 -->
  <aside class="overview-panel">
    <div class="overview-rows">
      <!-- ── Git 工具：默认隐藏，后端确认是 git 仓库才出现（非仓库/未装 git 不占位） ── -->
      <section v-if="git.isGitRepo" class="overview-section">
        <div class="overview-section-title">
          <span>{{ t('chat.workspace.sectionGit') }}</span>
          <!-- 聚合变更数上移标题栏并右对齐；点击打开 Git 审阅标签（替代原“Git 变更”行） -->
          <GdTooltip v-if="git.totalStats.add || git.totalStats.del" :content="t('git.title')" placement="bottom"
            class="ml-auto">
            <button class="flex gap-1 font-mono text-[12px] cursor-pointer bg-transparent border-0 p-0 hover:opacity-70"
              @click="openGit">
              <span v-if="git.totalStats.add" class="text-[#1a7f37] dark:text-[#3fb950]">+{{ git.totalStats.add }}</span>
              <span v-if="git.totalStats.del" class="text-[#cf222e] dark:text-[#f85149]">-{{ git.totalStats.del }}</span>
            </button>
          </GdTooltip>
          <span v-else-if="git.status?.gitUnavailable" class="ml-auto overview-row-value--empty text-[12px]">{{ t('git.notInstalled') }}</span>
          <span v-else-if="git.isGitRepo" class="ml-auto overview-row-value--empty text-[12px]">{{ t('git.noChanges') }}</span>
        </div>

        <!-- 分支：下拉切换（GitStore.checkout）；外层 .overview-dropdown 撑满整行，
             DropdownMenu 内部 inline-flex 默认收缩为内容宽 → 穿透设为 100% 与其他行一致 -->
        <div class="overview-dropdown">
          <DropdownMenu @command="git.checkout">
            <button class="overview-row" :disabled="!git.isGitRepo">
              <el-icon :size="16" class="overview-row-icon"><BranchFork16Regular /></el-icon>
              <span class="overview-row-label">{{ t('git.branch') }}</span>
              <span class="overview-row-value overview-row-value--branch">{{ git.selectedBranch || '-' }}</span>
              <el-icon :size="12" class="overview-row-chevron"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <div class="overview-branch-menu">
                <DropdownMenuItem v-for="b in git.branches" :key="b.name" :command="b.name">
                  <span class="overview-branch-item">
                    <span class="overview-branch-check">{{ b.current ? '✓' : '' }}</span>
                    <span class="overview-branch-name">{{ b.name }}</span>
                  </span>
                </DropdownMenuItem>
              </div>
            </template>
          </DropdownMenu>
        </div>

        <!-- 提交或推送：打开全局提交弹窗（GitCommitDialog） -->
        <button class="overview-row" :disabled="!git.isGitRepo" @click="git.openCommitDialog()">
          <el-icon :size="16" class="overview-row-icon"><ArrowUpload16Regular /></el-icon>
          <span class="overview-row-label">{{ t('git.commitOrPush') }}</span>
        </button>
      </section>

      <!-- ── 后台进程：运行中的后台命令；点击行打开日志标签，行尾关闭按钮终止进程 ── -->
      <!-- 待办事项分区已迁移至对话流下方（SessionTodoCard，ChatPanel 内 v-for 之后） -->
      <!-- 工作目录区块已迁移至输入框底部外侧（WorkingDirBar，ChatPanel 输入列内） -->
      <section v-if="processes.length" class="overview-section">
        <div class="overview-section-title">
          <span>{{ t('chat.workspace.processes') }}</span>
          <span class="overview-section-count ml-auto">{{ processes.length }}</span>
        </div>
        <div class="overview-process-list">
          <GdTooltip v-for="p in processes" :key="p.id" :content="p.command" placement="bottom">
            <div class="overview-process-item w-full" @click="openProcessLog(p)">
              <span class="overview-process-spinner"></span>
              <span class="overview-process-cmd">{{ shortCommand(p.command) }}</span>
              <span class="overview-process-elapsed">{{ elapsedText(p.startedAt) }}</span>
              <GdTooltip :content="t('chat.workspace.killProcess')" placement="bottom">
                <button class="overview-process-kill" @click.stop="killProcess(p)">
                  <el-icon :size="10"><Close /></el-icon>
                </button>
              </GdTooltip>
            </div>
          </GdTooltip>
        </div>
      </section>

      <!-- ── 子代理：活跃行平铺；已冻结（close / one_shot 结束，仅供回放）收进"已结束"折叠组。
           数据源为 ChatPage 维护的 subSessions（SSE 增改 + fetchSession 基线）props 下传，
           运行状态直接读 sessionStore.streamStatus（与侧边栏标签运行点同源） ── -->
      <section v-if="subagentItems.length" class="overview-section">
        <div class="overview-section-title">
          <span>{{ t('chat.workspace.subagents') }}</span>
          <span v-if="runningSubagentCount" class="overview-section-count">{{ runningSubagentCount }}</span>
        </div>
        <div class="overview-subagent-list">
          <GdTooltip v-for="item in activeSubagents" :key="item.id" :content="item.title" placement="bottom">
            <div class="overview-subagent w-full" @click="openSubAgent(item.id)">
              <span class="wf-dot wf-dot--sm" :class="subagentDotClass(item)">
                <span v-if="item.status === 'running'" class="wf-dot-pulse"></span>
              </span>
              <img v-if="item.avatarUrl" :src="item.avatarUrl" class="overview-subagent-avatar" alt="" />
              <span class="overview-subagent-name">{{ item.title }}</span>
              <span class="overview-subagent-status">{{ subagentStatusText(item) }}</span>
            </div>
          </GdTooltip>
          <!-- 已结束（冻结）折叠组：默认收起，展开后点击行回放只读会话 -->
          <template v-if="frozenSubagents.length">
            <button class="overview-subagent-ended" @click="endedExpanded = !endedExpanded">
              <el-icon :size="10" class="overview-subagent-chevron" :class="{ 'is-open': endedExpanded }"><ArrowDown /></el-icon>
              <span>{{ t('chat.workspace.subagentsEnded', { count: frozenSubagents.length }) }}</span>
            </button>
            <template v-if="endedExpanded">
              <GdTooltip v-for="item in frozenSubagents" :key="item.id" :content="item.title" placement="bottom">
                <div class="overview-subagent overview-subagent--frozen w-full" @click="openSubAgent(item.id)">
                  <span class="wf-dot wf-dot--sm" :class="subagentDotClass(item)"></span>
                  <img v-if="item.avatarUrl" :src="item.avatarUrl" class="overview-subagent-avatar" alt="" />
                  <span class="overview-subagent-name">{{ item.title }}</span>
                  <span class="overview-subagent-status">{{ subagentStatusText(item) }}</span>
                </div>
              </GdTooltip>
            </template>
          </template>
        </div>
      </section>

      <!-- ── 工作流运行：引擎内存快照 + workflow_event SSE 实时推进（进度不落 JSONL）。
           紧凑树形列表（对齐 DSH 任务管理风格）：run 行 = 状态点 + 名称 + 进度/耗时；
           成员行 = 状态点 + 标签，次行摘要 · 状态；点击成员跳转子会话 ── -->
      <section v-if="workflowRuns.length" class="overview-section">
        <div class="overview-section-title overview-title-row">
          <span>{{ t('chat.workspace.workflowRuns') }}</span>
          <!-- 常驻入口：工作流审阅标签（历史成员/日志/返回值详览） -->
          <button class="overview-title-icon-btn" :title="t('chat.workspace.workflowTab')" @click="openWorkflowReview">
            <el-icon :size="14"><Flowchart20Regular /></el-icon>
          </button>
        </div>
        <div class="overview-workflow-list">
          <div v-for="run in visibleWorkflowRuns" :key="run.runId" class="wf-run">
            <GdTooltip :content="run.name || run.runId" placement="bottom">
              <div class="wf-run-row w-full" @click="toggleRunExpand(run.runId)">
                <span class="wf-dot" :class="`wf-dot--${run.status}`">
                  <span v-if="run.status === 'running'" class="wf-dot-pulse"></span>
                </span>
                <svg class="wf-chevron" :class="{ 'is-open': isRunExpanded(run) }" width="11" height="11"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span class="wf-run-name">{{ run.name || run.runId }}</span>
                <span class="wf-run-meta">{{ runMetaText(run) }}</span>
              </div>
            </GdTooltip>
            <div v-if="isRunExpanded(run) && run.agents.length" class="wf-agents">
              <GdTooltip v-for="agent in run.agents" :key="agent.callId" :content="agent.label" placement="bottom">
                <div class="wf-agent w-full"
                  :class="{ 'wf-agent--clickable': !!agent.subSessionId }"
                  @click="agent.subSessionId && openSubAgent(agent.subSessionId)">
                  <div class="wf-agent-row">
                    <span class="wf-dot wf-dot--sm" :class="`wf-dot--${agent.status}`"></span>
                    <span class="wf-agent-label">{{ agent.label }}</span>
                  </div>
                  <div class="wf-agent-sub">{{ agentSubText(agent) }}</div>
                </div>
              </GdTooltip>
            </div>
          </div>
        </div>
        <!-- 历史收敛：概览只显示最近 N 条，完整审阅（成员/日志/结果）进工作流标签 -->
        <button v-if="sortedWorkflowRuns.length > visibleWorkflowRuns.length" class="wf-view-all"
          @click="openWorkflowReview">
          {{ t('chat.workspace.workflowViewAll', { count: sortedWorkflowRuns.length }) }}
        </button>
      </section>

      <!-- ── 浏览器：有窗口才显示；点击窗口激活（打开工作区预览并切换） ── -->
      <section v-if="browserWindows.length" class="overview-section">
        <div class="overview-section-title">{{ t('chat.workspace.browser') }}</div>
        <div class="overview-browser-list">
          <button v-for="w in browserWindows" :key="w.windowId" class="overview-browser-tab"
            @click="activateBrowser(w.windowId)">
            <span class="overview-browser-favicon">{{ (w.title || '?').slice(0, 1) }}</span>
            <span class="overview-browser-title">{{ w.title || t('chat.workspace.unnamedWindow') }}</span>
          </button>
          <button class="overview-browser-new" @click="createBrowser">
            <el-icon :size="14"><Add16Regular /></el-icon>
            <span>{{ t('chat.workspace.newTab') }}</span>
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { ArrowDown, Close } from "@element-plus/icons-vue";
import {
  BranchFork16Regular, ArrowUpload16Regular,
  Add16Regular,
  Flowchart20Regular,
} from "@vicons/fluent";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import DropdownMenuItem from "../../ui/DropdownMenuItem.vue";
import GdTooltip from "../../ui/GdTooltip.vue";
import { useGitStore } from "@/stores/git";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { apiService, type UiProcessInfo } from "@/services/ApiService";
import { applyWorkflowEvent, sortWorkflowRuns } from "@/services/modules/workflowRuns";
import { streamEventHub, type HubStreamEvent } from "@/services/modules/StreamEventHub";
import { useSessionStore } from "@/stores/session";
import type { Session } from "@/types/session";
import type { WorkflowRunState, WorkflowAgentState, WorkflowMemberStatus } from "@/types/stream/workflow.types";

const { t } = useI18n();
const props = defineProps<{
  sessionId: string | null;
  /** 子会话列表（ChatPage 维护：SSE sub_agent_create/closed 增改 + fetchSession 基线，含已冻结的） */
  subSessions?: Session[];
}>();

const git = useGitStore();
const tabStore = useTabStore();
const layoutStore = useLayoutStore();
const browserStore = useBrowserWebviewStore();
const sessionStore = useSessionStore();

// 工作目录分组（主目录展示 + 附加远程目录绑定管理）已迁移至输入框底部外侧的 WorkingDirBar

// ── 后台进程（shell 插件 run_command 转后台的运行中进程）──
const processes = ref<UiProcessInfo[]>([]);
/** 时长显示的秒级心跳（仅驱动 elapsedText 重算） */
const nowTick = ref(Date.now());
let unsubscribeProcessChanged: (() => void) | null = null;
let unsubscribeWorkflowStream: (() => void) | null = null;
let elapsedTimer: number | null = null;

async function loadProcesses(): Promise<void> {
  if (!props.sessionId) {
    processes.value = [];
    return;
  }
  try {
    const res = await apiService.getSessionProcesses(props.sessionId);
    processes.value = res.processes || [];
  } catch {
    processes.value = [];
  }
}

function shortCommand(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > 42 ? oneLine.slice(0, 42) + "…" : oneLine;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, "0")}s`;
  const hour = Math.floor(min / 60);
  return `${hour}h ${String(min % 60).padStart(2, "0")}m`;
}

function elapsedText(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "";
  return formatDuration(Math.max(0, nowTick.value - start));
}

async function killProcess(p: UiProcessInfo): Promise<void> {
  if (!props.sessionId) return;
  try {
    await apiService.killSessionProcess(props.sessionId, p.id);
    ElMessage.success(t("chat.workspace.processKilledToast"));
  } catch (e: any) {
    if (e?.response?.status !== 404) {
      console.error("Failed to kill process:", e);
      ElMessage.error(t("chat.workspace.processKillFailed"));
    }
  }
  void loadProcesses();
}

function openProcessLog(p: UiProcessInfo): void {
  if (!props.sessionId) return;
  layoutStore.setWorkspaceVisible(true);
  nextTick(() => {
    tabStore.openProcessLogTab(props.sessionId!, p.id, p.command);
  });
}

// ── 浏览器（声明需在 session watcher 之前：immediate watcher 同步访问） ──
/** 当前会话的浏览器窗口列表（browserStore 已按会话过滤） */
const browserWindows = computed(() => browserStore.sessionWebviews);

// ── 工作流运行（方案 B：进度不落 JSONL；REST 快照为基线，workflow_event SSE 为增量，
//    两源喂 workflowRuns.ts 的同一 reducer，按 run 内 seq 幂等收敛） ──
const workflowRuns = ref<WorkflowRunState[]>([]);
/** 运行中在前，完成后按结束时间倒序 */
const sortedWorkflowRuns = computed(() => sortWorkflowRuns(workflowRuns.value));
/** 概览只显示最近 5 条；完整历史进工作流审阅标签 */
const OVERVIEW_WORKFLOW_LIMIT = 5;
const visibleWorkflowRuns = computed(() => sortedWorkflowRuns.value.slice(0, OVERVIEW_WORKFLOW_LIMIT));

/** run 行展开态：undefined = 自动（仅运行中展开，完成/失败/取消一律收起），手动切换后以手动为准 */
const runExpandOverrides = ref<Record<string, boolean>>({});

function isRunExpanded(run: WorkflowRunState): boolean {
  const override = runExpandOverrides.value[run.runId];
  return override !== undefined ? override : run.status === "running";
}

function toggleRunExpand(runId: string): void {
  const run = workflowRuns.value.find((r) => r.runId === runId);
  if (!run) return;
  runExpandOverrides.value[runId] = !isRunExpanded(run);
}

/** 概览「查看全部」→ 打开工作流审阅标签（侧边栏，per-session） */
function openWorkflowReview(): void {
  const sessionId = props.sessionId;
  if (!sessionId) return;
  layoutStore.setWorkspaceVisible(true);
  nextTick(() => tabStore.openWorkflowTab(sessionId));
}

async function loadWorkflowRuns(): Promise<void> {
  if (!props.sessionId) {
    workflowRuns.value = [];
    return;
  }
  try {
    const res = await apiService.getWorkflowRuns(props.sessionId);
    workflowRuns.value = res.runs || [];
  } catch {
    // 端点不可用（旧后端/无运行记录）→ 静默置空
    workflowRuns.value = [];
  }
}

function handleStreamChunk(chunk: HubStreamEvent): void {
  if (chunk.type !== "workflow_event") return;
  const sid = (chunk as any).sessionId;
  if (!props.sessionId || sid !== props.sessionId) return;
  // 原位应用（响应式 mutation 驱动 computed 重排）
  applyWorkflowEvent(workflowRuns.value, (chunk as any).event);
}

/** 成员行点击 → 跳转子代理会话（复用 ChatPage provide；运行中/已知 subSessionId 才可点） */
const openSubAgent = inject<(subSessionId: string) => void>(
  "workspace:openSubAgentSession",
  () => {},
);

// ── 子代理（props.subSessions 驱动；运行状态读 streamStatus，与侧边栏标签运行点同源）──
interface SubagentItem {
  id: string;
  title: string;
  avatarUrl?: string | null;
  /** 已冻结（close / one_shot 结束，后端 closedAt 标记）：收进"已结束"折叠组，仅供回放 */
  frozen: boolean;
  status: "running" | "completed" | "error";
}

/** 已结束折叠组展开态（默认收起，避免列表无限增长挤占概览） */
const endedExpanded = ref(false);

const subagentItems = computed<SubagentItem[]>(() =>
  (props.subSessions ?? [])
    // workflow 成员子代理不进本区：其进度/状态/跳转由下方"工作流运行"区按 run 组织展示，
    // 且该类子代理为 persist 生命周期永不 close，不过滤会让列表无限增长
    .filter((s) => !s.settings?.workflow?.runId)
    .map((s) => {
      const streamStatus = sessionStore.peekStreamStatus(s.id);
      return {
        id: s.id,
        title: s.title || t("chat.workspace.subagentTab"),
        avatarUrl: s.avatarUrl || s.agent?.avatarUrl || null,
        frozen: !!s.closedAt,
        status:
          streamStatus === "running"
            ? ("running" as const)
            : streamStatus === "error"
              ? ("error" as const)
              : ("completed" as const),
      };
    }),
);

/** 活跃在前、冻结在后（各自保持创建顺序） */
const activeSubagents = computed(() => subagentItems.value.filter((i) => !i.frozen));
const frozenSubagents = computed(() => subagentItems.value.filter((i) => i.frozen));
const runningSubagentCount = computed(
  () => subagentItems.value.filter((i) => !i.frozen && i.status === "running").length,
);

function subagentDotClass(item: SubagentItem): string {
  if (item.status === "running") return "wf-dot--running";
  if (item.status === "error") return "wf-dot--failed";
  return "wf-dot--completed";
}

function subagentStatusText(item: SubagentItem): string {
  if (item.status === "error") return t("chat.workspace.wfFailed");
  if (item.status === "running") return t("chat.workspace.wfRunning");
  return t("chat.workspace.wfCompleted");
}

function statusText(status: WorkflowMemberStatus): string {
  const map: Record<WorkflowMemberStatus, string> = {
    running: t("chat.workspace.wfRunning"),
    completed: t("chat.workspace.wfCompleted"),
    failed: t("chat.workspace.wfFailed"),
    cancelled: t("chat.workspace.wfCancelled"),
  };
  return map[status] ?? status;
}

/** run 行右侧：运行中显示成员进度 x/y，结束后显示耗时 */
function runMetaText(run: WorkflowRunState): string {
  if (run.status === "running") {
    if (run.agents.length === 0) return t("chat.workspace.wfStarting");
    const active = run.agents.filter((a) => a.status === "running").length;
    return `${run.agents.length - active}/${run.agents.length}`;
  }
  if (run.durationMs !== undefined) return formatDuration(run.durationMs);
  return statusText(run.status);
}

/** 成员次行：摘要（截断）· 状态 */
function agentSubText(agent: WorkflowAgentState): string {
  const summary = (agent.outputSummary || "").replace(/\s+/g, " ").trim();
  const truncated = summary.length > 40 ? summary.slice(0, 40) + "…" : summary;
  return truncated ? `${truncated} · ${statusText(agent.status)}` : statusText(agent.status);
}

// 浏览器 store → tabStore 同步已迁移至 BrowserWebviewLayer（MainLayout 常驻层）：
// 概览面板是条件渲染（asideWidth>0 才挂载），概览折叠/宽度不足时此处 watch 失效，
// 会导致浏览器标签不出现；BrowserWebviewLayer 常驻，同步不会断。

// ── 会话绑定：git 数据与事件订阅由 GitStore 管理（bindSession 订阅 git scope），
//    workspace SSE 连接由 MainLayout 持有 —— 本组件仅展示，不参与连接/订阅生命周期。
watch(
  () => props.sessionId,
  (id) => {
    git.bindSession(id);
    endedExpanded.value = false;
    void loadProcesses();
    void loadWorkflowRuns();
  },
  { immediate: true },
);

onMounted(() => {
  unsubscribeProcessChanged = apiService.onSessionEvent("process_changed", (event) => {
    if (event.sessionId === props.sessionId) loadProcesses();
  });
  unsubscribeWorkflowStream = streamEventHub.subscribeAll(handleStreamChunk);
  elapsedTimer = window.setInterval(() => { nowTick.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  unsubscribeProcessChanged?.();
  unsubscribeProcessChanged = null;
  unsubscribeWorkflowStream?.();
  unsubscribeWorkflowStream = null;
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
});

function openGit(): void {
  layoutStore.setWorkspaceVisible(true);
  // 显示完全由激活标签驱动：打开 Git 审阅标签
  nextTick(() => tabStore.openGitTab());
}

function activateBrowser(windowId: string): void {
  layoutStore.setWorkspaceVisible(true);
  nextTick(() => {
    tabStore.selectTab(`browser:${windowId}`);
  });
}

async function createBrowser(): Promise<void> {
  if (!window.electronAPI || !props.sessionId) return;
  try {
    const result = await window.electronAPI.createBrowserWindow("about:blank", {
      sessionId: props.sessionId,
      createdBy: props.sessionId,
    });
    const windowId = result.window?.windowId;
    if (result.success && windowId) {
      layoutStore.setWorkspaceVisible(true);
      nextTick(() => {
        tabStore.selectTab(`browser:${windowId}`);
      });
    }
  } catch (e) {
    console.error("Failed to create browser window:", e);
  }
}
</script>

<style scoped>
.overview-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  /* 卡片感原语默认融入背景；主题自定义见 style.css --gd-overview-panel-* */
  background: var(--gd-overview-panel-bg);
  border: 1px solid var(--gd-overview-panel-border-color);
  border-radius: var(--gd-size-overview-panel-radius);
  overflow: hidden;
}

/* 标题行（含「重新检测」按钮）已移除：面板常驻悬浮在聊天列右侧，
   git 状态由 watcher + SSE 驱动，标题行只是重复占位。需要手动重检时恢复此块即可：
   .overview-header / .overview-title / .overview-header-actions / .overview-collapse-btn
   + 模板里的标题行 + ArrowSync20Regular 导入（git.refresh 的唯一入口） */

/* 行列表：高度随内容自适应（悬浮卡片），超高时内部滚动；
   顶部内边距承担原标题行让出的呼吸感 */
.overview-rows {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
  padding: 5px 4px 6px;
  display: flex;
  flex-direction: column;
}

/* ── 分组：标题 + 下属行；分组间以细分割线分隔（首组紧随头部分割线，无额外线） ── */
.overview-section {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 5px;
}
.overview-section + .overview-section {
  margin-top: 6px;
  padding-top: 7px;
  position: relative;
}
.overview-section + .overview-section::before {
  content: "";
  position: absolute;
  top: 0;
  left: 4px;
  right: 4px;
  height: 1px;
  background: var(--gd-color-surface-border);
}
.overview-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 3px;
  font-size: var(--gd-size-text-base);
  font-weight: 400;
  color: var(--gd-color-text-disabled);
  line-height: 1.2;
}
.overview-section-count {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--gd-color-success);
}

/* 单行（简约风格：icon + 标签 + 右侧值/chevron） */
.overview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text);
  font-size: var(--gd-size-text-sm);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.overview-row:hover:not(:disabled) {
  background: var(--gd-color-sidebar-bg-hover);
}
.overview-row:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.overview-row-icon {
  color: var(--gd-color-text-gray);
  flex-shrink: 0;
}
.overview-row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-row-value {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--gd-size-text-sm);
  color: var(--gd-color-text);
}
.overview-row-value--branch {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gd-size-text-sm);
}
.overview-row-value--empty {
  color: var(--gd-color-text-disabled);
}
.overview-row-chevron {
  color: var(--gd-color-text-disabled);
  flex-shrink: 0;
}

/* 分支下拉行：外层撑满，穿透 DropdownMenu 内部 inline-flex（否则收缩为内容宽） */
.overview-dropdown {
  width: 100%;
}
.overview-dropdown :deep(.inline-flex) {
  width: 100%;
}

/* 分支下拉 */
.overview-branch-menu {
  max-height: 260px;
  overflow-y: auto;
}
.overview-branch-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 140px;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--gd-size-text-sm);
}
.overview-branch-check {
  width: 12px;
  flex-shrink: 0;
  color: var(--gd-color-primary);
}
.overview-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 待办列表样式段已随分区迁移至 SessionTodoCard（对话流下方）；
   @keyframes overview-spin 保留：process-spinner 仍引用 */
@keyframes overview-spin {
  to { transform: rotate(360deg); }
}

/* 后台进程列表（平铺展开） */
.overview-process-list {
  display: flex;
  flex-direction: column;
  padding: 1px 2px 2px 4px;
  gap: 1px;
}
.overview-process-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 2px;
  border-radius: 4px;
  cursor: pointer;
}
.overview-process-item:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.overview-process-spinner {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--gd-color-primary-200);
  border-top-color: var(--gd-color-primary);
  border-radius: 50%;
  animation: overview-spin 0.8s linear infinite;
  flex-shrink: 0;
}
.overview-process-cmd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--gd-size-text-base);
  color: var(--gd-color-text-gray);
}
.overview-process-item:hover .overview-process-cmd {
  color: var(--gd-color-text);
}
.overview-process-elapsed {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}
.overview-process-kill {
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
.overview-process-item:hover .overview-process-kill {
  opacity: 1;
}
.overview-process-kill:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* 工作流运行：紧凑树形列表（run 行 + 缩进成员行，对齐 DSH 任务管理风格） */
.overview-workflow-list {
  display: flex;
  flex-direction: column;
  padding: 1px 2px 2px;
}
.wf-run + .wf-run {
  margin-top: 6px;
}
.wf-run-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 2px;
  min-width: 0;
  cursor: pointer;
  border-radius: 4px;
}
.wf-run-row:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.wf-chevron {
  flex-shrink: 0;
  color: var(--gd-color-text-disabled);
  transition: transform 0.15s ease;
}
.wf-chevron.is-open {
  transform: rotate(90deg);
}
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
  border: 1.5px solid var(--gd-color-success, #22c55e);
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
.wf-run-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gd-size-text-base);
  font-weight: 500;
  color: var(--gd-color-text);
}
.wf-run-meta {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}
.wf-agents {
  margin: 2px 0 0 0;
  display: flex;
  flex-direction: column;
}
.wf-agent {
  position: relative;
  /* 与标题行同宽同起点；左内边距容纳树形线列（线对齐标题行圆点下方） */
  padding: 2px 2px 2px 24px;
  border-radius: 4px;
}
/* GdTooltip 渲染 inline trigger 包装器：撑满行宽，hover 背景才铺满而非仅包内容 */
.wf-run > .l-tooltip__trigger,
.wf-agents > .l-tooltip__trigger {
  display: block;
  width: 100%;
}
/* 成员行树形线（对齐 DSH 任务管理）：竖线画在行盒内部（hover 含线列），
   横肘线连到圆点；run 标题行无线；末成员竖线止于横肘。
   注意 :last-child 须取在 GdTooltip 包装层上（每个 .wf-agent 都是其包装器的唯一子元素） */
.wf-agent::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  border-left: 1px solid var(--gd-color-border, #e5e7eb);
}
.wf-agents > :last-child .wf-agent::before {
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
  font-size: var(--gd-size-text-base);
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
/* 查看全部（进工作流审阅标签） */
.wf-view-all {
  margin: 2px 2px 0;
  padding: 1px 2px;
  border: none;
  background: transparent;
  font-size: 11px;
  color: var(--gd-color-primary, var(--gd-color-text-gray));
  cursor: pointer;
  text-align: left;
}
.wf-view-all:hover {
  text-decoration: underline;
}
/* 标题行 + 常驻审阅入口按钮 */
.overview-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
/* 分区标题行右对齐图标按钮（工作流审阅入口 / 添加附加目录等共享） */
.overview-title-icon-btn {
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
.overview-title-icon-btn:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-sidebar-bg-hover);
}

/* 子代理列表（平铺行；已冻结行收进"已结束"折叠组内缩进展示） */
.overview-subagent-list {
  display: flex;
  flex-direction: column;
  padding: 1px 2px 2px;
}
.overview-subagent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px;
  border-radius: 4px;
  cursor: pointer;
  min-width: 0;
}
.overview-subagent:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.overview-subagent-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.overview-subagent-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gd-size-text-base);
  color: var(--gd-color-text);
}
.overview-subagent--frozen .overview-subagent-name {
  color: var(--gd-color-text-gray);
}
.overview-subagent-status {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}
.overview-subagent-ended {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 1px 0;
  padding: 1px 2px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--gd-color-text-gray);
  text-align: left;
}
.overview-subagent-ended:hover {
  color: var(--gd-color-text);
}
.overview-subagent-chevron {
  transition: transform 0.15s;
}
.overview-subagent-chevron.is-open {
  transform: rotate(180deg);
}
.overview-subagent--frozen {
  margin-left: 7px;
}

/* 浏览器列表（平铺展开） */
.overview-browser-list {
  display: flex;
  flex-direction: column;
  padding: 1px 2px 2px 4px;
  gap: 1px;
}
.overview-browser-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-gray);
  font-size: var(--gd-size-text-base);
  cursor: pointer;
  text-align: left;
}
.overview-browser-tab:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}
.overview-browser-favicon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--gd-color-surface-hover);
  font-size: 9px;
  font-weight: 600;
  color: var(--gd-color-text-gray);
  flex-shrink: 0;
}
.overview-browser-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-browser-new {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-disabled);
  font-size: var(--gd-size-text-base);
  cursor: pointer;
}
.overview-browser-new:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-sidebar-bg-hover);
}
</style>
