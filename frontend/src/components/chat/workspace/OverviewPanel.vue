<template>
  <!-- 工作区概览：常驻于聊天内容右侧（占位挤宽），与 WorkspaceSidebar 解耦。
       数据源：GitStore（git 状态/统计/分支/提交弹窗）、browserWebview store、会话待办、后台进程。
       布局：分组标题 + 下属行（Git 工具 / 待办事项 / 后台进程 / 浏览器），默认平铺展开。 -->
  <aside class="overview-panel">
    <!-- 标题行 -->
    <div class="overview-header">
      <span class="overview-title">{{ t('git.overviewTitle') }}</span>
      <div class="overview-header-actions">
        <!-- 重新检测：手动刷新 git 状态（覆盖 git init / 仓库状态变化等 watcher 无法感知的场景） -->
        <button class="overview-collapse-btn" :title="t('git.refresh')" :disabled="git.refreshing"
          @click="git.refresh()">
          <el-icon :size="14" :class="{ 'is-loading': git.refreshing }"><ArrowSync20Regular /></el-icon>
        </button>
        <button class="overview-collapse-btn" :title="t('chat.workspace.collapseOverview')" @click="emit('collapse')">
          <el-icon :size="14"><Dismiss16Regular /></el-icon>
        </button>
      </div>
    </div>

    <div class="overview-rows">
      <!-- ── Git 工具 ── -->
      <section class="overview-section">
        <div class="overview-section-title">{{ t('chat.workspace.sectionGit') }}</div>

        <!-- 变更：+N -M → 打开工作区并切到 Git 标签 -->
        <button class="overview-row" :disabled="!git.isGitRepo" @click="openGit">
          <el-icon :size="16" class="overview-row-icon"><Branch20Regular /></el-icon>
          <span class="overview-row-label">{{ t('git.title') }}</span>
          <span v-if="git.totalStats.add || git.totalStats.del" class="overview-row-value overview-row-value--stats">
            <span v-if="git.totalStats.add" class="text-[#1a7f37] dark:text-[#3fb950]">+{{ git.totalStats.add }}</span>
            <span v-if="git.totalStats.del" class="text-[#cf222e] dark:text-[#f85149]">-{{ git.totalStats.del }}</span>
          </span>
          <span v-else-if="git.status?.gitUnavailable" class="overview-row-value overview-row-value--empty">{{ t('git.notInstalled') }}</span>
          <span v-else class="overview-row-value overview-row-value--empty">{{ t('git.noChanges') }}</span>
        </button>

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

        <!-- 工作目录：打开工作区目录树标签 -->
        <button class="overview-row" @click="openWorkspaceTree">
          <el-icon :size="16" class="overview-row-icon"><Folder16Regular /></el-icon>
          <span class="overview-row-label">{{ t('chat.workspace.workingDir') }}</span>
        </button>
      </section>

      <!-- ── 待办事项：无待办不显示，平铺展示全部条目 ── -->
      <section v-if="todoItems.length" class="overview-section">
        <div class="overview-section-title">{{ t('chat.workspace.todoList') }}</div>
        <div class="overview-todo-list">
          <div v-for="(item, i) in todoItems" :key="i" class="overview-todo-item" :class="{ done: item.status === 'completed' }">
            <span class="overview-todo-dot">
              <el-icon v-if="item.status === 'completed'" :size="12"><Check /></el-icon>
              <span v-else-if="item.status === 'in_progress'" class="overview-todo-spinner"></span>
              <span v-else class="overview-todo-ring"></span>
            </span>
            <span class="overview-todo-text" :title="item.content">{{ item.content }}</span>
          </div>
        </div>
      </section>

      <!-- ── 后台进程：运行中的后台命令；点击行打开日志标签，行尾关闭按钮终止进程 ── -->
      <section v-if="processes.length" class="overview-section">
        <div class="overview-section-title">{{ t('chat.workspace.processes') }}</div>
        <div class="overview-process-list">
          <div v-for="p in processes" :key="p.id" class="overview-process-item" :title="p.command"
            @click="openProcessLog(p)">
            <span class="overview-process-spinner"></span>
            <span class="overview-process-cmd">{{ shortCommand(p.command) }}</span>
            <span class="overview-process-elapsed">{{ elapsedText(p.startedAt) }}</span>
            <button class="overview-process-kill" :title="t('chat.workspace.killProcess')"
              @click.stop="killProcess(p)">
              <el-icon :size="10"><Close /></el-icon>
            </button>
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { ArrowDown, Check, Close } from "@element-plus/icons-vue";
import {
  Branch20Regular, BranchFork16Regular, ArrowUpload16Regular, Folder16Regular,
  Dismiss16Regular, Add16Regular,
  ArrowSync20Regular,
} from "@vicons/fluent";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import DropdownMenuItem from "../../ui/DropdownMenuItem.vue";
import { useGitStore } from "@/stores/git";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { apiService, type UiProcessInfo } from "@/services/ApiService";

const { t } = useI18n();
const props = defineProps<{ sessionId: string | null }>();
const emit = defineEmits<{ collapse: [] }>();

const git = useGitStore();
const tabStore = useTabStore();
const layoutStore = useLayoutStore();
const browserStore = useBrowserWebviewStore();

// ── 待办（环境初始化）：复用 SessionTodoList 的数据源与事件订阅 ──
interface TodoItem {
  content: string;
  status: string;
}
const todoItems = ref<TodoItem[]>([]);

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

// ClipboardTaskListLtr20Regular 原用于待办折叠头行，分组标题化后暂不使用；保留导入会报 unused，移除。

// ── 后台进程（shell 插件 run_command 转后台的运行中进程）──
const processes = ref<UiProcessInfo[]>([]);
/** 时长显示的秒级心跳（仅驱动 elapsedText 重算） */
const nowTick = ref(Date.now());
let unsubscribeProcessChanged: (() => void) | null = null;
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

// 浏览器 store → tabStore 同步已迁移至 BrowserWebviewLayer（MainLayout 常驻层）：
// 概览面板是条件渲染（asideWidth>0 才挂载），概览折叠/宽度不足时此处 watch 失效，
// 会导致浏览器标签不出现；BrowserWebviewLayer 常驻，同步不会断。

// ── 会话绑定：git 数据与事件订阅由 GitStore 管理（bindSession 订阅 git scope），
//    workspace SSE 连接由 MainLayout 持有 —— 本组件仅展示，不参与连接/订阅生命周期。
watch(
  () => props.sessionId,
  (id) => {
    git.bindSession(id);
    void loadTodo();
    void loadProcesses();
  },
  { immediate: true },
);

onMounted(() => {
  unsubscribeTodoUpdated = apiService.onSessionEvent("todo_updated", (event) => {
    if (event.sessionId === props.sessionId) loadTodo();
  });
  unsubscribeProcessChanged = apiService.onSessionEvent("process_changed", (event) => {
    if (event.sessionId === props.sessionId) loadProcesses();
  });
  elapsedTimer = window.setInterval(() => { nowTick.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  unsubscribeTodoUpdated?.();
  unsubscribeTodoUpdated = null;
  unsubscribeProcessChanged?.();
  unsubscribeProcessChanged = null;
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
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
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

/* ── 分组：标题 + 下属行，组间留白分隔（首组无额外间距） ── */
.overview-section {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 10px;
}
.overview-section + .overview-section {
  margin-top: 8px;
}
.overview-section-title {
  padding: 0 8px 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--gd-color-text);
  line-height: 1.2;
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
  font-size: 12px;
  color: var(--gd-color-text);
}
.overview-row-value--stats {
  display: flex;
  gap: 4px;
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

/* 待办列表（平铺展开） */
.overview-todo-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px 8px;
  gap: 1px;
}
.overview-todo-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 4px;
}
.overview-todo-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--gd-color-success);
}
.overview-todo-ring {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--gd-color-text-disabled);
}
.overview-todo-spinner {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--gd-color-primary-200);
  border-top-color: var(--gd-color-primary);
  border-radius: 50%;
  animation: overview-spin 0.8s linear infinite;
}
@keyframes overview-spin {
  to { transform: rotate(360deg); }
}
.overview-todo-text {
  font-size: 12px;
  color: var(--gd-color-text-gray);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  font-size: 12px;
  color: var(--gd-color-text-gray);
}
.overview-process-item:hover .overview-process-cmd {
  color: var(--gd-color-text);
}
.overview-process-elapsed {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
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
  font-size: 12px;
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
  font-size: 12px;
  cursor: pointer;
}
.overview-browser-new:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-sidebar-bg-hover);
}
</style>
