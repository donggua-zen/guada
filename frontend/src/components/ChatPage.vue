<template>
  <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'" :z-index="50">
    <template #sidebar>
      <template v-if="authStore.isAuthenticated">
        <chat-sidebar ref="chatSidebarRef" :sessions="sortedSessions" :current="currentSession"
          @select="goChatRoute($event)" @delete="handleDeleteSession" @rename="handleRenameSession"
          @create="handleCreateSession" />
      </template>
      <template v-else>
        <div
          class="h-full w-full flex-1 flex items-center justify-center bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)]">
          <el-empty description="请先登录" />
        </div>
      </template>
    </template>
    <template v-if="!isLoading" #content>
      <!-- 主体内容 -->
      <template v-if="sessions.length > 0 && currentSession">
        <ChatPanel ref="chatPanelRef" v-model:session="currentSession" v-model:sidebar-visible="sidebarVisible"
          @openSettings="handleOpenSettings" @save-settings="handleSaveSessionSettings" />
        <el-dialog v-model="sessionSettingsModalVisible" :append-to-body="true" style="width: 600px;max-width: 90vw;"
          title="对话设置">
          <div class="max-h-[80vh] overflow-y-auto">
            <session-setting-panel :data="currentSession" @update:data="updateSession" :simple="true"
              :tab="currentTabValue" />
          </div>
        </el-dialog>
      </template>
      <template v-else>
        <div class="h-full flex-1 flex items-center justify-center">
          <CreateSessionChatPanel 
            v-model:sidebar-visible="sidebarVisible"
            @create-session="handleCreateSessionWithMessage" 
          />
        </div>
      </template>
    </template>
  </SidebarLayout>
</template>
<script setup lang="ts">
import { ref, onMounted, watch, computed, defineAsyncComponent, type Ref } from "vue";
import { apiService } from "@/services/ApiService";
import { useRouter, useRoute, type RouteParams } from 'vue-router';
import { usePopup } from "@/composables/usePopup";
import { useStorage } from '@vueuse/core';
import { useSessionStore } from "@/stores/session";
import { useAuthStore } from "@/stores/auth";
import { useTitle } from '@/composables/useTitle';
import type { Session } from '@/types/session';

// 引入组件
// @ts-ignore - UI 组件尚未迁移到 TypeScript
import { SidebarLayout } from "./ui";
import ChatSidebar from "@/components/ChatSidebar.vue";
import { ElDialog, ElEmpty } from "element-plus";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

const SessionSettingPanel = defineAsyncComponent(() => import("@/components/SessionSettingPanel.vue"));
const ChatPanel = defineAsyncComponent(() => import("@/components/ChatPanel.vue"));
const CreateSessionChatPanel = defineAsyncComponent(() => import("@/components/CreateSessionChatPanel.vue"));

// 组合式函数
const { confirm, toast, prompt } = usePopup();
const router = useRouter();
const route = useRoute();
const title = useTitle();

// 当前会话对象，包含会话的基本信息和设置
const currentSession: Ref<Session | null> = ref(null);

// 会话列表组件引用，用于调用组件内部方法
const chatSidebarRef = ref<InstanceType<typeof ChatSidebar> | null>(null);
// 设置面板当前激活的标签页
const currentTabValue = ref<'basic' | string>('basic');
// 控制设置模态框的显示与隐藏
const sessionSettingsModalVisible = ref(false);
// 控制侧边栏的显示状态，使用本地存储保持用户偏好
const sidebarVisible = useStorage('sidebarVisible', true);

const isLoading = ref(true);

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

// 获取按最后活跃时间降序排序的会话列表，最新的对话排在前面
// ✅ 修复：使用 last_active_at 优先排序，与后端数据库排序逻辑一致
const sortedSessions = computed(() => {
  const sessions_ = [...sessions.value];
  return sessions_.sort((a, b) => {
    // ✅ 主要排序：last_active_at（最后活跃时间）
    const timeA: number = a.last_active_at 
      ? new Date(a.last_active_at).getTime()
      : (a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at || 0).getTime());
    const timeB: number = b.last_active_at 
      ? new Date(b.last_active_at).getTime()
      : (b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at || 0).getTime());
    return timeB - timeA; // 降序排列，最新的在前面
  });
});

// 业务逻辑函数

/**
 * 根据会话 ID 从 API 获取会话详情
 */
const fetchSession = async (sessionId: string) => {
  const session = await apiService.fetchSession(sessionId);
  currentSession.value = session;
};

/**
 * 选择会话，加载会话详情
 */
const goChatRoute = async (sessionId: string | null) => {
  if (isMobile.value) {
    sidebarVisible.value = false;
  }
  if (sessionId) {
    router.replace({ name: 'Chat', params: { sessionId: sessionId } });
  } else if (sessionStore.activeSessionId) {
    router.replace({ name: 'Chat', params: { sessionId: sessionStore.activeSessionId } });
  } else {
    router.replace({ name: 'Chat', params: { sessionId: null } });
    currentSession.value = null;
  }
};

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

/**
 * 更新当前会话的设置
 * 合并现有设置与新设置，并关闭设置模态框
 */
const updateSession = async (data: any) => {
  let session = null;
  try {
    if (currentSession.value && currentSession.value.id) {
      // 合并设置
      data.character = currentSession.value.character;
      data.settings = { ...currentSession.value.settings, ...data.settings };
      await apiService.updateSession(currentSession.value.id, data);
      session = { id: currentSession.value.id, ...data, updated_at: new Date().toISOString() };
      currentSession.value = session;
    }
    toast.success("设置成功");
  } catch (error) {
    console.error('更新对话失败:', error);
    toast.error("设置失败");
  }
  sessionSettingsModalVisible.value = false;
};

const updateSelectedSession = async (sessionId: string) => {
  if (sortedSessions.value.length === 0 || !authStore.isAuthenticated || !sessionId) {
    currentSession.value = null;
    return;
  }

  const session = sortedSessions.value.find(s => s.id === sessionId);
  if (!session) {
    currentSession.value = null;
    return;
  }
  if (session.id !== currentSession.value?.id) {
    await fetchSession(session.id);
  }
};

/**
 * 加载会话列表
 * 从 API 获取会话列表，更新本地数据
 */
const loadSessions = async () => {
  try {
    const data = await apiService.fetchSessions();
    sessions.value = data.items;
  } catch (error) {
    console.error('获取对话列表失败:', error);
  }
};

// 事件处理函数

/**
 * 打开设置面板，设置为基本设置标签页
 */
const handleOpenSettings = () => {
  currentTabValue.value = 'basic';
  sessionSettingsModalVisible.value = true;
};

/**
 * 创建新会话
 */
const handleCreateSession = async () => {
  router.replace({ name: 'Chat', params: { sessionId: null } });
  currentSession.value = null;
};

const handleCreateSessionWithMessage = async (session: any, inputMessage: any) => {
  if (!authStore.isAuthenticated)
    return;
  try {
    const response = await apiService.createSession(session)
    // 刷新对话列表
    await loadSessions();
    console.log('Created session:', session,inputMessage);
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
 * 重命名会话
 * 显示输入新名称的提示框，更新会话标题
 * @param {Object} session - 要重命名的会话对象
 */
const handleRenameSession = async (session: any) => {
  try {
    const result = await prompt("重命名对话", {
      placeholder: "请输入对话名称",
      defaultValue: session.title
    });

    if (result) {
      const newTitle = result;

      // 更新对话数据
      const updatedSession = {
        title: newTitle
      };

      // 调用 API 更新对话
      await apiService.updateSession(session.id, updatedSession);

      currentSession.value = { ...session, title: newTitle };

      toast.success("对话重命名成功");
    }
  } catch (error) {
    console.error('重命名对话失败:', error);
    toast.error("对话重命名失败");
  }
};

/**
 * 删除会话
 * 显示确认删除的提示框，删除会话后从列表中移除
 * @param {Object} session - 要删除的会话对象
 */
const handleDeleteSession = async (session: any) => {
  try {
    if (await confirm("确认删除", "确定要删除这个对话吗？此操作不可撤销。")) {
      await apiService.deleteSession(session.id);
      sessionStore.clearSessionState(session.id);
      const index = sortedSessions.value.findIndex(s => s.id === session.id);
      // 如果删除的是当前会话
      if (currentSession.value && currentSession.value.id === session.id) {
        if (index < sortedSessions.value.length - 1) {
          // 选择下一个会话
          goChatRoute(sortedSessions.value[index + 1].id);
        } else if (index > 0) {
          goChatRoute(sortedSessions.value[index - 1].id);
        } else {
          // 没有其他会话了
          goChatRoute(null);
        }
      }
      sessions.value = sessions.value.filter(s => s.id !== session.id);
      toast.success("对话删除成功");
    }
  } catch (error) {
    console.error('删除对话失败:', error);
    toast.error("对话删除失败");
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
        model_id: currentSession.value.model_id, 
        settings: currentSession.value.settings 
      });
    }
  } catch (error: any) {
    console.error('保存对话设置失败:', error);
  }
};

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
  (newSessionId) => {
    if (isLoading.value)
      return;
    if (!newSessionId) {
      currentSession.value = null;
      return;
    }
    const sessionId = Array.isArray(newSessionId) ? newSessionId[0] : newSessionId;
    sessionStore.activeSessionId = sessionId;
    updateSelectedSession(sessionId);
  },
  { immediate: true }
);

// 生命周期
// 组件挂载完成后加载会话列表
onMounted(async () => {
  if (authStore.isAuthenticated) {
    await loadSessions();
    if (route.params.sessionId) {
      const sessionId = Array.isArray(route.params.sessionId) ? route.params.sessionId[0] : route.params.sessionId;
      sessionStore.activeSessionId = sessionId;
      updateSelectedSession(sessionId);
    }
  }
  isLoading.value = false;
});
</script>
