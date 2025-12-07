<template>
  <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'">
    <template #sidebar>
      <template v-if="authStore.isAuthenticated">
        <sessions-list ref="sessionsListRef" :btn-active="targetPage" :sessions="sortedSessions"
          :current="currentSession" @select="selectSession" @delete="handleDeleteSession" @rename="handleRenameSession"
          @btn-click="handleSidebarClick" />
      </template>
      <template v-else>
        <div
          class="h-full w-full flex-1 flex items-center justify-center bg-[var(--conversation-bg)] border-r border-[var(--conversation-border-color)]">
          <n-empty description="请先登录">
            <template #extra>
            </template>
          </n-empty>
        </div>
      </template>
    </template>
    <template v-if="!isLoading" #content>
      <!-- 主体 -->
      <template v-if="targetPage == 'characters'">
        <CharactersPanel @create-session="handleCreateSessionWithMessage" />
      </template>
      <template v-else-if="targetPage == 'new-session'">
        <div class="h-full flex-1 flex items-center justify-center">
          <CreateSessionChatPanel @create-session="handleCreateSessionWithMessage" />
        </div>
      </template>
      <template v-else-if="sessions.length > 0 && currentSession">
        <ChatPanel ref="chatPanelRef" v-model:session="currentSession" v-model:sidebar-visible="sidebarVisible"
          @openSettings="handleOpenSettings" @openSwitchModel="handleOpenSwitchModel"
          @saveSettings="handleSaveSessionSettings" />
        <n-modal v-model:show="settingsModalVisible" :mask-closable="false" :auto-focus="false"
          style="width: 600px;max-width: 90vw;" title="对话设置" preset="card">
          <div class="max-h-80vh overflow-y-auto">
            <CharacterSettingPanel :data="currentSession" @update:data="updateSession" :simple="true"
              :tab="currentTabValue" />
          </div>
        </n-modal>
      </template>

    </template>
  </SidebarLayout>
</template>

<script setup>
import { ref, onMounted, watch, computed, nextTick, defineAsyncComponent } from "vue";
import { apiService } from "@/services/ApiService";
import { useRouter, useRoute } from 'vue-router';
import { NModal, NEmpty } from "naive-ui";
import { usePopup } from "@/composables/usePopup";
import { useStorage } from '@vueuse/core';
import { store } from "@/stores/store";
import { useAuthStore } from "@/stores/auth";
import { useTitle } from '@/composables/useTitle';

// 引入组件
import SidebarLayout from "@/components/layout/SidebarLayout.vue";
import SessionsList from "@/components/SessionsList.vue";
// 将 CharacterSettingPanel 改为动态引入
const CharacterSettingPanel = defineAsyncComponent(() => import("@/components/CharacterSettingPanel.vue"));
import ChatPanel from "@/components/ChatPanel.vue";
// import CreateSessionChatPanel from "@/components/CreateSessionChatPanel.vue";
const CreateSessionChatPanel = defineAsyncComponent(() => import("@/components/CreateSessionChatPanel.vue"));
const CharactersPanel = defineAsyncComponent(() => import("@/components/CharactersPage.vue"));

// 组合式函数
const { confirm, toast, prompt } = usePopup();
const router = useRouter();
const route = useRoute();
const title = useTitle();

// 响应式数据
const chatPanelRef = ref(null);
// 当前会话对象，包含会话的基本信息和设置
const currentSession = ref(null);

// 会话列表组件引用，用于调用组件内部方法
const sessionsListRef = ref(null);
// 设置面板当前激活的标签页
const currentTabValue = ref('basic');
// 控制设置模态框的显示与隐藏
const settingsModalVisible = ref(false);
// 控制侧边栏的显示状态，使用本地存储保持用户偏好
const sidebarVisible = useStorage('sidebarVisible', true);

const isLoading = ref(true);
const targetPage = ref(null);

// 登录信息

const authStore = useAuthStore();

// 计算属性
// 获取和设置会话列表的计算属性，与store中的会话列表保持同步
const sessions = computed({
  get() {
    return store.getSessionsList();
  },
  set(value) {
    store.setSessionsList(value);
  }
});

// 获取按更新时间排序的会话列表，最新的会话排在前面
// 如果会话没有更新时间，则使用创建时间进行排序
const sortedSessions = computed(() => {
  const sessions_ = [...sessions.value];
  return sessions_.sort((a, b) => {
    const timeA = a.updated_at ? new Date(a.updated_at) : new Date(a.created_at || 0);
    const timeB = b.updated_at ? new Date(b.updated_at) : new Date(b.created_at || 0);
    return timeB - timeA; // 降序排列，最新的在前面
  });
});

// 业务逻辑函数

/**
 * 根据会话ID从API获取会话详情
 * @param {string|number} sessionId - 会话的唯一标识符
 */
const fetchSession = async (sessionId) => {
  const session = await apiService.fetchSession(sessionId);
  currentSession.value = session;
};

/**
 * 选择会话，加载会话详情
 * @param {Object} session - 包含会话信息的对象
 */
const selectSession = async (session) => {
  if (session && session.id) {
    router.replace({ name: 'Chat', params: { sessionId: session.id } });
    store.setActiveSessionId(session.id);
    await fetchSession(session.id);
  } else {
    router.replace({ name: 'Chat', params: { sessionId: 'new-session' } });
    store.setActiveSessionId(null);
    currentSession.value = null;
  }
};

/**
 * 根据会话ID更新会话信息
 * 只更新允许的字段，防止意外修改敏感数据
 * @param {string|number} sessionId - 会话的唯一标识符
 * @param {Object} data - 包含要更新的数据的对象
 */
const updateSessionById = async (sessionId, data) => {
  console.log('会话更新:', sessionId);
  // console.trace();
  const session = sessions.value.find(session => session.id === sessionId);
  if (session) {
    // 定义需要更新的字段
    const allowedFields = ['title', 'avatar_url', 'last_message', 'created_at', 'updated_at'];
    const updateData = {};

    // 只复制允许的字段
    allowedFields.forEach(field => {
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
 * 合并现有设置与新设置，上传头像（如果存在），并关闭设置模态框
 * @param {Object} data - 包含新设置的数据对象
 */
const updateSession = async (data) => {
  let session = null;
  try {
    if (currentSession.value && currentSession.value.id) {
      // 合并设置
      data.settings = { ...currentSession.value.settings, ...data.settings };
      await apiService.updateSession(currentSession.value.id, data);
      session = { id: currentSession.value.id, ...data };

      if (session && data.avatar_file) {
        const response = await apiService.uploadAvatar(currentSession.value.id, data.avatar_file, 'session');
        session.avatar_url = response.url;
      }
      currentSession.value = session;
    }
    toast.success("设置成功");
  } catch (error) {
    console.error('更新对话失败:', error);
    toast.error("设置失败");
  }
  settingsModalVisible.value = false;
};

/**
 * 更新选中的会话
 * 优先级：URL参数中的会话ID > 存储中的活动会话ID > 列表中的第一个会话
 * @param {string|number|null} sessionId - 要选择的会话ID，如果为null则使用存储中的ID
 */
const updateSelectedSession = async (sessionId) => {
  if (sortedSessions.value.length === 0 || !authStore.isAuthenticated) {
    selectSession(null);
    return;
  }

  // 如果传入了sessionId，直接查找并选择
  if (sessionId) {
    const session = sortedSessions.value.find(s => s.id === sessionId);
    if (session) {
      if (session.id !== currentSession.value?.id) {
        await selectSession(session);
      }
      return;
    }
  } else {
    // 如果没有传入sessionId，尝试使用存储中的活动会话ID
    const storeCurrentSessionId = store.activeSessionId;
    if (storeCurrentSessionId) {
      const session = sortedSessions.value.find(s => s.id === storeCurrentSessionId);
      if (session) {
        await selectSession(session);
      }
      return;
    }
  }

  // 如果没有找到会话，选择第一个会话
  // selectSession(sortedSessions.value[0]);
  selectSession(null);
};

/**
 * 加载会话列表
 * 从API获取会话列表，更新本地数据，并根据URL参数选择会话
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
  settingsModalVisible.value = true;
};

/**
 * 打开设置面板，设置为模型设置标签页
 */
const handleOpenSwitchModel = () => {
  currentTabValue.value = 'model';
  settingsModalVisible.value = true;
};

/**
 * 创建新会话
 * 显示输入对话名称的提示框，创建新会话后刷新列表并自动选择新会话
 */
const handleSidebarClick = async (key) => {
  if (key === 'create') {
    selectSession(null);
  } else if (key === 'characters') {
    router.replace({ name: 'Chat', params: { sessionId: 'characters' } });
  }

};

const handleCreateSessionWithMessage = async (session, inputMessage) => {
  if (!authStore.isAuthenticated)
    return;
  const response = await apiService.createSession(session)
  // 刷新对话列表
  await loadSessions();
  if (inputMessage) {
    inputMessage.isWaiting = true
    store.setInputMessage(response.id, inputMessage)
  }
  await selectSession(response);
};

/**
 * 重命名会话
 * 显示输入新名称的提示框，更新会话标题
 * @param {Object} session - 要重命名的会话对象
 */
const handleRenameSession = async (session) => {
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

      // 调用API更新对话
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
const handleDeleteSession = async (session) => {
  try {
    if (await confirm("确认删除", "确定要删除这个对话吗？此操作不可撤销。")) {
      await apiService.deleteSession(session.id);
      const index = sortedSessions.value.findIndex(s => s.id === session.id);
      // 如果删除的是当前会话
      if (currentSession.value && currentSession.value.id === session.id) {
        if (index < sortedSessions.value.length - 1) {
          // 选择下一个会话
          await selectSession(sortedSessions.value[index + 1]);
        } else if (index > 1) {
          await selectSession(sortedSessions.value[index - 1]);
        } else {
          // 没有其他会话了
          currentSession.value = { id: null };
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
    await apiService.updateSession(currentSession.value.id, { settings: currentSession.value.settings });
  } catch (error) {
    console.error('保存对话设置失败:', error);
  }
};

// 监听器

// 监听当前会话的变化，更新页面标题、路由参数和存储中的活动会话ID
// 同时更新会话列表中的会话信息
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

// 监听会话列表的变化，更新选中的会话
// watch(
//   () => sessions,
//   () => {
//     if (route.params.sessionId === 'new-session')
//       return;
//     updateSelectedSession(route.params.sessionId);
//   },
//   { deep: true }
// );
const specialRoutes = ['new-session', 'characters'];
// 监听路由参数中会话ID的变化，更新选中的会话
watch(
  () => route.params.sessionId,
  (newSessionId) => {
    if (specialRoutes.includes(newSessionId)) {
      targetPage.value = newSessionId;
      currentSession.value = null;
      return;
    }
    if (newSessionId !== currentSession.value?.id) {
      targetPage.value = null;
      updateSelectedSession(newSessionId);
    }
  }
);

// 生命周期
// 组件挂载完成后加载会话列表
onMounted(async () => {
  if (authStore.isAuthenticated) {
    await loadSessions();
    const pathSessionId = route.params.sessionId;
    if (specialRoutes.includes(pathSessionId))
      targetPage.value = pathSessionId;
    else
      await updateSelectedSession(pathSessionId);
  }
  isLoading.value = false;
});
</script>

<style scoped>
.max-h-80vh {
  max-height: 80vh;
}
</style>
