<template>
  <!-- 工作区概览：常驻于聊天内容右侧（占位挤宽），与 WorkspaceSidebar 解耦。
       数据源：GitStore（git 状态/统计/分支/提交弹窗）、browserWebview store、会话待办。 -->
  <aside class="overview-panel">
    <!-- 标题行 -->
    <div class="overview-header">
      <span class="overview-title">{{ t('git.overviewTitle') }}</span>
      <button class="overview-collapse-btn" :title="t('chat.workspace.collapseOverview')" @click="emit('collapse')">
        <el-icon :size="14"><Dismiss16Regular /></el-icon>
      </button>
    </div>

    <div class="overview-rows">
      <!-- 变更：+N -M → 打开工作区并切到 Git 标签 -->
      <button class="overview-row" :disabled="!git.isGitRepo" @click="openGit">
        <el-icon :size="16" class="overview-row-icon"><Branch20Regular /></el-icon>
        <span class="overview-row-label">{{ t('git.title') }}</span>
        <span v-if="git.totalStats.add || git.totalStats.del" class="overview-row-value overview-row-value--stats">
          <span v-if="git.totalStats.add" class="text-[#1a7f37] dark:text-[#3fb950]">+{{ git.totalStats.add }}</span>
          <span v-if="git.totalStats.del" class="text-[#cf222e] dark:text-[#f85149]">-{{ git.totalStats.del }}</span>
        </span>
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

      <!-- 环境初始化（待办）：有未完成待办才显示；默认折叠只显示当前进行，点击展开全部 -->
      <div v-if="todoItems.length" class="overview-block">
        <button class="overview-row" @click="todoExpanded = !todoExpanded">
          <el-icon :size="16" class="overview-row-icon"><ClipboardTaskListLtr20Regular /></el-icon>
          <span class="overview-row-label">{{ t('chat.workspace.todoList') }}</span>
          <span class="overview-row-value">{{ doneCount }}/{{ todoItems.length }}</span>
          <el-icon :size="12" class="overview-row-chevron" :class="{ expanded: todoExpanded }"><ArrowDown /></el-icon>
        </button>
        <div v-if="todoExpanded" class="overview-todo-list">
          <div v-for="(item, i) in todoItems" :key="i" class="overview-todo-item" :class="{ done: item.status === 'completed' }">
            <span class="overview-todo-dot">
              <el-icon v-if="item.status === 'completed'" :size="12"><Check /></el-icon>
              <span v-else-if="item.status === 'in_progress'" class="overview-todo-spinner"></span>
              <span v-else class="overview-todo-ring"></span>
            </span>
            <span class="overview-todo-text" :title="item.content">{{ item.content }}</span>
          </div>
        </div>
      </div>

      <!-- 浏览器：有标签才显示；点击标签激活（打开工作区预览并切换），可新建窗口 -->
      <div v-if="browserWindows.length" class="overview-block">
        <button class="overview-row" @click="browserExpanded = !browserExpanded">
          <el-icon :size="16" class="overview-row-icon"><Globe16Regular /></el-icon>
          <span class="overview-row-label">{{ t('chat.workspace.browser') }}</span>
          <span class="overview-row-value">{{ browserWindows.length }}</span>
          <el-icon :size="12" class="overview-row-chevron" :class="{ expanded: browserExpanded }"><ArrowDown /></el-icon>
        </button>
        <div v-if="browserExpanded" class="overview-browser-list">
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
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, Check } from "@element-plus/icons-vue";
import {
  Branch20Regular, BranchFork16Regular, ArrowUpload16Regular, Folder16Regular,
  Globe16Regular, ClipboardTaskListLtr20Regular, Dismiss16Regular, Add16Regular,
} from "@vicons/fluent";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import DropdownMenuItem from "../../ui/DropdownMenuItem.vue";
import { useGitStore } from "@/stores/git";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { apiService } from "@/services/ApiService";

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
const todoExpanded = ref(false);
const doneCount = computed(() => todoItems.value.filter((i) => i.status === "completed").length);

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

let unsubscribeTodoUpdated: (() => void) | null = null;
onMounted(() => {
  unsubscribeTodoUpdated = apiService.onSessionEvent("todo_updated", (event) => {
    if (event.sessionId === props.sessionId) loadTodo();
  });
});
onUnmounted(() => {
  unsubscribeTodoUpdated?.();
  unsubscribeTodoUpdated = null;
});

// ── 浏览器（声明需在 session watcher 之前：immediate watcher 同步访问） ──
const browserExpanded = ref(false);
/** 当前会话的浏览器窗口列表（browserStore 已按会话过滤） */
const browserWindows = computed(() => browserStore.sessionWebviews);

// 浏览器 store → tabStore 同步（原由 WorkspaceSidebar 承担；概览常驻 → 迁到此处，
// 工作区隐藏时标签列表仍保持同步，否则 preview 标签栏会过期）
watch(
  () => browserStore.activeWindowId,
  () => tabStore.syncActiveWindowId(),
);
watch(
  () =>
    browserStore.sessionWebviews
      .map((w) => `${w.windowId}\0${w.title}\0${w.favicon || ""}\0${w.url}`)
      .join("\n"),
  () => {
    tabStore.syncBrowserTabs(
      browserStore.sessionWebviews.map((w) => ({
        windowId: w.windowId,
        title: w.title,
        favicon: w.favicon,
        url: w.url,
      })),
    );
  },
);

// ── 会话绑定：git 数据与事件订阅由 GitStore 管理（bindSession 订阅 git scope），
//    workspace SSE 连接由 MainLayout 持有 —— 本组件仅展示，不参与连接/订阅生命周期。
watch(
  () => props.sessionId,
  (id) => {
    git.bindSession(id);
    todoExpanded.value = false;
    browserExpanded.value = false;
    void loadTodo();
  },
  { immediate: true },
);

function openGit(): void {
  layoutStore.setWorkspaceVisible(true);
  tabStore.enterGitMode();
}

function openWorkspaceTree(): void {
  layoutStore.setWorkspaceVisible(true);
  tabStore.exitPreviewMode();
  tabStore.exitGitMode();
}

function activateBrowser(windowId: string): void {
  layoutStore.setWorkspaceVisible(true);
  tabStore.enterPreviewMode();
  tabStore.selectTab(`browser:${windowId}`);
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
      tabStore.enterPreviewMode();
      tabStore.selectTab(`browser:${result.window.windowId}`);
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
  min-width: 0;
  background: var(--color-dialog-bg, var(--color-surface));
  border: 1px solid var(--color-surface-border);
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
  color: var(--color-text-gray);
  text-transform: uppercase;
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
  color: var(--color-text-gray);
  cursor: pointer;
}
.overview-collapse-btn:hover {
  background: var(--color-sidebar-bg-hover);
  color: var(--color-text);
}

/* 行列表：高度自适应内容（悬浮卡片随内容长高），超高时内部滚动 */
.overview-rows {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
  padding: 2px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
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
  color: var(--color-text);
  font-size: var(--size-text-sm);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.overview-row:hover:not(:disabled) {
  background: var(--color-sidebar-bg-hover);
}
.overview-row:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.overview-row-icon {
  color: var(--color-text-gray);
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
  color: var(--color-text);
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
  font-size: var(--size-text-sm);
}
.overview-row-value--empty {
  color: var(--color-text-disabled);
}
.overview-row-chevron {
  color: var(--color-text-disabled);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.overview-row-chevron.expanded {
  transform: rotate(180deg);
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
  font-size: var(--size-text-sm);
}
.overview-branch-check {
  width: 12px;
  flex-shrink: 0;
  color: var(--color-primary);
}
.overview-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 待办展开区 */
.overview-todo-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px 30px;
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
  color: var(--color-success);
}
.overview-todo-ring {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--color-text-disabled);
}
.overview-todo-spinner {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--color-primary-200);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: overview-spin 0.8s linear infinite;
}
@keyframes overview-spin {
  to { transform: rotate(360deg); }
}
.overview-todo-text {
  font-size: 12px;
  color: var(--color-text-gray);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-todo-item.done .overview-todo-text {
  text-decoration: line-through;
  color: var(--color-text-disabled);
}

/* 浏览器展开区 */
.overview-browser-list {
  display: flex;
  flex-direction: column;
  padding: 2px 4px 4px 30px;
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
  color: var(--color-text-gray);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.overview-browser-tab:hover {
  background: var(--color-sidebar-bg-hover);
  color: var(--color-text);
}
.overview-browser-favicon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--color-surface-hover);
  font-size: 9px;
  font-weight: 600;
  color: var(--color-text-gray);
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
  color: var(--color-text-disabled);
  font-size: 12px;
  cursor: pointer;
}
.overview-browser-new:hover {
  color: var(--color-text);
  background: var(--color-sidebar-bg-hover);
}
</style>
