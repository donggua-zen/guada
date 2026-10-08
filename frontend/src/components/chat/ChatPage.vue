<template>
  <!-- 主体内容（侧边栏已移至 MainLayout） -->
  <div class="flex flex-col h-full w-full">
    <template v-if="sessionStore.activeSessionId !== 'new-session'">
      <!-- 可拖拽分割区域 -->
      <div ref="splitContainerRef" class="flex-1 overflow-hidden">
        <GdSplitpanes :split-size="layoutStore.workspaceFullscreen ? 0 : (layoutStore.workspaceVisible ? workspaceSize : 100)"
          :min-size="layoutStore.workspaceFullscreen ? 0 : 30" :max-size="85" :min-pane2-size="320" @resize="onPaneResize" @resized="onPaneResized">
          <template #pane1>
            <div ref="paneContentRef" class="chat-pane-content"
              style="position: relative; height: 100%; display: flex; flex-direction: column;">
              <!-- 页面标题栏 -->
              <PageHeader :title="mainSession?.title || ''">
                <!-- 标题后缀操作区：更多操作紧跟标题（不再随右侧操作组右对齐） -->
                <template #title-actions>
                  <DropdownMenu @command="handleMoreSelect">
                    <div class="header-icon-btn">
                      <MoreHorizontal24Regular class="w-5 h-5" />
                    </div>
                    <template #dropdown>
                      <DropdownMenuItem command="clear">
                        <span class="flex items-center gap-2">
                          <DeleteTwotone class="w-4 h-4" />
                          <span>{{ t('chat.header.clearRecords') }}</span>
                        </span>
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenu>
                </template>
                <template #actions>
                  <!-- 工作目录打开操作（仅 Electron）：主按钮 = 上次选择的方式，下拉箭头切换 -->
                  <template v-if="isElectron && mainSession?.id">
                    <div class="relative inline-flex items-center">
                      <GdTooltip :content="openWithCurrent.label" placement="bottom">
                        <div class="header-icon-btn" @click="openWorkspaceWith(openWithMode)">
                          <!-- WindowsExplorer 是 <img>（尺寸走 font-size），VsCode 是 <svg>（走 w/h） -->
                          <component :is="openWithCurrent.icon" class="w-5 h-5" style="font-size: 20px" />
                        </div>
                      </GdTooltip>
                      <GdTooltip :content="t('chat.workspace.openWith')" placement="bottom">
                        <div ref="openWithBtnRef" class="header-icon-btn" style="padding: 4px 2px"
                          @click="openWithMenuVisible = !openWithMenuVisible">
                          <ChevronDown16Regular class="w-3.5 h-3.5" />
                        </div>
                      </GdTooltip>
                      <GdPopover v-model:show="openWithMenuVisible" :anchor-el="openWithBtnRef" :width="190">
                        <div class="py-1">
                          <div v-for="option in openWithOptions" :key="option.mode" class="open-with-item"
                            @click="handleSelectOpenWith(option.mode)">
                            <component :is="option.icon" class="w-4 h-4" style="font-size: 16px" />
                            <span>{{ option.label }}</span>
                          </div>
                        </div>
                      </GdPopover>
                    </div>
                  </template>
                  <!-- 概览面板开关（常驻，不自动隐藏）：点击展开/收起；激活态=面板展示中 -->
                  <GdTooltip v-if="mainSession"
                    :content="overviewPanelShown ? t('chat.workspace.collapseOverview') : t('chat.workspace.openOverview')"
                    placement="bottom">
                    <div class="header-icon-btn" :class="{ active: overviewPanelShown }" data-overview-pin
                      @click="overviewPanelShown ? handleOverviewCollapse() : handleOverviewRestore()">
                      <AppsListDetail20Regular class="w-5 h-5" />
                    </div>
                  </GdTooltip>
                  <!-- 工作目录切换 -->
                  <GdTooltip v-if="mainSession?.id" :content="layoutStore.workspaceVisible ? t('chat.header.closeWorkspace') : t('chat.header.openWorkspace')" placement="bottom">
                  <div class="header-icon-btn" :class="{ active: layoutStore.workspaceVisible }"
                    @click="layoutStore.toggleWorkspace()">
                    <PanelRightExpand20Filled class="w-5 h-5" />
                  </div>
                  </GdTooltip>
                </template>
              </PageHeader>

              <!-- 主体：会话面板（恒显主会话；子代理在侧边栏标签打开，同屏并存）。
                   工作区全屏时 pane1 整列收起（display:none），对话不可见、数据照常流式写入 -->
              <ChatPanel ref="chatPanelRef" :session="mainSession" :session-id="routeSessionId ?? undefined"
                :aside-width="asideWidth" :aside-reserve="asideReserveWidth"
                @container-resize="onChatContainerResize"
                @save-settings="handleSaveSessionSettings"
                @select-agent="handleSelectAgent">
                <!-- 工作区概览：ChatPanel 右侧 aside 槽位（滚动条左侧）。折叠状态机见
                     overviewPanelShown：空间不足自动折叠（意图冻结），临时展开不计入还原状态 -->
                <template #aside>
                  <div ref="asideSlotRef" class="h-full w-full">
                    <OverviewPanel v-if="asideWidth > 0" :session-id="mainSession?.id ?? null"
                      :sub-sessions="subSessions" />
                  </div>
                </template>
              </ChatPanel>

              <!-- 大纲导航：聊天区左缘垂直居中（定位见 ChatOutline .chat-outline-container）。
                   数据源 = ChatPanel 实际渲染的 visibleTurns（回合制）；
                   旧扁平 activeMessages 在回合制重构后无人写入（恒为空），已弃用 -->
              <ChatOutline v-if="mainSession" :turns="chatPanelRef?.visibleTurns || []"
                :chat-panel-ref="chatPanelRef" @scroll-to-message="handleScrollToMessage" />
            </div>
          </template>

          <template #pane2>
            <WorkspaceSidebar v-if="layoutStore.workspaceVisible && mainSession" :session-id="mainSession.id"
              :sub-sessions="subSessions"
              @insert-to-input="handleInsertToInput" @insert-snip="handleInsertSnip" />
          </template>
        </GdSplitpanes>
      </div>
      <!-- 全局提交/推送弹窗（GitChangesPanel 顶部按钮与概览面板共用入口） -->
      <GitCommitDialog v-if="mainSession" />
    </template>
    <template v-else>
      <!-- 新建对话头部 -->
      <PageHeader :title="t('chat.welcome.newSession')" />
      <CreateSessionChatPanel @create-session="handleCreateSessionWithMessage" />
    </template>
  </div>




</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick, defineAsyncComponent, provide, type Ref } from "vue";
import { useI18n } from "vue-i18n";
const { t } = useI18n()
import { apiService } from "@/services/ApiService";
import { useRouter, useRoute } from 'vue-router';
import { usePopup } from "@/composables/usePopup";
import { useSessionStore } from "@/stores/session";
import { useAuthStore } from "@/stores/auth";
import { useLayoutStore } from "@/stores/layout";
import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { useTabStore } from "@/stores/tab";
import { useTitle } from '@/composables/useTitle';
import type { Session, CreateSessionRequest, InputMessageState } from '@/types/session';
import type { Agent } from '@/types/agent';
import type { SessionEvent } from '@/services/modules/SessionEventsService';
import type { SnipData } from './workspace/FilePreviewPanel.vue';
import { GdSplitpanes } from "../ui";
import ChatPanel from "./ChatPanel.vue";
import CreateSessionChatPanel from "./CreateSessionChatPanel.vue";
// 引入组件
import PageHeader from "@/components/PageHeader.vue";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import DropdownMenuItem from "@/components/ui/DropdownMenuItem.vue";
import {
  DeleteTwotone,
  // FileDownloadOutlined,
  // FileUploadOutlined
} from "@vicons/material";
import { PanelRightExpand20Filled, AppsListDetail20Regular, ChevronDown16Regular, MoreHorizontal24Regular } from "@vicons/fluent";
import { VsCode, WindowsExplorer } from "@/components/icons";
import { TerminalOutlined } from "@vicons/material";
import { ElMessage } from "element-plus";
import { useStorage } from '@vueuse/core';

// 仅 WorkspaceSidebar 影响「展开工作区」的首次停顿（v-if 懒加载）→ 同步 import；
// 概览面板 / 提交弹窗与会话/概览关联、按需弹窗，保留懒加载以减小主包
import WorkspaceSidebar from "./workspace/WorkspaceSidebar.vue";
const OverviewPanel = defineAsyncComponent(() => import("./workspace/OverviewPanel.vue"));
const GitCommitDialog = defineAsyncComponent(() => import("./workspace/GitCommitDialog.vue"));

/** 工作区概览列显隐（持久化；折叠为窄条后点按钮恢复） */
const overviewVisible = useStorage('workspaceOverviewVisible', true);
/** 空间不足时的临时展开：不计入还原状态（overviewVisible），点击面板外自动收起 */
const overviewTempExpanded = ref(false);

/**
 * 概览折叠状态机（三变量）：
 * - overviewVisible：用户持久意图（还原状态）——头栏/面板折叠按钮/恢复按钮在"空间足够"时
 *   才写它；自动逻辑绝不触碰，空间拉宽后按它还原（折叠前是关的就保持关）。
 * - asideFit：容器减去面板占位（ASIDE_TOTAL=288）后仍放得下消息列（MSG_MAX_WIDTH=744）。
 * - overviewTempExpanded：空间不足时的临时展开——可看但不落状态，点击面板外/空间变化即收起。
 * 面板可见 = (overviewVisible && asideFit) || overviewTempExpanded；
 * 空间不足时面板自动"折叠"（不渲染，恢复小按钮常显供临时展开），overviewVisible 冻结不变。
 *
 * 临时展开必须是独立的显示来源，不能写成 overviewVisible && (asideFit || temp)：
 * overviewVisible 只表达"空间足够时的常驻意图"，若它持久化为 false 而当前空间不足，
 * 恢复分支只写 temp → 与意图相与恒为 false，头栏按钮点了毫无反应（死状态）。
 */
const ASIDE_WIDTH = 280;
const ASIDE_GAP = 8;
const ASIDE_TOTAL = ASIDE_WIDTH + ASIDE_GAP;
/** 对话列目标宽：取自 CSS token --gd-chat-column-width（样式侧唯一真相），
 *  此处只在 setup 读一次快照，不参与逐帧计算。 */
const MSG_MAX_WIDTH =
  Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--gd-chat-column-width"),
  ) || 744;

/** 决策用容器宽（ResizeObserver 实时上报） */
const chatDecisionWidth = ref(0);

function onChatContainerResize(cw: number): void {
  chatDecisionWidth.value = cw;
}

const chatContentWidth = computed(() => Math.max(0, chatDecisionWidth.value - 40));

/**
 * 空间是否容得下概览面板。
 * 带迟滞：进入要 ≥MSG_MAX_WIDTH，退出要 <MSG_MAX_WIDTH-48。单点阈值在拖拽穿越边界时
 * 会逐帧翻转 → asideReserve 0↔280 抖动 + OverviewPanel（异步挂载的重组件）反复创建销毁。
 */
const ASIDE_FIT_HYSTERESIS = 48;
const asideFit = ref(false);

watch(
  chatContentWidth,
  (w) => {
    const avail = w - ASIDE_TOTAL;
    asideFit.value = asideFit.value
      ? avail >= MSG_MAX_WIDTH - ASIDE_FIT_HYSTERESIS
      : avail >= MSG_MAX_WIDTH;
  },
  { immediate: true },
);

/** 面板实际可见：（意图开 && 空间足够）或 空间不足时的临时展开 */
const overviewPanelShown = computed(
  () => (overviewVisible.value && asideFit.value) || overviewTempExpanded.value,
);

/** 避让占位宽：仅"用户意图开 && 空间足够"时占位（撑开避让列让消息列让位）——与浮层面板各管各的 */
const asideReserveWidth = computed(() => (overviewVisible.value && asideFit.value ? ASIDE_WIDTH : 0));

/** 浮层面板宽：面板可见即恒为浮层渲染（占位归占位、浮层归浮层） */
const asideWidth = computed(() => (overviewPanelShown.value ? ASIDE_WIDTH : 0));

// 空间变化即清临时展开：变不足 → 自动折叠；变足够 → 按 overviewVisible 还原
watch(asideFit, () => {
  overviewTempExpanded.value = false;
});

/** 面板折叠按钮：空间足够 → 写还原状态；不足（临时展开中）→ 仅收起临时展开 */
function handleOverviewCollapse(): void {
  if (asideFit.value) overviewVisible.value = false;
  else overviewTempExpanded.value = false;
}

/** 恢复小按钮：空间足够 → 恢复还原状态；不足 → 临时展开 */
function handleOverviewRestore(): void {
  if (asideFit.value) overviewVisible.value = true;
  else overviewTempExpanded.value = true;
}

/** 空间不足 + 临时展开时：点击面板外自动收起（面板内/下拉菜单/恢复按钮除外） */
const asideSlotRef = ref<HTMLElement | null>(null);

function onDocPointerDown(e: PointerEvent): void {
  if (asideFit.value || !overviewTempExpanded.value) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (asideSlotRef.value?.contains(target)) return;
  if (target.closest('[data-dropdown-menu], [data-overview-pin]')) return;
  overviewTempExpanded.value = false;
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown));
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown));


const ChatOutline = defineAsyncComponent(() => import("./ChatOutline.vue"));

// 子会话列表（概览"子代理"区与侧边栏标签解析元数据的数据源，支持动态增改）
// 含已冻结（closedAt 非空）的子代理 —— 结束后保留仅供回看，与刷新后 fetchSession 的表现一致
const subSessions = ref<Session[]>([]);

/**
 * 处理子 Agent 创建事件（来自 SSE 全局广播）
 *
 * 仅负责在 subSessions 中登记，不管理状态。状态由 stream_started/stream_finished 统一处理。
 */
function handleSubAgentCreate(event: SessionEvent) {
  const payload = event.payload || {};
  const subSessionId = payload.subSessionId;
  const name = payload.name || t('chat.panel.subTask');
  const session = payload.session;
  if (!subSessionId) return;

  if (!subSessions.value.some(s => s.id === subSessionId)) {
    // 事件未携带会话元数据时构造最小存根（保证概览区行立即可见），完整数据由 fetchSession 兜底
    subSessions.value.push(
      session || ({ id: subSessionId, title: name, isStreaming: true } as Session),
    );
  }
}

/**
 * 处理子 Agent 关闭事件（来自 SSE 全局广播）
 *
 * 后端已将子会话冻结（closedAt 标记，仅供回放），此处就地标记而非移除：
 * 概览"子代理"区把该行折叠进"已结束"组，与刷新后 fetchSession 返回的表现一致。
 * 侧边栏已打开的子代理标签保持不动（记录仍在，标签由用户手动关闭；
 * 冻结的子代理也可随时从概览"已结束"组重开回放）。
 */
function handleSubAgentClosed(event: SessionEvent) {
  const payload = event.payload || {};
  const subSessionId = payload.subSessionId;
  if (!subSessionId) return;

  const sub = subSessions.value.find(s => s.id === subSessionId);
  if (sub && !sub.closedAt) {
    sub.closedAt = new Date().toISOString();
    sub.closeReason = payload.stopReason || null;
    sub.isStreaming = false;
  }
}

/**
 * 打开子代理会话（概览面板子代理行 / 工作流成员行消费）：
 * 在侧边栏工作区打开 subagent 标签，与中央主会话同屏并存。
 * Tab 状态不存在时补建（历史回放/其他端创建的 workflow 子代理）。
 *
 * 时序要求（务必保留 nextTick）：工作区隐藏时 WorkspaceSidebar 尚未挂载
 * （ChatPage.vue 模板 v-if="layoutStore.workspaceVisible && mainSession"），
 * 而它挂载时会执行一次 immediate 会话 watch —— 该 watch 在 oldSessionId 为
 * undefined 时判定为「会话切换」，调用 tabStore.clearAll() 清空标签，随后
 * restorePreviewCache() 再从 localStorage 恢复旧快照。
 * 若在本 tick 内直接 openSubAgentTab，标签会被 clearAll 吃掉，表现为
 * 「只打开了侧边栏，子代理标签没自动打开」。
 * nextTick 让 openSubAgentTab 排在挂载之后执行，与概览面板打开
 * Git 标签 / 工作目录浏览标签（OverviewPanel 的 openGit / openWorkspaceTree）一致。
 */
function openSubAgentSessionById(subSessionId: string) {
  if (!subSessionId) return;
  const session = subSessions.value.find((s) => s.id === subSessionId);
  const name = session?.title || t('chat.panel.subTask');
  // 工作区隐藏时先展开，待侧边栏挂载完成（其 immediate watch 已跑完清空/恢复）
  // 再打开/激活子代理标签，避免标签被挂载期清空逻辑吃掉。
  layoutStore.setWorkspaceVisible(true);
  nextTick(() => tabStore.openSubAgentTab(subSessionId, name));
}
provide('workspace:openSubAgentSession', openSubAgentSessionById);

// 组合式函数
const { toast, confirm } = usePopup();
const router = useRouter();
const route = useRoute();
const title = useTitle();

// 删除会话确认对话框状态

// 主会话对象（侧边栏选中的根会话），包含会话的基本信息和设置
const mainSession: Ref<Session | null> = ref(null);

// 路由会话 ID：刷新时同步可用（mainSession 异步就位前的过渡），供 ChatPanel 立即挂载
// 输入区/工作目录条等按 ID 依赖（new-session 时 ChatPanel 整体不挂载，无需排除）
const routeSessionId = computed<string | null>(() => {
  const p = route.params.sessionId;
  return Array.isArray(p) ? (p[0] ?? null) : (p ?? null);
});

// 会话切换时同步浏览器 webview store（隐藏活跃预览，webview 不销毁）
watch(() => mainSession.value?.id, (sessionId) => {
  browserWebviewStore.setCurrentSession(sessionId || null);
});


// 判断是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// 会话列表组件引用，用于调用组件内部方法
// ChatPanel 组件引用，用于调用组件内部方法
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const paneContentRef = ref<HTMLElement | null>(null);
// 工作目录分割比例（目录树 / 预览 / Git 统一使用单一宽度）
const workspaceSize = computed(() => layoutStore.workspaceSplitSize);
// 控制设置模态框的显示与隐藏
// 布局状态
const layoutStore = useLayoutStore();
// 浏览器 webview store（会话切换时同步当前会话 ID）
const browserWebviewStore = useBrowserWebviewStore();
const tabStore = useTabStore();

// 登录信息
const authStore = useAuthStore();
const sessionStore = useSessionStore();

// 流状态消费说明:stream_status_changed 已由 useSessionEvents(MainLayout 常驻)统一订阅并写入
// sessionStore.streamStatus,消费方(概览"子代理"区/侧边栏标签等)直接读 store 派生,
// 本组件不再 watch 派生(旧 watch 曾用于触发 ChatPanel.subscribeToActiveStream,该空壳已删)。

// SSE 事件监听取消函数(stream_status_changed 已由 useSessionEvents 统一订阅,此处不再重复监听)
let unsubscribeSubAgentCreate: (() => void) | null = null;
let unsubscribeSubAgentClosed: (() => void) | null = null;


// 业务逻辑函数

/**
 * 根据会话 ID 从 API 获取会话详情
 */
const fetchSession = async (sessionId: string) => {
  try {
    const session = await apiService.fetchSession(sessionId);
    mainSession.value = session;

    // 子会话列表（含已冻结的，供概览"子代理"区与侧边栏标签解析元数据；
    // isStreaming 由后端注入）
    subSessions.value = session.subSessions || [];
  } catch (error) {
    console.error('获取会话详情失败:', error);
    toast.error(t('common.error.loadFailed'));
    goChatRoute(null);
  }
};

/**
 * 选择会话，加载会话详情
 */
const goChatRoute = async (sessionId: string | null) => {
  if (sessionId) {
    router.replace({ name: 'Chat', params: { sessionId: sessionId } });
  } else {
    router.replace({ name: 'Chat', params: { sessionId: 'new-session' } });
    mainSession.value = null;
  }
};



function onPaneResize() {
  // 拖拽开始时屏蔽 webview 指针事件（webview 在 MainLayout 层，不在 splitpanes scoped CSS 范围内）
  browserWebviewStore.setDragging(true);
}

function onPaneResized(size: number) {
  // 拖拽结束，恢复 webview 指针事件
  browserWebviewStore.setDragging(false);

  const el = paneContentRef.value;
  if (el) {
    el.style.width = '';
  }

  // 保存工作目录分割位置（目录树 / 预览 / Git 统一保存到单一宽度）
  // 拖拽是纯前端布局状态，Web 与 Electron 都要记住（resized 只在拖拽结束时触发，
  // 窗口尺寸变化走 ResizeObserver，不会写回）
  if (layoutStore.workspaceVisible) {
    layoutStore.setWorkspaceSplitSize(size);
  }
}

/**
 * 根据会话 ID 更新会话信息
 * 直接更新 sessionStore 中的统一数据源
 */
const updateSessionById = async (sessionId: string, data: Session) => {
  const session = sessionStore.getSession(sessionId);
  if (session) {
    // 定义需要更新的字段
    const allowedFields = ['title', 'avatar_url', 'last_message', 'created_at', 'updated_at'];

    // 兼容历史 snake_case 字段（不在 Session 类型上）→ 断言为可索引读法，仍只复制 allowedFields
    const source = data as unknown as Record<string, unknown>;
    // 只复制允许的字段并批量更新
    for (const field of allowedFields) {
      if (field in source) {
        (session as unknown as Record<string, unknown>)[field] = source[field];
      }
    }
  }
};

// ── 工作目录打开方式（Header 主按钮 + 下拉箭头） ──
// 下拉选过就记住（持久化），主按钮图标/点击行为跟随上次选择。
// VSCode 也作为菜单项：否则切到其他方式后主按钮不再是 VSCode，无法切回
type OpenWithMode = 'vscode' | 'explorer' | 'terminal';
const OPEN_WITH_MODES: OpenWithMode[] = ['vscode', 'explorer', 'terminal'];

/** 上次选择的方式；宽松读取，脏值由 openWithMode 收敛回默认 vscode */
const storedOpenWith = useStorage<string>('workspaceOpenWith', 'vscode');
const openWithMode = computed<OpenWithMode>(() =>
  OPEN_WITH_MODES.includes(storedOpenWith.value as OpenWithMode)
    ? (storedOpenWith.value as OpenWithMode)
    : 'vscode'
);

/** 打开方式候选：顺序即下拉顺序。vscode 用短标签：长标签（Open Working Directory in VSCode）
 *  会把 190px 弹窗撑破；与目录树右键菜单的 openInVSCodeShort 保持同一文案 */
const openWithOptions = computed(() => [
  { mode: 'vscode' as OpenWithMode, label: t('chat.workspace.openInVSCodeShort'), icon: VsCode },
  { mode: 'explorer' as OpenWithMode, label: t('chat.workspace.openInFileManager'), icon: WindowsExplorer },
  { mode: 'terminal' as OpenWithMode, label: t('chat.workspace.openInTerminal'), icon: TerminalOutlined },
]);

/** 主按钮当前展示/执行的选项 */
const openWithCurrent = computed(
  () => openWithOptions.value.find(o => o.mode === openWithMode.value) ?? openWithOptions.value[0]
);

/** 以指定方式打开当前会话的工作目录（仅 Electron） */
async function openWorkspaceWith(mode: OpenWithMode) {
  const sessionId = mainSession.value?.id;
  if (!sessionId || !isElectron) return;

  try {
    const response = await apiService.getWorkspacePath(sessionId);
    if (!response.workspacePath || !window.electronAPI) return;
    if (mode === 'explorer') {
      await window.electronAPI.openFolder(response.workspacePath);
    } else {
      await window.electronAPI.openWithEditor(response.workspacePath, mode);
    }
  } catch (error) {
    console.error(`Failed to open workspace with ${mode}:`, error);
    // openVSCodeFailed 只对 VSCode 成立（提示装 code 命令），其余用通用文案
    ElMessage.error(t(mode === 'vscode' ? 'chat.workspace.openVSCodeFailed' : 'chat.workspace.openFailed'));
  }
}

// ── 打开方式下拉：显示状态 ──
const openWithMenuVisible = ref(false);
const openWithBtnRef = ref<HTMLElement | null>(null);

/** 下拉选择：记住本次选择（主按钮随即跟随），并立即用它打开 */
async function handleSelectOpenWith(mode: OpenWithMode) {
  openWithMenuVisible.value = false;
  storedOpenWith.value = mode;
  await openWorkspaceWith(mode);
}


const updateSelectedSession = async (sessionId: string) => {
  if (sessionId == null || sessionId === 'new-session') {
    mainSession.value = null;
    sessionStore.activeSessionId = "new-session";
    return;
  }
  sessionStore.activeSessionId = sessionId;
  if (sessionId !== mainSession.value?.id) {
    // 切换会话时重置子会话列表（侧边栏 subagent 标签由 WorkspaceSidebar 的会话切换 watch 统一清空）
    subSessions.value = [];
    await fetchSession(sessionId);
  }
};


const handleCreateSessionWithMessage = async (session: CreateSessionRequest, inputMessage: InputMessageState) => {
  if (!authStore.isAuthenticated)
    return;
  try {
    const response = await apiService.createSession(session)
    // 写入统一数据源，侧边栏通过响应式自动更新
    sessionStore.setSession(response)

    if (inputMessage) {
      inputMessage.isWaiting = true
      sessionStore.setInputMessage(response.id, inputMessage)
    }
    await goChatRoute(response.id);
  } catch (error) {
    console.error('创建对话失败:', error);
    toast.error(t('common.createFailed'));
  }
};
/**
 * 保存会话设置
 * 将当前会话的设置保存到服务器
 */
const handleSaveSessionSettings = async () => {
  try {
    const targetSession = mainSession.value;
    if (targetSession) {
      // workspacePath 不在后端 updateSession 白名单内（服务端会丢弃），此处不再发送
      await apiService.updateSession(targetSession.id, {
        modelId: targetSession.modelId,
        settings: targetSession.settings,
      });
    }
  } catch (error) {
    console.error('保存对话设置失败:', error);
  }
};

/**
 * 切换智能体
 * 更新会话的 agentId 并刷新本地智能体信息
 */
const handleSelectAgent = async (agent: Agent) => {
  if (!mainSession.value) return;
  try {
    await apiService.updateSession(mainSession.value.id, { agentId: agent.id });
    mainSession.value.agent = agent;
    mainSession.value.agentId = agent.id;
  } catch (error) {
    console.error('切换智能体失败:', error);
    toast.error(t('common.error.operationFailed'));
  }
};

/**
 * 更多操作菜单选择处理
 */
async function handleMoreSelect(key: string) {
  switch (key) {
    case "clear":
      await clearChat();
      break;
    // case "export":
    //   exportChat();
    //   break;
    // case "import":
    //   await importChat();
    //   break;
  }
}

/**
 * 清空聊天记录
 */
async function clearChat() {
  if (!mainSession.value) {
    toast.error(t('chat.panel.noActiveSession'));
    return;
  }

  if (await confirm(t('chat.panel.clearChatTitle'), t('chat.panel.clearChatDesc'))) {
    try {
      await apiService.clearSessionMessages(mainSession.value.id);
      sessionStore.clearSessionMessages(mainSession.value.id);
      // 重新加载消息列表
      const chatPanel = chatPanelRef.value;
      if (chatPanel && chatPanel.loadMessages) {
        chatPanel.loadMessages(mainSession.value.id);
      }
      toast.success(t('common.operationSuccess'));
    } catch (error) {
      console.error('清空聊天记录失败:', error);
      toast.error(t('common.error.operationFailed'));
    }
  }
}



/**
 * 处理滚动到指定消息
 */
function handleScrollToMessage(messageId: string) {
  const chatPanel = chatPanelRef.value;
  if (chatPanel && chatPanel.scrollToMessage) {
    chatPanel.scrollToMessage(messageId);
  }
}

/**
 * 将路径插入到聊天输入框光标处
 */
function handleInsertToInput(path: string) {
  const chatPanel = chatPanelRef.value;
  if (chatPanel && chatPanel.insertText) {
    chatPanel.insertText(path);
  }
}

/**
 * 将选区 snip 徽标插入到聊天输入框
 */
function handleInsertSnip(data: SnipData) {
  const chatPanel = chatPanelRef.value;
  if (chatPanel && chatPanel.insertBadge) {
    chatPanel.insertBadge(data);
  }
}

// 监听器

// 监听当前会话的变化，更新页面标题
watch(
  () => mainSession,
  (session) => {
    if (session.value) {
      title.value = `${session.value.title}-${t('chat.panel.mainSession')}`;
      updateSessionById(session.value.id, session.value);
    }
  },
  { deep: true }
);

// 监听路由参数中会话 ID 的变化，更新选中的会话
watch(
  () => route.params.sessionId,
  async (newSessionId) => {
    if (!newSessionId) {
      mainSession.value = null;
      goChatRoute(null);
      return;
    }
    const sessionId = Array.isArray(newSessionId) ? newSessionId[0] : newSessionId;
    await updateSelectedSession(sessionId);
  }
);

// 生命周期
onMounted(async () => {
  const sessionId = Array.isArray(route.params.sessionId) ? route.params.sessionId[0] : route.params.sessionId;

  await updateSelectedSession(sessionId);

  // stream_status_changed 已由 useSessionEvents(MainLayout 常驻)统一订阅并写入 sessionStore.streamStatus,
  // 消费方直读 store,本组件不再派生、也不重复 onSessionEvent。

  // 注册子 Agent 生命周期事件监听（仅负责增删 Tab）
  unsubscribeSubAgentCreate = apiService.onSessionEvent('sub_agent_create', handleSubAgentCreate);
  unsubscribeSubAgentClosed = apiService.onSessionEvent('sub_agent_closed', handleSubAgentClosed);
});

// 工作目录隐藏时重置全屏状态（显示由激活标签驱动，无需重置标签）
watch(() => layoutStore.workspaceVisible, (visible) => {
  if (!visible) {
    layoutStore.workspaceFullscreen = false;
  }
});

// 组件卸载时取消监听
onUnmounted(() => {
  if (unsubscribeSubAgentCreate) {
    unsubscribeSubAgentCreate();
    unsubscribeSubAgentCreate = null;
  }
  if (unsubscribeSubAgentClosed) {
    unsubscribeSubAgentClosed();
    unsubscribeSubAgentClosed = null;
  }
  // 清理当前会话标记：currentSessionId 表示"用户正在看的会话"，
  // 离开聊天页后不应再命中自动预览等基于该状态的条件
  browserWebviewStore.setCurrentSession(null);
});


</script>

<style scoped>
/* 工作目录打开方式下拉项 */
.open-with-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  color: var(--gd-color-text);
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.15s ease;
  white-space: nowrap;
}

.open-with-item:hover {
  background: var(--gd-color-sidebar-bg-hover);
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-right-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}


.chat-pane-content {
  contain: layout style;
}
</style>

<style>
/* GdDialog scoped styles handle dialog body/header/footer — no global overrides needed */

/* 工作目录删除警告弹窗样式 */
.workspace-delete-warning {
  max-width: 500px !important;
}

.workspace-delete-warning .el-message-box__message p,
.workspace-delete-warning .el-message-box__message {
  white-space: normal !important;
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
  line-height: 1.6 !important;
  text-align: left !important;
  max-width: 100% !important;
}
</style>
