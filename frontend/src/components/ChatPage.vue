<template>
  <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'">
    <template #sidebar>
      <sessions-list ref="sessionsListRef" :sessions="sessions" @select="selectSession" @delete="handleDeleteSession"
        @rename="handleRenameSession" @create="handleCreateSession" />
    </template>
    <template #content>
      <!-- 主体 -->
      <template v-if="sessions.length > 0">
        <ChatPanel v-model:session="currentSession" v-model:sidebar-visible="sidebarVisible"
          @openSettings="handleOpenSettings" @openSwitchModel="handleOpenSwitchModel"
          @saveSettings="handleSaveSessionSettings" />
        <n-modal v-model:show="visible" :mask-closable="false" :auto-focus="false" style="width: 600px;max-width: 90vw;"
          title="对话设置" preset="card">
          <div class="max-h-80vh overflow-y-auto">
            <CharacterSettingPanel :data="currentSession" @update:data="updateSession" :simple="true"
              :tab="currentTabValue" />
          </div>
        </n-modal>
      </template>
      <template v-else>
        <div class="h-full flex-1 flex items-center justify-center">
          <n-empty description="你什么也找不到">
            <!-- <template #extra>
            <n-button size="small">
              看看别的
            </n-button>
          </template> -->
          </n-empty>
        </div>
      </template>
    </template>
  </SidebarLayout>
</template>

<script setup>
import { ref, onMounted, watch } from "vue";
import { apiService } from "@/services/ApiService";
import { useRouter } from 'vue-router'
import { NEmpty, NModal, NIcon } from "naive-ui";
import { usePopup } from "@/composables/usePopup";
import { useStorage } from '@vueuse/core'
import { store } from "@/store/store"
import { computed } from "vue";
const { confirm, toast, prompt } = usePopup();

// 引入组件
import SidebarLayout from "@/components/layout/SidebarLayout.vue";
import SessionsList from "@/components/SessionsList.vue";
import CharacterSettingPanel from "@/components/CharacterSettingPanel.vue";
import ChatPanel from "@/components/ChatPanel.vue";

const router = useRouter();

const currentSession = ref({
  id: null,
});

const sessionsListRef = ref(null);
const sessions = computed({
  get() {
    return store.getSessionsList();
  },
  set(value) {
    store.setSessionsList(value);
  }
});
const visible = ref(false);
const currentTabValue = ref('basic');
const sidebarVisible = useStorage('sidebarVisible', true); // 控制侧边栏显示状态

const fetchSession = async (sessionId) => {
  // const session_cache = sessions.value.find(session => session.id === sessionId);
  // if (session_cache) {
  //   currentSession.value = session_cache;
  // }
  const session = await apiService.fetchSession(sessionId);
  currentSession.value = session;
};

const selectSession = async (session) => {
  if (session.id) {
    await fetchSession(session.id);
  }
};

const updateSessionById = async (sessionId, data) => {
  console.log('更新对话时间:', sessionId);
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
}

watch(() => currentSession, (session) => {
  updateSessionById(session.value.id, session.value);
}, { deep: true });

const updateSession = async (data) => {
  let session = null;
  try {
    if (currentSession.value && currentSession.value.id) {
      data['settings'] = { ...currentSession.value.settings, ...data.settings }; // 合并设置
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
    console.error('更新对话失败:', error)
    toast.error("设置失败");
  }
  visible.value = false;
};

const handleOpenSettings = () => {
  currentTabValue.value = 'basic';
  visible.value = true;
}

const handleOpenSwitchModel = () => {
  currentTabValue.value = 'model';
  visible.value = true;
}

const handleCreateSession = async () => {
  try {
    const result = await prompt("新建对话", {
      placeholder: "请输入对话名称",
      defaultValue: "新建对话"
    });
    if (result) {
      const title = result

      // 调用API创建对话
      const newSession = await apiService.createSession(title)

      // 刷新对话列表
      await loadSessions()

      // 自动选择新创建的对话
      router.replace({ name: 'Chat', params: { sessionId: newSession['id'] } });

      toast.success("对话创建成功");
    }
  } catch (error) {
    console.error('创建对话失败:', error)
    toast.error("对话创建失败");
  }
}

// 重命名对话
const handleRenameSession = async (session) => {
  try {
    const result = await prompt("新建对话", {
      placeholder: "请输入对话名称",
      defaultValue: session.title
    });

    if (result) {
      const newTitle = result

      // 更新对话数据
      const updatedSession = {
        title: newTitle
      }

      // 调用API更新对话
      await apiService.updateSession(session.id, updatedSession)

      // updateSessionById(session.id, updatedSession);

      currentSession.value = { ...session, title: newTitle }

      toast.success("对话重命名成功");
    }
  } catch (error) {
    console.error('重命名对话失败:', error)
    toast.error("对话重命名失败");
  }
}

// 删除对话
const handleDeleteSession = async (session) => {
  try {
    if (await confirm("确认删除", "确定要删除这个对话吗？此操作不可撤销。")) {
      await apiService.deleteSession(session.id)
      sessions.value = sessions.value.filter(s => s.id !== session.id);
      toast.success("对话删除成功");
    }
  } catch (error) {
    console.error('删除对话失败:', error)
    toast.error("对话删除失败");
  }
}

const handleSaveSessionSettings = async () => {
  try {
    await apiService.updateSession(currentSession.value.id, { settings: currentSession.value.settings });
    // currentSession.value.updated_at = new Datetime //2025-11-24T16:32:21.538968+08:00
  } catch (error) {
    console.error('保存对话失败:', error)
  }
}

// 加载对话列表
const loadSessions = async () => {
  try {
    const data = await apiService.fetchSessions()
    sessions.value = data.items;
  } catch (error) {
    console.error('获取对话列表失败:', error)
  }
}

onMounted(() => {
  loadSessions();
})
</script>

<style scoped>
.max-h-80vh {
  max-height: 80vh;
}
</style>