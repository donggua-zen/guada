<template>
  <div class="flex h-full">
    <!-- 主体内容（侧边栏已移至 MainLayout） -->
    <div class="flex flex-col h-full w-full bg-white dark:bg-[#1a1b1e]">

      <template v-if="sessionStore.activeSessionId !== 'new-session'">
        <!-- 可拖拽分割区域 -->
        <div class="flex-1 overflow-hidden">
          <LiteSplitpanes style="height: 100%;"
            :pane1="{ size: layoutStore.workspaceVisible ? layoutStore.workspaceSplitSize : 100, minSize: 40, maxSize: 100 }"
            :pane2="{ size: layoutStore.workspaceVisible ? (100 - layoutStore.workspaceSplitSize) : 0, minSize: 20, maxSize: 60 }"
            @resize="onPaneResize" @resized="onPaneResized">
            <template #pane1>
              <div ref="paneContentRef" class="chat-pane-content"
                style="height: 100%; display: flex; flex-direction: column;">
                <!-- 页面标题栏 -->
                <PageHeader :title="currentSession?.title || ''">
                  <template #actions>
                    <!-- 工作目录切换 -->
                    <div v-if="currentSession?.id"
                      class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] flex items-center justify-center"
                      @click="layoutStore.toggleWorkspace()"
                      :title="layoutStore.workspaceVisible ? '关闭工作目录' : '打开工作目录'">
                      <el-icon class="w-5 h-5">
                        <FolderOpened />
                      </el-icon>
                    </div>
                    <!-- 记忆管理按钮 -->
                    <div
                      class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] flex items-center justify-center"
                      @click="memoPanelVisible = !memoPanelVisible" title="记忆管理">
                      <el-icon class="w-5 h-5">
                        <Reading />
                      </el-icon>
                    </div>
                    <!-- 更多操作下拉菜单 -->
                    <el-dropdown trigger="hover" @command="handleMoreSelect" popper-class="chat-header-dropdown">
                      <div
                        class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] active:rotate-0 flex items-center justify-center"
                        title="更多操作">
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
                          <!-- <el-dropdown-item command="export">
                            <span class="flex items-center gap-2">
                              <FileDownloadOutlined class="w-4 h-4" />
                              <span>导出记录</span>
                            </span>
                          </el-dropdown-item>
                          <el-dropdown-item command="import">
                            <span class="flex items-center gap-2">
                              <FileUploadOutlined class="w-4 h-4" />
                              <span>导入记录</span>
                            </span>
                          </el-dropdown-item> -->
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </template>
                </PageHeader>

                <ChatPanel ref="chatPanelRef" v-model:session="currentSession"
                  @save-settings="handleSaveSessionSettings" @toggle-workspace-pane="layoutStore.toggleWorkspace" />
                <!-- 右侧大纲导航 -->
                <ChatOutline v-if="currentSession && sessions.length > 0" :messages="chatPanelRef?.activeMessages || []"
                  :chat-panel-ref="chatPanelRef" @scroll-to-message="handleScrollToMessage" />
              </div>
            </template>

            <template #pane2>
              <WorkspaceSidebar v-if="layoutStore.workspaceVisible && currentSession" :session-id="currentSession.id" />
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
  </div>

  <!-- 记忆管理弹窗 -->
  <el-dialog v-model="memoPanelVisible" title="记忆管理" width="390px" :close-on-click-modal="false" destroy-on-close
    class="memo-panel-dialog">
    <MemoPanel v-if="currentSession" :session-id="currentSession.id" />
  </el-dialog>


</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, defineAsyncComponent, type Ref } from "vue";
import { apiService } from "@/services/ApiService";
import { useRouter, useRoute } from 'vue-router';
import { usePopup } from "@/composables/usePopup";
import { useStorage } from '@vueuse/core';
import { useSessionStore } from "@/stores/session";
import { useAuthStore } from "@/stores/auth";
import { useLayoutStore } from "@/stores/layout";
import { useTitle } from '@/composables/useTitle';
import type { Session } from '@/types/session';
import { LiteSplitpanes } from "../ui";

// 引入组件
import PageHeader from "@/components/PageHeader.vue";
import { ElDialog, ElMessageBox, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { Reading, FolderOpened } from '@element-plus/icons-vue';
import {
  MoreVertOutlined,
  DeleteTwotone,
  // FileDownloadOutlined,
  // FileUploadOutlined
} from "@vicons/material";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)

const ChatPanel = defineAsyncComponent(() => import("./ChatPanel.vue"));
const CreateSessionChatPanel = defineAsyncComponent(() => import("./CreateSessionChatPanel.vue"));
const MemoPanel = defineAsyncComponent(() => import("./MemoPanel.vue"));
const ChatOutline = defineAsyncComponent(() => import("./ChatOutline.vue"));
const WorkspaceSidebar = defineAsyncComponent(() => import("./WorkspaceSidebar.vue"));

// 组合式函数
const { toast, confirm } = usePopup();
const router = useRouter();
const route = useRoute();
const title = useTitle();

// 删除会话确认对话框状态

// 当前会话对象，包含会话的基本信息和设置
const currentSession: Ref<Session | null> = ref(null);


// 判断是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

// 会话列表组件引用，用于调用组件内部方法
// ChatPanel 组件引用，用于调用组件内部方法
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const paneContentRef = ref<HTMLElement | null>(null);
let paneSnapWidth = 0;
// 控制设置模态框的显示与隐藏
// 控制记忆管理窗格的显示状态，调试阶段默认打开
const memoPanelVisible = useStorage('memoPanelVisible', false);
// 布局状态
const layoutStore = useLayoutStore();

// 登录信息
const authStore = useAuthStore();
const sessionStore = useSessionStore();

// 计算属性
// 获取和设置会话列表的计算属性，与 store 中的会话列表保持同步
const sessions = computed({
  get() {
    return sessionStore.sessionsList;
  },
  set(value) {
    sessionStore.sessionsList = value;
  }
});


// 业务逻辑函数

/**
 * 根据会话 ID 从 API 获取会话详情
 */
const fetchSession = async (sessionId: string) => {
  try {
    const session = await apiService.fetchSession(sessionId);
    currentSession.value = session;
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
    currentSession.value = null;
  }
};



function onPaneResize() {
  const el = paneContentRef.value;
  if (!el) return;
  if (!paneSnapWidth) {
    paneSnapWidth = el.offsetWidth;
    el.style.width = paneSnapWidth + 'px';
    el.style.flexShrink = '0';
    el.style.flexGrow = '0';
    el.style.width = paneSnapWidth + 'px';
  }
}

function onPaneResized(event: { panes: Array<{ size: number }> }) {
  paneSnapWidth = 0;
  const el = paneContentRef.value;
  if (el) {
    el.style.width = '';
  }

  // 保存工作目录分割位置
  if (layoutStore.workspaceVisible && isElectron && event.panes.length >= 1) {
    layoutStore.setWorkspaceSplitSize(event.panes[0].size);
  }
}

/**
 * 根据会话 ID 更新会话信息
 * 只更新允许的字段，防止意外修改敏感数据
 */
const updateSessionById = async (sessionId: string, data: any) => {
  const session = sessions.value.find(session => session.id === sessionId);
  if (session) {
    // 定义需要更新的字段
    const allowedFields = ['title', 'avatar_url', 'last_message', 'created_at', 'updated_at'];
    const updateData: any = {};

    // 只复制允许的字段
    allowedFields.forEach((field: string) => {
      if (field in data) {
        updateData[field] = data[field];
      }
    });

    // 批量更新
    Object.assign(session, updateData);
  }
};


const updateSelectedSession = async (sessionId: string) => {
  if (sessionId !== currentSession.value?.id) {
    await fetchSession(sessionId);
  }
};


const handleCreateSessionWithMessage = async (session: any, inputMessage: any) => {
  if (!authStore.isAuthenticated)
    return;
  try {
    const response = await apiService.createSession(session)
    // 直接插入会话列表头部
    sessionStore.sessionsList.unshift(response)
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
    if (currentSession.value) {
      await apiService.updateSession(currentSession.value.id, {
        modelId: currentSession.value.modelId,
        settings: currentSession.value.settings,
        workspacePath: currentSession.value.workspacePath
      });
    }
  } catch (error: any) {
    console.error('保存对话设置失败:', error);
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
  if (!currentSession.value) {
    toast.error("当前没有活动的会话");
    return;
  }

  if (await confirm("清空聊天记录", "确定要删除所有聊天记录吗？此操作不可撤销。")) {
    try {
      await apiService.clearSessionMessages(currentSession.value.id);
      sessionStore.clearSessionState(currentSession.value.id);
      // 重新加载消息列表
      const chatPanel = chatPanelRef.value as any;
      if (chatPanel && chatPanel.loadMessages) {
        chatPanel.loadMessages(currentSession.value.id);
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
  const chatPanel = chatPanelRef.value as any;
  if (chatPanel && chatPanel.scrollToMessage) {
    chatPanel.scrollToMessage(messageId);
  }
}

// 监听器

// 监听当前会话的变化，更新页面标题
watch(
  () => currentSession,
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
      currentSession.value = null;
      goChatRoute(null);
      return;
    }
    const sessionId = Array.isArray(newSessionId) ? newSessionId[0] : newSessionId;
    sessionStore.activeSessionId = sessionId;
    if (sessionStore.activeSessionId !== 'new-session')
      await updateSelectedSession(sessionId);
  }
);

// 监听待处理的流会话，触发 ChatPanel 订阅流
watch(
  () => sessionStore.pendingStreamSession,
  (pending) => {
    if (!pending) return;
    const { sessionId, replaceMessageId } = pending;

    // 如果是当前会话，通知 ChatPanel 订阅流
    if (sessionId === currentSession.value?.id) {
      const chatPanel = chatPanelRef.value as any;
      if (chatPanel && chatPanel.subscribeToActiveStream) {
        // 如果存在 replaceMessageId，先删除本地对应消息避免重复
        if (replaceMessageId) {
          const messages = sessionStore.getMessages(sessionId);
          const index = messages.findIndex((m: any) => m.id === replaceMessageId);
          if (index !== -1) {
            messages.splice(index, 1);
          }
        }
        chatPanel.subscribeToActiveStream();
      }
    }

    // 清除待处理状态
    sessionStore.clearPendingStreamSession();
  },
  { immediate: false }
);

// 生命周期
onMounted(async () => {
  const sessionId = Array.isArray(route.params.sessionId) ? route.params.sessionId[0] : route.params.sessionId;
  if (sessionId === 'new-session') {
    sessionStore.activeSessionId = sessionId;
  }
  if (sessionId && sessionId !== "new-session") {
    sessionStore.activeSessionId = sessionId;
    await updateSelectedSession(sessionId);
  } else {
    currentSession.value = null;
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
  padding: 16px 8px;
  /* 更紧凑的内边距 */
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
