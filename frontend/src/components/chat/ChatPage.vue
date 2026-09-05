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
              <PageHeader :title="mainSession?.title || ''" :hide-window-controls="layoutStore.workspaceVisible">
                <template #actions>
                  <!-- 工作目录打开操作（仅 Electron）：主按钮 VSCode + 下拉箭头选其他方式 -->
                  <template v-if="isElectron && mainSession?.id">
                    <div class="relative inline-flex items-center">
                      <GdTooltip :content="t('chat.workspace.openInVSCode')" placement="bottom">
                        <div class="header-icon-btn" @click="openWorkspaceInVSCode">
                          <VsCode class="w-5 h-5" />
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
                          <div class="open-with-item" @click="handleOpenWith('explorer')">
                            <WindowsExplorer class="w-4 h-4" />
                            <span>{{ t('chat.workspace.openInFileManager') }}</span>
                          </div>
                          <div class="open-with-item" @click="handleOpenWith('terminal')">
                            <TerminalOutlined class="w-4 h-4" />
                            <span>{{ t('chat.workspace.openInTerminal') }}</span>
                          </div>
                        </div>
                      </GdPopover>
                    </div>
                  </template>
                  <!-- 工作目录切换 -->
                  <GdTooltip v-if="mainSession?.id" :content="layoutStore.workspaceVisible ? t('chat.header.closeWorkspace') : t('chat.header.openWorkspace')" placement="bottom">
                  <div class="header-icon-btn" :class="{ active: layoutStore.workspaceVisible }"
                    @click="layoutStore.toggleWorkspace()">
                    <PanelRightExpand20Filled class="w-5 h-5" />
                  </div>
                  </GdTooltip>
                  <!-- 更多操作下拉菜单 -->
                  <DropdownMenu @command="handleMoreSelect">
                    <div class="header-icon-btn">
                      <MoreVertOutlined class="w-5 h-5" />
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
              </PageHeader>

              <!-- 主体：会话面板（主会话和子 Agent 共用同一个 ChatPanel，通过 session 切换） -->
              <!-- 全屏模式下 ChatPanel 通过 Teleport 搬至浮动容器（aside 槽位随之） -->
              <Teleport :disabled="teleportDisabled" to="#floating-chat">
                <ChatPanel ref="chatPanelRef" :session="panelSession" :readonly="activeTabId !== 'main'"
                  :hide-header="activeTabId !== 'main'" :agent-tabs="agentTabs" :active-tab-id="activeTabId"
                  :aside-width="asideWidth" @container-resize="onChatContainerResize"
                  @switch-agent="switchTab"
                  @save-settings="handleSaveSessionSettings"
                  @select-character="handleSelectCharacter">
                  <!-- 工作区概览：ChatPanel 右侧 aside 槽位（滚动条左侧），可见即实占空间
                       （避让位列恒占位，消息列在剩余空间内居中）；容器放不下面板+消息列时自动隐藏 -->
                  <template #aside>
                    <OverviewPanel v-if="asideWidth > 0" :session-id="mainSession?.id ?? null"
                      @collapse="overviewVisible = false" />
                  </template>
                </ChatPanel>
              </Teleport>

              <!-- 右侧大纲导航 -->
              <ChatOutline v-if="mainSession && activeTabId === 'main'" :messages="chatPanelRef?.activeMessages || []"
                :chat-panel-ref="chatPanelRef" @scroll-to-message="handleScrollToMessage" />

              <!-- 概览折叠后的恢复小按钮（悬浮于右上） -->
              <button v-if="mainSession && !overviewVisible" class="overview-restore-bar"
                :title="t('chat.workspace.openOverview')" @click="overviewVisible = true">
                <el-icon :size="14"><PanelLeftExpand16Filled /></el-icon>
              </button>
            </div>
          </template>

          <template #pane2>
            <WorkspaceSidebar v-if="layoutStore.workspaceVisible && mainSession" :session-id="mainSession.id"
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
import type { Session } from '@/types/session';
import type { Character } from '@/types/character';
import { GdSplitpanes } from "../ui";
import ChatPanel from "./ChatPanel.vue";
import CreateSessionChatPanel from "./CreateSessionChatPanel.vue";
/**
 * 子代理 Tab 数据接口
 */
interface AgentTab {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  loaded?: boolean;
  avatarUrl?: string;  // 角色/团队子Agent的头像
}

// 引入组件
import PageHeader from "@/components/PageHeader.vue";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import DropdownMenuItem from "@/components/ui/DropdownMenuItem.vue";
import {
  MoreVertOutlined,
  DeleteTwotone,
  // FileDownloadOutlined,
  // FileUploadOutlined
} from "@vicons/material";
import { PanelRightExpand20Filled, PanelLeftExpand16Filled, ChevronDown16Regular } from "@vicons/fluent";
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

/**
 * 概览显隐决策：可见即实占空间 —— 面板打开时恒走避让占位（消息列左移、
 * 在剩余空间内居中），不再区分「悬浮于留白 / 挤占」两种模式。
 * 唯一兜底判断：容器减去面板占位（ASIDE_TOTAL=288）后仍放得下消息列
 * （MSG_MAX_WIDTH=744），否则自动隐藏（overviewVisible 不变，拉宽后自动恢复）。
 */
const ASIDE_WIDTH = 280;
const ASIDE_GAP = 8;
const ASIDE_TOTAL = ASIDE_WIDTH + ASIDE_GAP;
const MSG_MAX_WIDTH = 744; // max-w-186

/** 决策用容器宽（ResizeObserver 实时上报） */
const chatDecisionWidth = ref(0);

function onChatContainerResize(cw: number): void {
  chatDecisionWidth.value = cw;
}

const chatContentWidth = computed(() => Math.max(0, chatDecisionWidth.value - 40));

/** 概览列宽，0 表示隐藏 */
const asideWidth = computed(() => {
  if (!overviewVisible.value) return 0;
  return chatContentWidth.value - ASIDE_TOTAL >= MSG_MAX_WIDTH ? ASIDE_WIDTH : 0;
});


const ChatOutline = defineAsyncComponent(() => import("./ChatOutline.vue"));

// 子 Agent Tab 状态
const agentTabs = ref<AgentTab[]>([
  { id: 'main', name: t('chat.panel.mainSession'), status: 'completed', loaded: true }
]);
const activeTabId = ref('main');

// 子会话列表（从主会话同步，支持动态增删）
const subSessions = ref<Session[]>([]);

/**
 * 面板当前展示的会话对象
 * - main Tab：使用 mainSession（主会话）
 * - 子 Agent Tab：从 subSessions 中查找对应的子会话
 */
const panelSession = computed(() => {
  if (activeTabId.value === 'main') {
    return mainSession.value;
  }
  // 从子会话列表中查找
  return subSessions.value.find((s) => s.id === activeTabId.value) || null;
});

/**
 * 处理子 Agent 创建事件（来自 SSE 全局广播）
 *
 * 仅负责新增 Tab，不管理状态。状态由 stream_started/stream_finished 统一处理。
 */
function handleSubAgentCreate(event: any) {
  const payload = event.payload || {};
  const subSessionId = payload.subSessionId;
  const name = payload.name || t('chat.panel.subTask');
  const session = payload.session;
  if (!subSessionId) return;

  const exists = agentTabs.value.find(t => t.id === subSessionId);
  if (!exists) {
    agentTabs.value.push({
      id: subSessionId,
      name,
      status: 'completed',
      loaded: false,
      avatarUrl: session?.avatarUrl || session?.character?.avatarUrl || undefined,
    });
  }

  // 同步加入 subSessions，确保 stream_started 能识别该子 Agent
  const subExists = subSessions.value.find(s => s.id === subSessionId);
  if (!subExists && session) {
    subSessions.value.push(session);
  }
}

/**
 * 处理子 Agent 关闭事件（来自 SSE 全局广播）
 */
function handleSubAgentClosed(event: any) {
  const payload = event.payload || {};
  const subSessionId = payload.subSessionId;
  if (!subSessionId) return;

  // 从 agentTabs 中移除对应的子 Agent
  const index = agentTabs.value.findIndex(t => t.id === subSessionId);
  if (index > -1) {
    agentTabs.value.splice(index, 1);
  }

  // 如果当前激活的是被关闭的子 Agent，切回主线程
  if (activeTabId.value === subSessionId) {
    activeTabId.value = 'main';
  }

  // 从 subSessions 中移除
  const subIndex = subSessions.value.findIndex(s => s.id === subSessionId);
  if (subIndex > -1) {
    subSessions.value.splice(subIndex, 1);
  }
}

/**
 * 切换 Tab
 */
async function switchTab(tabId: string) {
  activeTabId.value = tabId;
}

/**
 * Workflow 卡片跳转子代理会话（provide 给 WorkflowRunCard）：
 * Tab 不存在时补建（历史回放/其他端创建的 workflow 子代理），再切换。
 */
function openSubAgentSessionById(subSessionId: string) {
  if (!subSessionId) return;
  if (!agentTabs.value.some((tab) => tab.id === subSessionId)) {
    const session = subSessions.value.find((s) => s.id === subSessionId);
    agentTabs.value.push({
      id: subSessionId,
      name: session?.title || t('chat.panel.subTask'),
      status: 'completed',
      loaded: false,
      avatarUrl: session?.avatarUrl || undefined,
    });
  }
  activeTabId.value = subSessionId;
}
provide('workflow:openSubAgentSession', openSubAgentSessionById);

/**
 * 关闭子 Agent Tab
 */
function closeSubAgentTab(tabId: string) {
  const index = agentTabs.value.findIndex(t => t.id === tabId);
  if (index > -1 && tabId !== 'main') {
    agentTabs.value.splice(index, 1);
    if (activeTabId.value === tabId) {
      activeTabId.value = 'main';
    }
  }

  // 同步从 subSessions 中移除
  const subIndex = subSessions.value.findIndex(s => s.id === tabId);
  if (subIndex > -1) {
    subSessions.value.splice(subIndex, 1);
  }
}

// 组合式函数
const { toast, confirm } = usePopup();
const router = useRouter();
const route = useRoute();
const title = useTitle();

// 删除会话确认对话框状态

// 主会话对象（侧边栏选中的根会话），包含会话的基本信息和设置
const mainSession: Ref<Session | null> = ref(null);

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
/** 分栏容器（LiteSplitpanes 根，总宽稳定不随切换变化） */
const splitContainerRef = ref<HTMLElement | null>(null);
// 工作目录分割比例（目录树 / 预览 / Git 统一使用单一宽度）
const workspaceSize = computed(() => layoutStore.workspaceSplitSize);
// 控制设置模态框的显示与隐藏
// 布局状态
const layoutStore = useLayoutStore();
// 浏览器 webview store（会话切换时同步当前会话 ID）
const browserWebviewStore = useBrowserWebviewStore();
const tabStore = useTabStore();

// 全屏模式下 Teleport 延迟一帧启用，避免与 pane collapse 同帧触发 moveTeleport 竞态
const teleportDisabled = ref(true);
watch(() => layoutStore.workspaceFullscreen, async (fs) => {
  if (fs) {
    await nextTick();
    teleportDisabled.value = false;
  } else {
    teleportDisabled.value = true;
  }
}, { immediate: true });

// 登录信息
const authStore = useAuthStore();
const sessionStore = useSessionStore();

// 统一流状态派生:useSessionEvents(MainLayout 常驻)统一订阅 stream_status_changed 并写入
// sessionStore.streamStatus,本组件 watch 派生:
// - 更新 agentTabs 状态(running/completed/error)
// - 主会话 running → 触发 ChatPanel 订阅(自身发起的流 isStreaming 已 true,subscribeToActiveStream 守卫自动挡住)
watch(
  () =>
    agentTabs.value
      .map((t) => (t.id === "main" ? mainSession.value?.id : t.id))
      .map((id) => (id ? sessionStore.getSessionState(id)?.streamStatus : undefined)),
  (statuses) => {
    agentTabs.value.forEach((tab, i) => {
      const status = statuses[i];
      if (!status || status === "idle") return;
      tab.status = status === "running" ? "running" : status === "error" ? "error" : "completed";
    });
    const mainId = mainSession.value?.id;
    if (mainId && sessionStore.getSessionState(mainId)?.streamStatus === "running") {
      const chatPanel = chatPanelRef.value;
      if (chatPanel && chatPanel.subscribeToActiveStream) {
        chatPanel.subscribeToActiveStream();
      }
    }
  },
  { deep: true },
);

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

    // 恢复子会话 Tab 状态（页面刷新后从 subSessions 重建，isStreaming 由后端注入）
    subSessions.value = session.subSessions || [];
    if (subSessions.value.length > 0) {
      // 保留 main Tab，重建子 Agent Tabs（状态以 isStreaming 为准）
      const mainTab = agentTabs.value.find(t => t.id === 'main');
      agentTabs.value = [
        mainTab || { id: 'main', name: t('chat.panel.mainSession'), status: 'completed', loaded: true },
        ...subSessions.value.map((sub) => ({
          id: sub.id,
          name: sub.title || t('chat.panel.subTask'),
          status: (sub.isStreaming ? 'running' : 'completed') as 'running' | 'completed' | 'error',
          loaded: true,
        })),
      ];
    }
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
  if (layoutStore.workspaceVisible && isElectron) {
    layoutStore.setWorkspaceSplitSize(size);
  }
  console.log('onPaneResized', size);
}

/**
 * 根据会话 ID 更新会话信息
 * 直接更新 sessionStore 中的统一数据源
 */
const updateSessionById = async (sessionId: string, data: any) => {
  const session = sessionStore.getSession(sessionId);
  if (session) {
    // 定义需要更新的字段
    const allowedFields = ['title', 'avatar_url', 'last_message', 'created_at', 'updated_at'];

    // 只复制允许的字段并批量更新
    for (const field of allowedFields) {
      if (field in data) {
        (session as unknown as Record<string, unknown>)[field] = data[field];
      }
    }
  }
};

/**
 * 在文件管理器中打开当前会话的工作目录（仅 Electron；由 Header 工作目录按钮触发）
 */
async function openInFileManager() {
  const sessionId = mainSession.value?.id;
  if (!sessionId || !isElectron) return;

  try {
    const response = await apiService.getWorkspacePath(sessionId);
    if (response.workspacePath && window.electronAPI) {
      await window.electronAPI.openFolder(response.workspacePath);
    }
  } catch (error: any) {
    console.error('Failed to open workspace folder:', error);
  }
}

/**
 * 以 VSCode 打开当前会话的工作目录（仅 Electron；由 Header 工作目录按钮触发）
 */
async function openWorkspaceInVSCode() {
  const sessionId = mainSession.value?.id;
  if (!sessionId || !isElectron) return;

  try {
    const response = await apiService.getWorkspacePath(sessionId);
    if (response.workspacePath && window.electronAPI) {
      await window.electronAPI.openWithEditor(response.workspacePath, 'vscode');
    }
  } catch (error: any) {
    console.error('Failed to open workspace in VSCode:', error);
    ElMessage.error(t('chat.workspace.openVSCodeFailed'));
  }
}

// ── 工作目录打开方式下拉（Header 箭头按钮） ──
const openWithMenuVisible = ref(false);
const openWithBtnRef = ref<HTMLElement | null>(null);

/** 选择下拉中的其他打开方式：explorer = 资源管理器，terminal = 系统终端 */
async function handleOpenWith(mode: 'explorer' | 'terminal') {
  openWithMenuVisible.value = false;
  const sessionId = mainSession.value?.id;
  if (!sessionId || !isElectron) return;

  try {
    const response = await apiService.getWorkspacePath(sessionId);
    if (!response.workspacePath || !window.electronAPI) return;
    if (mode === 'explorer') {
      await window.electronAPI.openFolder(response.workspacePath);
    } else {
      await window.electronAPI.openWithEditor(response.workspacePath, 'terminal');
    }
  } catch (error: any) {
    console.error(`Failed to open workspace in ${mode}:`, error);
    ElMessage.error(t('chat.workspace.openVSCodeFailed'));
  }
}


const updateSelectedSession = async (sessionId: string) => {
  if (sessionId == null || sessionId === 'new-session') {
    mainSession.value = null;
    sessionStore.activeSessionId = "new-session";
    return;
  }
  sessionStore.activeSessionId = sessionId;
  if (sessionId !== mainSession.value?.id) {
    // 切换会话时重置子代理状态到主线程
    activeTabId.value = 'main';
    agentTabs.value = [{ id: 'main', name: t('chat.panel.mainSession'), status: 'completed', loaded: true }];
    subSessions.value = [];
    await fetchSession(sessionId);
  }
};


const handleCreateSessionWithMessage = async (session: any, inputMessage: any) => {
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
    const targetSession = panelSession.value;
    if (targetSession) {
      await apiService.updateSession(targetSession.id, {
        modelId: targetSession.modelId,
        settings: targetSession.settings,
        workspacePath: targetSession.workspacePath
      });
    }
  } catch (error: any) {
    console.error('保存对话设置失败:', error);
  }
};

/**
 * 切换角色
 * 更新会话的 characterId 并刷新本地角色信息
 */
const handleSelectCharacter = async (character: Character) => {
  if (!mainSession.value) return;
  try {
    await apiService.updateSession(mainSession.value.id, { characterId: character.id });
    mainSession.value.character = character;
    mainSession.value.characterId = character.id;
  } catch (error: any) {
    console.error('切换角色失败:', error);
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
function handleInsertSnip(data: any) {
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
  // 本组件改为 watch 派生,不再重复 onSessionEvent。

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
/* 概览折叠后的恢复小按钮（悬浮于右上） */
.overview-restore-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 48px;
  right: 8px;
  width: 28px;
  height: 56px;
  z-index: 20;
  border: 1px solid var(--gd-color-surface-border);
  border-radius: 8px;
  background: var(--gd-color-dialog-bg, var(--gd-color-surface));
  color: var(--gd-color-text-gray);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.overview-restore-bar:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

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

/* Splitpanes 自定义样式 - 适配暗色模式 */
:deep(.splitpanes.default-theme .splitpanes__pane) {
  background-color: transparent;
}

:deep(.splitpanes.default-theme .splitpanes__splitter) {
  background-color: var(--gd-color-sidebar-bg, #f5f5f5);
  position: relative;
  transition: background-color 0.2s ease;
}

:deep(.dark .splitpanes.default-theme .splitpanes__splitter) {
  background-color: #25262a;
}

/* 悬停时显示主题色（中等浅色） */
:deep(.splitpanes.default-theme .splitpanes__splitter:hover) {
  background-color: var(--el-color-primary-light-8, #d9ecff) !important;
}

/* 移除 Pane 的边框，避免与分割线重叠 */
:deep(.splitpanes.default-theme .splitpanes__pane) {
  background-color: transparent;
  border: none !important;
}

/* 隐藏悬停指示器 */
:deep(.splitpanes.default-theme .splitpanes__splitter:before),
:deep(.splitpanes.default-theme .splitpanes__splitter:after) {
  display: none !important;
}

:deep(.splitpanes.default-theme.splitpanes--vertical .splitpanes__splitter) {
  border-top: 0;
  border-bottom: 0;
  width: 4px !important;
}

/* Splitpanes 过渡动画 */
:deep(.splitpanes__pane) {
  /* transition: width 0.3s ease-out, height 0.3s ease-out; */
  transition: none !important;
  will-change: width;
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
