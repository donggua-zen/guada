<template>
  <!-- 工作区概览：常驻于聊天内容右侧（占位挤宽），与 WorkspaceSidebar 解耦。
       数据源：GitStore（git 状态/统计/分支/提交弹窗）、browserWebview store、会话待办、后台进程。
       布局：分组标题 + 下属行（Git 工具 / 待办事项 / 后台进程 / 浏览器），默认平铺展开。 -->
  <aside class="overview-panel shadow">
    <!-- 标题行 -->
    <div class="overview-header">
      <span class="overview-title">{{ t('git.overviewTitle') }}</span>
      <div class="overview-header-actions">
        <!-- 重新检测：手动刷新 git 状态（覆盖 git init / 仓库状态变化等 watcher 无法感知的场景） -->
        <GdTooltip :content="t('git.refresh')" placement="bottom">
          <button class="overview-collapse-btn" :disabled="git.refreshing" @click="git.refresh()">
            <el-icon :size="14" :class="{ 'is-loading': git.refreshing }"><ArrowSync20Regular /></el-icon>
          </button>
        </GdTooltip>
        <GdTooltip :content="t('chat.workspace.collapseOverview')" placement="bottom">
          <button class="overview-collapse-btn" @click="emit('collapse')">
            <el-icon :size="14"><Dismiss16Regular /></el-icon>
          </button>
        </GdTooltip>
      </div>
    </div>

    <div class="overview-rows">
      <!-- ── Git 工具 ── -->
      <section class="overview-section">
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

      <!-- ── 工作目录：主目录（不可删改，点击打开工作区）+ 附加目录（远程连接绑定，增删走
           session.settings.attachments["ssh-connection"]，后端下回合 diff 注入生效） ── -->
      <section class="overview-section">
        <div class="overview-section-title">{{ t('chat.workspace.workingDir') }}</div>

        <!-- 主目录：展示 basename，tooltip 完整路径；点击打开工作区面板（目录树） -->
        <GdTooltip :content="mainWorkspacePath || t('chat.workspace.workingDir')" placement="bottom">
          <button class="overview-row" @click="openWorkspaceTree">
            <el-icon :size="16" class="overview-row-icon"><Folder16Regular /></el-icon>
            <span class="overview-row-label">{{ mainWorkspaceBasename || t('chat.workspace.workingDir') }}</span>
          </button>
        </GdTooltip>

        <!-- 附加目录：已绑定的远程连接；hover 显示解除按钮（对齐后台进程行的 kill 样式） -->
        <GdTooltip v-for="conn in attachedConnections" :key="conn.id"
          :content="conn.description || conn.name" placement="bottom">
          <div class="overview-row overview-attach-row">
            <el-icon :size="16" class="overview-row-icon"><Cloud16Regular /></el-icon>
            <span class="overview-row-label">{{ conn.name }}</span>
            <GdTooltip :content="t('chat.workspace.removeAttachedDir')" placement="bottom">
              <button class="overview-attach-remove" @click.stop="removeAttached(conn.id)">
                <el-icon :size="10"><Close /></el-icon>
              </button>
            </GdTooltip>
          </div>
        </GdTooltip>

        <!-- 添加附加目录：下拉列出 remote-workspace 全部连接（✓ 为已绑定）；无连接时引导去设置页 -->
        <div class="overview-dropdown">
          <DropdownMenu @command="handleAttachedCommand">
            <button class="overview-row">
              <el-icon :size="16" class="overview-row-icon"><Add16Regular /></el-icon>
              <span class="overview-row-label">{{ t('chat.workspace.addAttachedDir') }}</span>
            </button>
            <template #dropdown>
              <div class="overview-branch-menu">
                <template v-if="availableConnections.length">
                  <DropdownMenuItem v-for="c in availableConnections" :key="c.id" :command="c.id">
                    <span class="overview-branch-item">
                      <span class="overview-branch-check">{{ attachedIds.includes(c.id) ? '✓' : '' }}</span>
                      <span class="overview-branch-name">{{ c.name }}</span>
                    </span>
                  </DropdownMenuItem>
                </template>
                <DropdownMenuItem v-else :command="OPEN_SETTINGS_COMMAND">
                  <span class="overview-branch-item">
                    <span class="overview-branch-name">{{ t('chat.workspace.noConnections') }}</span>
                  </span>
                </DropdownMenuItem>
              </div>
            </template>
          </DropdownMenu>
        </div>
      </section>

      <!-- ── 待办事项：无待办不显示，平铺展示全部条目 ── -->
      <section v-if="todoItems.length" class="overview-section">
        <div class="overview-section-title">
          <span>{{ t('chat.workspace.todoList') }}</span>
          <span v-if="todoDoneCount" class="overview-section-count ml-auto">{{ todoDoneCount }}/{{ todoItems.length }}</span>
        </div>
        <div class="overview-todo-list">
          <div v-for="(item, i) in todoItems" :key="i" class="overview-todo-item py-[3px]"
            :class="{ done: item.status === 'completed', active: item.status === 'in_progress' }">
            <span class="overview-todo-dot">
              <el-icon v-if="item.status === 'completed'" class="overview-todo-check"><Check /></el-icon>
              <el-icon v-else-if="item.status === 'in_progress'" class="overview-todo-arrow"><ArrowRight16Regular /></el-icon>
              <span v-else class="overview-todo-ring"></span>
            </span>
            <GdTooltip :content="item.content" placement="bottom" class="min-w-0">
              <span class="overview-todo-text min-w-0">{{ item.content }}</span>
            </GdTooltip>
          </div>
        </div>
      </section>

      <!-- ── 后台进程：运行中的后台命令；点击行打开日志标签，行尾关闭按钮终止进程 ── -->
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
          <div v-for="item in activeSubagents" :key="item.id" class="overview-subagent" :title="item.title"
            @click="openSubAgent(item.id)">
            <span class="wf-dot wf-dot--sm" :class="subagentDotClass(item)">
              <span v-if="item.status === 'running'" class="wf-dot-pulse"></span>
            </span>
            <img v-if="item.avatarUrl" :src="item.avatarUrl" class="overview-subagent-avatar" alt="" />
            <span class="overview-subagent-name">{{ item.title }}</span>
            <span class="overview-subagent-status">{{ subagentStatusText(item) }}</span>
          </div>
          <!-- 已结束（冻结）折叠组：默认收起，展开后点击行回放只读会话 -->
          <template v-if="frozenSubagents.length">
            <button class="overview-subagent-ended" @click="endedExpanded = !endedExpanded">
              <el-icon :size="10" class="overview-subagent-chevron" :class="{ 'is-open': endedExpanded }"><ArrowDown /></el-icon>
              <span>{{ t('chat.workspace.subagentsEnded', { count: frozenSubagents.length }) }}</span>
            </button>
            <template v-if="endedExpanded">
              <div v-for="item in frozenSubagents" :key="item.id"
                class="overview-subagent overview-subagent--frozen" :title="item.title"
                @click="openSubAgent(item.id)">
                <span class="wf-dot wf-dot--sm" :class="subagentDotClass(item)"></span>
                <img v-if="item.avatarUrl" :src="item.avatarUrl" class="overview-subagent-avatar" alt="" />
                <span class="overview-subagent-name">{{ item.title }}</span>
                <span class="overview-subagent-status">{{ subagentStatusText(item) }}</span>
              </div>
            </template>
          </template>
        </div>
      </section>

      <!-- ── 工作流运行：引擎内存快照 + workflow_event SSE 实时推进（进度不落 JSONL）。
           紧凑树形列表（对齐 DSH 任务管理风格）：run 行 = 状态点 + 名称 + 进度/耗时；
           成员行 = 状态点 + 标签，次行摘要 · 状态；点击成员跳转子会话 ── -->
      <section v-if="workflowRuns.length" class="overview-section">
        <div class="overview-section-title">{{ t('chat.workspace.workflowRuns') }}</div>
        <div class="overview-workflow-list">
          <div v-for="run in sortedWorkflowRuns" :key="run.runId" class="wf-run">
            <div class="wf-run-row" :title="run.name || run.runId">
              <span class="wf-dot" :class="`wf-dot--${run.status}`">
                <span v-if="run.status === 'running'" class="wf-dot-pulse"></span>
              </span>
              <span class="wf-run-name">{{ run.name || run.runId }}</span>
              <span class="wf-run-meta">{{ runMetaText(run) }}</span>
            </div>
            <div v-if="run.agents.length" class="wf-agents">
              <div v-for="agent in run.agents" :key="agent.callId" class="wf-agent"
                :class="{ 'wf-agent--clickable': !!agent.subSessionId }"
                :title="agent.label"
                @click="agent.subSessionId && openSubAgent(agent.subSessionId)">
                <div class="wf-agent-row">
                  <span class="wf-dot wf-dot--sm" :class="`wf-dot--${agent.status}`"></span>
                  <span class="wf-agent-label">{{ agent.label }}</span>
                </div>
                <div class="wf-agent-sub">{{ agentSubText(agent) }}</div>
              </div>
            </div>
          </div>
        </div>
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
            <el-icon :size="12"><Add16Regular /></el-icon>
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
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowDown, Check, Close } from "@element-plus/icons-vue";
import {
  BranchFork16Regular, ArrowUpload16Regular, Folder16Regular,
  Dismiss16Regular, Add16Regular,
  ArrowSync20Regular, ArrowRight16Regular, Cloud16Regular,
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
const router = useRouter();
const props = defineProps<{
  sessionId: string | null;
  /** 子会话列表（ChatPage 维护：SSE sub_agent_create/closed 增改 + fetchSession 基线，含已冻结的） */
  subSessions?: Session[];
  /** 主会话的附件绑定（mainSession.settings.attachments，ChatPage 单向下传；增删经事件上行） */
  attachments?: Record<string, string[]>;
}>();
const emit = defineEmits<{
  collapse: [];
  /** 附加工作目录绑定变更（ChatPage 写回 mainSession.settings 并 PUT 持久化） */
  attachmentsChange: [attachments: Record<string, string[]>];
}>();

const git = useGitStore();
const tabStore = useTabStore();
const layoutStore = useLayoutStore();
const browserStore = useBrowserWebviewStore();
const sessionStore = useSessionStore();

// ── 待办（环境初始化）：复用 SessionTodoList 的数据源与事件订阅 ──
interface TodoItem {
  content: string;
  status: string;
}
const todoItems = ref<TodoItem[]>([]);
/** 已完成待办数量（用于分组标题的绿色计数徽标，对齐参考图 “进程 4/4”） */
const todoDoneCount = computed(() => todoItems.value.filter((it) => it.status === "completed").length);

async function loadTodo(): Promise<void> {
  if (!props.sessionId) {
    todoItems.value = [];
    return;
  }
  try {
    const res = await apiService.getSessionTodo(props.sessionId);
    todoItems.value = res.items || [];
  } catch {
    todoItems.value = [];
  }
}

// ── 工作目录分组：主目录展示（不可删改）+ 附加远程目录（ssh-connection 附件）绑定管理 ──
const REMOTE_WS_ATTACHMENT_TYPE = "ssh-connection";
/** 下拉空态命令：跳转设置页“远程工作区”创建连接 */
const OPEN_SETTINGS_COMMAND = "__open_settings";

/** 主工作目录（后端解析：自定义 workspacePath 或会话默认目录），仅展示 */
const mainWorkspacePath = ref("");
const mainWorkspaceBasename = computed(() => {
  if (!mainWorkspacePath.value) return "";
  const normalized = mainWorkspacePath.value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized;
});

interface AttachableConnection { id: string; name: string; description?: string; }
/** remote-workspace 插件提供的全部连接（设置页创建，与会话无关的全局清单） */
const availableConnections = ref<AttachableConnection[]>([]);

/** 当前会话已绑定的附加目录 ID（props.attachments 单向下传，增删经 attachmentsChange 上行） */
const attachedIds = computed<string[]>(() => props.attachments?.[REMOTE_WS_ATTACHMENT_TYPE] ?? []);
/** 已绑定连接的展示信息（连接清单缺失时回退显示 ID） */
const attachedConnections = computed<AttachableConnection[]>(() =>
  attachedIds.value.map((id) => availableConnections.value.find((c) => c.id === id) ?? { id, name: id }),
);

async function loadWorkspacePath(): Promise<void> {
  if (!props.sessionId) {
    mainWorkspacePath.value = "";
    return;
  }
  try {
    const res = await apiService.getWorkspacePath(props.sessionId);
    mainWorkspacePath.value = res.workspacePath || "";
  } catch {
    mainWorkspacePath.value = "";
  }
}

async function loadConnections(): Promise<void> {
  try {
    // 直连 remote-workspace REST 清单（与设置页同源）；不经附件类型端点（该类型已注销）
    const connections = await apiService.getConnections();
    availableConnections.value = connections.map((c) => ({
      id: c.id,
      name: c.name,
      description: `${c.config.username}@${c.config.host}`,
    }));
  } catch {
    availableConnections.value = [];
  }
}

/** 解绑附加目录（主目录不可删；后端下回合 diff 后注入解绑提醒） */
function removeAttached(connectionId: string): void {
  writeAttachments(attachedIds.value.filter((id) => id !== connectionId));
}

/** 下拉命令分发：连接 ID 切换绑定；空态命令跳设置页 */
function handleAttachedCommand(command: string): void {
  if (command === OPEN_SETTINGS_COMMAND) {
    void router.replace({ name: "SystemSettings", params: { tab: "connections" } });
    return;
  }
  writeAttachments(
    attachedIds.value.includes(command)
      ? attachedIds.value.filter((id) => id !== command)
      : [...attachedIds.value, command],
  );
}

/** 写回附件绑定并上行（ChatPage 写 mainSession.settings 后 PUT /sessions/:id 持久化） */
function writeAttachments(ids: string[]): void {
  emit("attachmentsChange", { ...props.attachments, [REMOTE_WS_ATTACHMENT_TYPE]: ids });
}

// ClipboardTaskListLtr20Regular 原用于待办折叠头行，分组标题化后暂不使用；保留导入会报 unused，移除。

// ── 后台进程（shell 插件 run_command 转后台的运行中进程）──
const processes = ref<UiProcessInfo[]>([]);
/** 时长显示的秒级心跳（仅驱动 elapsedText 重算） */
const nowTick = ref(Date.now());
let unsubscribeProcessChanged: (() => void) | null = null;
let unsubscribeWorkflowStream: (() => void) | null = null;
let unsubscribeTodoUpdated: (() => void) | null = null;
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
        avatarUrl: s.avatarUrl || s.character?.avatarUrl || null,
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
    void loadTodo();
    void loadProcesses();
    void loadWorkflowRuns();
    void loadWorkspacePath();
  },
  { immediate: true },
);

onMounted(() => {
  void loadConnections();
  unsubscribeTodoUpdated = apiService.onSessionEvent("todo_updated", (event) => {
    if (event.sessionId === props.sessionId) loadTodo();
  });
  unsubscribeProcessChanged = apiService.onSessionEvent("process_changed", (event) => {
    if (event.sessionId === props.sessionId) loadProcesses();
  });
  unsubscribeWorkflowStream = streamEventHub.subscribeAll(handleStreamChunk);
  elapsedTimer = window.setInterval(() => { nowTick.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  unsubscribeTodoUpdated?.();
  unsubscribeTodoUpdated = null;
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

function openWorkspaceTree(): void {
  layoutStore.setWorkspaceVisible(true);
  // 显示完全由激活标签驱动：回到起始页（无激活标签时展示，可再打开文件）
  nextTick(() => tabStore.openNewTab());
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
    if (result.success && result.window?.windowId) {
      layoutStore.setWorkspaceVisible(true);
      nextTick(() => {
        tabStore.selectTab(`browser:${result.window.windowId}`);
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
  background: var(--gd-color-dialog-bg, var(--gd-color-surface));
  border: 1px solid var(--gd-color-surface-border);
  border-radius: 12px;
  overflow: hidden;
}

/* 标题行（无下划线） */
.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 38px;
  padding: 0 10px 0 14px;
}
.overview-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--gd-color-text-gray);
  text-transform: uppercase;
}
.overview-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.overview-collapse-btn .is-loading {
  animation: overview-spin 1s linear infinite;
}
.overview-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
}
.overview-collapse-btn:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

/* 行列表：高度随内容自适应（悬浮卡片），超高时内部滚动 */
.overview-rows {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
  padding: 2px 8px 12px;
  display: flex;
  flex-direction: column;
}

/* ── 分组：标题 + 下属行；分组间以细分割线分隔（首组紧随头部分割线，无额外线） ── */
.overview-section {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 10px;
}
.overview-section + .overview-section {
  margin-top: 12px;
  padding-top: 14px;
  position: relative;
}
.overview-section + .overview-section::before {
  content: "";
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 1px;
  background: var(--gd-color-surface-border);
}
.overview-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 5px;
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
  padding: 0 8px;
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

/* 附加目录行：div 行 + hover 显示解除按钮（对齐后台进程行的 kill 样式） */
.overview-attach-row {
  cursor: default;
}
.overview-attach-remove {
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
.overview-attach-row:hover .overview-attach-remove {
  opacity: 1;
}
.overview-attach-remove:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
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

/* 待办列表（平铺展开，对齐参考图：✓完成 / →进行中 / ○待处理） */
.overview-todo-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px 8px;
  gap: 2px;
}
.overview-todo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 4px;
}
.overview-todo-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.overview-todo-check {
  font-size: 15px;
  color: var(--gd-color-success);
}
.overview-todo-arrow {
  font-size: 15px;
  color: var(--gd-color-text);
}
.overview-todo-ring {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--gd-color-text-disabled);
}
@keyframes overview-spin {
  to { transform: rotate(360deg); }
}
.overview-todo-text {
  font-size: var(--gd-size-text-base);
  color: var(--gd-color-text-gray);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-todo-item.active .overview-todo-text {
  color: var(--gd-color-text);
}
.overview-todo-item.done .overview-todo-text {
  text-decoration: line-through;
  color: var(--gd-color-text-disabled);
}

/* 后台进程列表（平铺展开） */
.overview-process-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px 8px;
  gap: 1px;
}
.overview-process-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
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
  padding: 2px 4px 4px;
}
.wf-run + .wf-run {
  margin-top: 6px;
}
.wf-run-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  min-width: 0;
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
  position: relative;
  margin: 2px 0 0 7px;
  padding-left: 12px;
  display: flex;
  flex-direction: column;
}
/* 树形连接线（对齐 DSH 任务管理配方）：竖干自 run 行下垂，
   每个成员节点一条水平横肘线，竖线贯穿节点、末节点止于横肘 */
.wf-agents::before {
  content: '';
  position: absolute;
  left: -12px;
  top: -14px;
  height: 14px;
  border-left: 1px solid var(--gd-color-surface-border, rgba(128, 128, 128, 0.2));
}
.wf-agent {
  position: relative;
  padding: 3px 4px;
  border-radius: 4px;
}
.wf-agent::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -12px;
  border-left: 1px solid var(--gd-color-surface-border, rgba(128, 128, 128, 0.2));
}
.wf-agent:last-child::before {
  bottom: auto;
  height: 12px;
}
.wf-agent::after {
  content: '';
  position: absolute;
  top: 12px;
  left: -12px;
  width: 14px;
  border-top: 1px solid var(--gd-color-surface-border, rgba(128, 128, 128, 0.2));
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
  font-size: 12px;
  color: var(--gd-color-text-gray);
}

/* 子代理列表（平铺行；已冻结行收进"已结束"折叠组内缩进展示） */
.overview-subagent-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px;
}
.overview-subagent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
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
  margin: 2px 0 1px;
  padding: 2px 4px;
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
  margin-left: 14px;
}

/* 浏览器列表（平铺展开） */
.overview-browser-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px 8px;
  gap: 1px;
}
.overview-browser-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
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
  padding: 2px 4px;
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
