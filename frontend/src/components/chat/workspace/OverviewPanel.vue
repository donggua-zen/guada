<template>
  <!-- 工作区概览：常驻于聊天内容右侧（占位挤宽），与 WorkspaceSidebar 解耦。
       数据源：GitStore（git 状态/统计/分支/提交弹窗）、browserWebview store。
       布局：分组标题 + 下属行（Git 工具 / 浏览器），默认平铺展开。
       运行时状态区已全部迁出：待办/进程/子代理 → 输入区运行时胶囊（ComposerStatusBar），
       工作流进度 → 对话流 workflow_run 工具行原地渲染（WorkflowRunInlineCard）；
       工作目录 → WorkingDirBar。本面板不再表达任何会话运行状态。 -->
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

      <!-- ── 空态 / 加载态：所有分区都无可显示内容时给出明确说明（而非一张空白卡片，
           用户无法分辨「打开了但渲染异常」与「确实没有可概览项」）。
           数据在途时先出加载态，避免空态闪现后被内容替换 ── -->
      <div v-if="showEmptyState" class="overview-empty">
        <el-icon :size="22" class="overview-empty-icon"><AppsListDetail20Regular /></el-icon>
        <p class="overview-empty-title">{{ emptyText.title }}</p>
        <p class="overview-empty-hint">{{ emptyText.hint }}</p>
      </div>
      <div v-else-if="showLoadingState" class="overview-empty">
        <el-icon :size="16" class="overview-empty-icon is-loading"><Loading /></el-icon>
        <p class="overview-empty-hint">{{ t('common.loading') }}</p>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, Loading } from "@element-plus/icons-vue";
import {
  BranchFork16Regular, ArrowUpload16Regular,
  Add16Regular,
  AppsListDetail20Regular,
} from "@vicons/fluent";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import DropdownMenuItem from "../../ui/DropdownMenuItem.vue";
import GdTooltip from "../../ui/GdTooltip.vue";
import { useGitStore } from "@/stores/git";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { useBrowserWebviewStore } from "@/stores/browserWebview";

const { t } = useI18n();
const props = defineProps<{
  sessionId: string | null;
}>();

const git = useGitStore();
const tabStore = useTabStore();
const layoutStore = useLayoutStore();
const browserStore = useBrowserWebviewStore();

// ── 浏览器（声明需在 session watcher 之前：immediate watcher 同步访问） ──
/** 当前会话的浏览器窗口列表（browserStore 已按会话过滤） */
const browserWindows = computed(() => browserStore.sessionWebviews);

// ── 空态 / 加载态判定 ──
// 分区可见性全在模板里以数据存在性 v-if 表达，此处镜像同一组条件（新增/删除分区需同步）。
const hasContent = computed<boolean>(
  () => git.isGitRepo || browserWindows.value.length > 0,
);

/** git 首帧在途：status 未落地时无分区可显示，但请求在跑（失败后 refreshing 归 false → 不会永久停在加载态） */
const gitPending = computed<boolean>(() => git.refreshing && !git.status);

const showEmptyState = computed<boolean>(() => !hasContent.value && !gitPending.value);
const showLoadingState = computed<boolean>(() => !hasContent.value && gitPending.value);

/** 空态文案：会话尚未建立 vs 会话已有但确实没有可概览项，两种语境分别措辞 */
const emptyText = computed<{ title: string; hint: string }>(() =>
  props.sessionId
    ? { title: t("chat.workspace.overviewEmpty"), hint: t("chat.workspace.overviewEmptyHint") }
    : {
      title: t("chat.workspace.overviewEmptyNoSession"),
      hint: t("chat.workspace.overviewEmptyNoSessionHint"),
    },
);

// 浏览器 store → tabStore 同步已迁移至 BrowserWebviewLayer（MainLayout 常驻层）：
// 概览面板是条件渲染（asideWidth>0 才挂载），概览折叠/宽度不足时此处 watch 失效，
// 会导致浏览器标签不出现；BrowserWebviewLayer 常驻，同步不会断。

// ── 会话绑定：git 数据与事件订阅由 GitStore 管理（bindSession 订阅 git scope），
//    workspace SSE 连接由 MainLayout 持有 —— 本组件仅展示，不参与连接/订阅生命周期。
watch(
  () => props.sessionId,
  (id) => {
    git.bindSession(id);
  },
  { immediate: true },
);

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

/* 空态 / 加载态：卡片随内容自适应高度，空内容时需自带体量与说明，避免退化成一条空白窄条。
   行高全取整数（22/20/17）→ 图标 22 + 6 + 标题 20 + 6 + 说明 17 + padding 46 = 117px */
.overview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 22px 12px 24px;
  text-align: center;
}
.overview-empty-icon {
  color: var(--gd-color-text-disabled);
  opacity: 0.55;
}
.overview-empty-title {
  margin: 0;
  font-size: var(--gd-size-text-sm);
  line-height: 20px;
  color: var(--gd-color-text-gray);
}
.overview-empty-hint {
  margin: 0;
  max-width: 200px;
  font-size: 12px;
  line-height: 17px;
  color: var(--gd-color-text-disabled);
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
  /* 小标签档：区标题要比自己的行（--gd-size-text-sm）小，故不能用会被主题抬到 15px 的 base */
  font-size: var(--gd-size-text-xs);
  font-weight: 400;
  color: var(--gd-color-text-disabled);
  /* 整数行高：区标题 17 + 3 = 20 整数，面板内所有行的 top 保持整数
     （历史坑：曾用 1.2 倍行高，14px × 1.2 = 16.8 小数行盒，实测 23 处小数 top）。 */
  line-height: 17px;
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
  /* 整数行高且与 30px 行高同奇偶：14px 继承 1.5 是 21px 行盒，
     (30−21)/2 = 4.5px 居中余量 → 行内文本落在半像素上（实测 top=.50） */
  line-height: 20px;
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
