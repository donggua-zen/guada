<template>
  <!-- 主体内容（侧边栏已移至 MainLayout） -->
  <div class="flex flex-col h-full w-full">
    <template v-if="sessionStore.activeSessionId !== 'new-session'">
      <!-- 可拖拽分割区域 -->
      <div class="flex-1 overflow-hidden">
        <LiteSplitpanes style="height: 100%;" :split-size="layoutStore.workspaceVisible ? workspaceSize : 100"
          :min-size="30" :max-size="85" :min-pane2-size="320" @resize="onPaneResize" @resized="onPaneResized">
          <template #pane1>
            <div ref="paneContentRef" class="chat-pane-content"
              style="height: 100%; display: flex; flex-direction: column;">
              <!-- 页面标题栏 -->
              <PageHeader :title="mainSession?.title || ''" :hide-window-controls="layoutStore.workspaceVisible">
                <template #actions>
                  <!-- 工作目录切换 -->
                  <el-tooltip v-if="mainSession?.id" :content="layoutStore.workspaceVisible ? '关闭工作目录' : '打开工作目录'" placement="bottom">
                  <div class="header-icon-btn" :class="{ active: layoutStore.workspaceVisible }"
                    @click="layoutStore.toggleWorkspace()">
                    <PanelRightExpand20Filled class="w-5 h-5" />
                  </div>
                  </el-tooltip>
                  <!-- 更多操作下拉菜单 -->
                  <el-dropdown trigger="hover" @command="handleMoreSelect" popper-class="chat-header-dropdown">
                    <div class="header-icon-btn">
                      <MoreVertOutlined class="w-5 h-5" />
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="clear">
                          <span class="flex items-center gap-2">
                            <DeleteTwotone class="w-4 h-4" />
                            <span>清空记录</span>
                          </span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </PageHeader>

              <!-- 会话面板：主会话和子 Agent 共用同一个 ChatPanel，通过 session 切换 -->
              <ChatPanel ref="chatPanelRef" :session="panelSession" :readonly="activeTabId !== 'main'"
                :hide-header="activeTabId !== 'main'"
                @save-settings="handleSaveSessionSettings"
                @select-character="handleSelectCharacter" />

              <!-- 右侧大纲导航 -->
              <ChatOutline v-if="mainSession && activeTabId === 'main'" :messages="chatPanelRef?.activeMessages || []"
                :chat-panel-ref="chatPanelRef" @scroll-to-message="handleScrollToMessage" />
            </div>
          </template>

          <template #pane2>
            <WorkspaceSidebar v-if="layoutStore.workspaceVisible && mainSession" :session-id="mainSession.id"
              :agent-tabs="agentTabs" :active-tab-id="activeTabId"
              @switch-agent="switchTab" @insert-to-input="handleInsertToInput" />
          </template>
        </LiteSplitpanes>
      </div>
    </template>
    <template v-else>
      <!-- 新建对话头部 -->
      <PageHeader title="新建对话" />
      <CreateSessionChatPanel @create-session="handleCreateSessionWithMessage" />
    </template>
  </div>




</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, defineAsyncComponent, type Ref } from "vue";
import { apiService } from "@/services/ApiService";
import { useRouter, useRoute } from 'vue-router';
import { usePopup } from "@/composables/usePopup";
import { useSessionStore } from "@/stores/session";
import { useAuthStore } from "@/stores/auth";
import { useLayoutStore } from "@/stores/layout";
import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { useTitle } from '@/composables/useTitle';
import type { Session } from '@/types/session';
import type { Character } from '@/types/character';
import { LiteSplitpanes } from "../ui";
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
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import {
  MoreVertOutlined,
  DeleteTwotone,
  // FileDownloadOutlined,
  // FileUploadOutlined
} from "@vicons/material";
import { PanelRightExpand20Filled } from "@vicons/fluent";


const ChatOutline = defineAsyncComponent(() => import("./ChatOutline.vue"));
const WorkspaceSidebar = defineAsyncComponent(() => import("./WorkspaceSidebar.vue"));

// 子 Agent Tab 状态
const agentTabs = ref<AgentTab[]>([
  { id: 'main', name: '主会话', status: 'completed', loaded: true }
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
  const name = payload.name || '子任务';
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
 * 处理流开始事件（统一的状态来源）
 *
 * 包括主会话和子 Agent 会话的流开始，根据 sessionId 匹配更新状态。
 */
function handleStreamStarted(event: any) {
  const { sessionId } = event;
  if (!sessionId) return;

  // 更新对应 Tab 状态为 running（子 Agent 按 sessionId 匹配）
  const tab = agentTabs.value.find(t => t.id === sessionId);
  if (tab) {
    tab.status = 'running';
  }
  // 主会话流开始：同步更新 main Tab 状态
  if (sessionId === mainSession.value?.id) {
    const mainTab = agentTabs.value.find(t => t.id === 'main');
    if (mainTab) mainTab.status = 'running';
  }
  // 忽略自身发起的流
  if (event.source === apiService.getClientId()) {
    return;
  }

  // 如果是主会话的流，通知 ChatPanel 订阅流
  if (sessionId === mainSession.value?.id) {
    const chatPanel = chatPanelRef.value;
    if (chatPanel && chatPanel.subscribeToActiveStream) {
      const replaceMessageId = event.payload?.replaceMessageId;
      if (replaceMessageId) {
        const messages = sessionStore.getMessages(sessionId);
        const index = messages.findIndex((m: any) => m.id === replaceMessageId);
        if (index !== -1) {
          messages.splice(index, 1);
        }
      }
      chatPanel.subscribeToActiveStream();
    }
    return;
  }


}

/**
 * 处理流结束事件（统一的状态来源）
 *
 * 根据 reason 判断子 Agent 的最终状态。
 */
function handleStreamFinished(event: any) {
  const { sessionId, payload } = event;
  if (!sessionId) return;

  // 更新对应 Tab 状态（子 Agent 按 sessionId 匹配）
  const tab = agentTabs.value.find(t => t.id === sessionId);
  if (tab) {
    const reason = payload?.reason;
    tab.status = reason === 'completed' ? 'completed' : 'error';
  }
  // 主会话流结束：同步更新 main Tab 状态
  if (sessionId === mainSession.value?.id) {
    const mainTab = agentTabs.value.find(t => t.id === 'main');
    if (mainTab) {
      const reason = payload?.reason;
      mainTab.status = reason === 'completed' ? 'completed' : 'error';
    }
  }
}

/**
 * 切换 Tab
 */
async function switchTab(tabId: string) {
  activeTabId.value = tabId;
}

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
// 根据当前模式计算工作目录分割比例
const workspaceSize = computed(() =>
  layoutStore.workspacePreviewMode ? layoutStore.workspacePreviewSplitSize : layoutStore.workspaceSplitSize,
);
// 控制设置模态框的显示与隐藏
// 布局状态
const layoutStore = useLayoutStore();
// 浏览器 webview store（会话切换时同步当前会话 ID）
const browserWebviewStore = useBrowserWebviewStore();

// 登录信息
const authStore = useAuthStore();
const sessionStore = useSessionStore();

// SSE 事件监听取消函数
let unsubscribeStreamStarted: (() => void) | null = null;
let unsubscribeStreamFinished: (() => void) | null = null;
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
        mainTab || { id: 'main', name: '主会话', status: 'completed', loaded: true },
        ...subSessions.value.map((sub) => ({
          id: sub.id,
          name: sub.title || '子任务',
          status: (sub.isStreaming ? 'running' : 'completed') as 'running' | 'completed' | 'error',
          loaded: true,
        })),
      ];
    }
  } catch (error) {
    console.error('获取会话详情失败:', error);
    toast.error("获取会话详情失败");
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

  // 保存工作目录分割位置（根据当前模式分别保存）
  if (layoutStore.workspaceVisible && isElectron) {
    if (layoutStore.workspacePreviewMode) {
      layoutStore.setWorkspacePreviewSplitSize(size);
    } else {
      layoutStore.setWorkspaceSplitSize(size);
    }
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


const updateSelectedSession = async (sessionId: string) => {
  if (sessionId == null || sessionId === 'new-session') {
    mainSession.value = null;
    sessionStore.activeSessionId = "new-session";
    layoutStore.workspacePreviewMode = false;
    return;
  }
  sessionStore.activeSessionId = sessionId;
  if (sessionId !== mainSession.value?.id) {
    // 切换会话时重置子代理状态到主线程
    activeTabId.value = 'main';
    agentTabs.value = [{ id: 'main', name: '主会话', status: 'completed', loaded: true }];
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
    toast.error("创建对话失败");
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
    toast.error('切换角色失败');
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
    toast.error("当前没有活动的会话");
    return;
  }

  if (await confirm("清空聊天记录", "确定要删除所有聊天记录吗？此操作不可撤销。")) {
    try {
      await apiService.clearSessionMessages(mainSession.value.id);
      sessionStore.clearSessionMessages(mainSession.value.id);
      // 重新加载消息列表
      const chatPanel = chatPanelRef.value;
      if (chatPanel && chatPanel.loadMessages) {
        chatPanel.loadMessages(mainSession.value.id);
      }
      toast.success("聊天记录已清空");
    } catch (error) {
      console.error('清空聊天记录失败:', error);
      toast.error("清空失败");
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

// 监听器

// 监听当前会话的变化，更新页面标题
watch(
  () => mainSession,
  (session) => {
    if (session.value) {
      title.value = `${session.value.title}-对话`;
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

  // 注册流事件监听（统一的状态来源）
  unsubscribeStreamStarted = apiService.onSessionEvent('stream_started', handleStreamStarted);
  unsubscribeStreamFinished = apiService.onSessionEvent('stream_finished', handleStreamFinished);

  // 注册子 Agent 生命周期事件监听（仅负责增删 Tab）
  unsubscribeSubAgentCreate = apiService.onSessionEvent('sub_agent_create', handleSubAgentCreate);
  unsubscribeSubAgentClosed = apiService.onSessionEvent('sub_agent_closed', handleSubAgentClosed);
});

// 工作目录隐藏时重置预览模式状态
watch(() => layoutStore.workspaceVisible, (visible) => {
  if (!visible) {
    layoutStore.workspacePreviewMode = false;
  }
});

// 组件卸载时取消监听
onUnmounted(() => {
  if (unsubscribeStreamStarted) {
    unsubscribeStreamStarted();
    unsubscribeStreamStarted = null;
  }
  if (unsubscribeStreamFinished) {
    unsubscribeStreamFinished();
    unsubscribeStreamFinished = null;
  }
  if (unsubscribeSubAgentCreate) {
    unsubscribeSubAgentCreate();
    unsubscribeSubAgentCreate = null;
  }
  if (unsubscribeSubAgentClosed) {
    unsubscribeSubAgentClosed();
    unsubscribeSubAgentClosed = null;
  }
});


</script>

<style scoped>
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
  background-color: var(--color-surface, #f5f5f5);
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
/* 记忆管理弹窗样式（非scoped，用于覆盖el-dialog默认样式） */
.memo-panel-dialog .el-dialog__body {
  padding: 20px 16px;
  /* 更宽松的内边距 */
  max-height: 65vh;
  /* 稍微减小最大高度 */
  overflow-y: auto;
}

/* 优化弹窗标题栏 */
.memo-panel-dialog .el-dialog__header {
  padding: 12px 16px;
  /* 减小标题栏内边距 */
  margin: 0;
}

/* 优化弹窗底部 */
.memo-panel-dialog .el-dialog__footer {
  padding: 8px 16px;
  /* 如果有footer，也减小内边距 */
}

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
