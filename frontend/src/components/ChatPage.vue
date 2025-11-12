<template>
  <div class="flex w-full h-full">
    <sessions-list ref="sessionsListRef" :sessions="sessions" @on-select="selectSession"
      @on-delete="handleDeleteSession" @on-update="handleRenameSession" @on-create="handleCreateSession" />
    <template v-if="sessions.length > 0">
      <div class="h-full flex-1 min-w-0">
        <ChatPanel v-model:session="currentSession" @openSettings="handleOpenSettings" />
      </div>
      <!-- <SettingsPanel :character="activeCharacter" :session="currentSession" @update-character="updateCharacter" /> -->
      <!-- <div class="border-l border-gray-200" style="width: 340px;flex-shrink: 0;"> -->
        <n-drawer v-model:show="visible" width="380" placement="right" :mask-closable="false"
          :auto-focus="false">
          <n-drawer-content title="对话设置" closable>
            <CharacterSettingPanel :data="currentSession" @update:data="updateSession" :simple="true" />
          </n-drawer-content>
        </n-drawer>
      <!-- </div> -->
    </template>
    <template v-else>
      <div class="flex-1 flex items-center justify-center">
        <n-empty description="你什么也找不到">
          <!-- <template #extra>
            <n-button size="small">
              看看别的
            </n-button>
          </template> -->
        </n-empty>
      </div>

    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from "vue";
import { apiService } from "../services/ApiService";

import { useRouter } from 'vue-router'
import SessionsList from "./SessionsList.vue";
import CharacterSettingPanel from "./CharacterSettingPanel.vue";
import ChatPanel from "./ChatPanel.vue";
import { NEmpty,NDrawer,NDrawerContent } from "naive-ui";
import { usePopup } from "@/composables/usePopup";

const { confirm, editText, toast, prompt } = usePopup();;
const router = useRouter();

const currentSession = ref({
  id: null,
});


const sessionsListRef = ref(null);
const sessions = ref([]);
const visible = ref(false);


const fetchSession = async (sessionId) => {
  const session = await apiService.fetchSession(sessionId);
  currentSession.value = session;
};

const selectSession = async (session) => {
  if (session.id)
    await fetchSession(session.id);
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
  console.log('currentSession:', session);
  updateSessionById(session.value.id, session.value);
}, { deep: true });

const updateSession = async (data) => {
  let session = null;
  try {
    // console.log(characterForm);
    if (currentSession.value && currentSession.value.id) {
      await apiService.updateSession(currentSession.value.id, data);
      session = { id: currentSession.value.id, ...data };
      // toast.success("角色更新成功");

      if (session && data.avatar_file) {
        const response = await apiService.uploadAvatar(currentSession.value.id, data.avatar_file, 'session');
        session.avatar_url = response.url + "?v=" + new Date().getTime();
      }
      currentSession.value = session;
      // updateSessionById(session.id, session);
    }
    toast.success("设置成功");
  } catch (error) {
    toast.error("设置失败");
  }
};

const handleOpenSettings = () => {
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

      updateSessionById(session.id, updatedSession);

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
