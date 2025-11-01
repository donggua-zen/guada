<template>
  <div class="flex w-full h-full">
    <sessions-list ref="sessionsListRef" :sessions="sessions" @on-select="selectSession"
      @on-delete="handleDeleteSession" @on-update="handleRenameSession" @on-create="handleCreateSession" />
    <template v-if="currentSession.id">
      <div class="h-full flex-1 min-w-0">
        <ChatPanel :session="currentSession" @update:session="handleUpdateSession" />
      </div>
      <!-- <SettingsPanel :character="activeCharacter" :session="currentSession" @update-character="updateCharacter" /> -->
      <div class="border-l border-gray-200" style="width: 340px;flex-shrink: 0;">
        <CharacterSettingPanel :data="currentSession" @update:data="updateSession" />
      </div>
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
import { ref, computed, watch, nextTick, onMounted, onBeforeUpdate, reactive } from "vue";
import { apiService } from "../services/llmApi";

import { useRouter, useRoute } from 'vue-router'
import SessionsList from "./SessionsList.vue";
import CharacterSettingPanel from "./CharacterSettingPanel.vue";
import ChatPanel from "./ChatPanel.vue";
import { NEmpty, NButton } from "naive-ui";
import { store } from "../store/store.js";
import { usePopup } from "@/composables/usePopup";

const { confirm, editText, toast, prompt } = usePopup();;


const currentSession = ref({
  id: null,
});


const sessionsListRef = ref(null);
const sessions = ref([]);



const fetchSession = async (sessionId) => {
  const session = await apiService.fetchSession(sessionId);
  currentSession.value = session;

  // const character = await apiService.fetchCharacter(session["character_id"]);
  // activeCharacter.value = character;
};

const selectSession = async (session) => {
  await fetchSession(session.id);
};

const updateSessionById = async (sessionId, data) => {
  console.log('更新对话时间:', sessionId);
  const session = sessions.value.find(session => session.id === sessionId);
  if (session) {
    if ('title' in data) session.title = data.title;
    if ('avatar_url' in data) session.avatar_url = data.avatar_url;
    session.updated_at = new Date().toISOString();
  }
}

const handleUpdateSession = async (data) => {
  updateSessionById(data.id, data);
}



const updateSession = async (data) => {
  console.log("handleSave called");
  console.log(data);
  let session = null;
  try {
    // console.log(characterForm);
    if (currentSession.value && currentSession.value.id) {
      const response = await apiService.updateSession(currentSession.value.id, data);
      session = { id: currentSession.value.id, ...data };
      // toast.success("角色更新成功");

      if (session && data.avatar_file) {
        const response = await apiService.uploadAvatar(currentSession.value.id, data.avatar_file, 'session');
        session.avatar_url = response.url + "?v=" + new Date().getTime();
      }
      currentSession.value = session;
      updateSessionById(session.id, session);
    }
    toast.success("角色更新成功");
  } catch (error) {
    toast.error("角色保存失败");
  }
};



const handleCreateSession = async () => {
  try {

    const result = await prompt("新建对话", {
      placeholder: "请输入对话名称",
      defaultValue: "新建对话"
    });
    if (result) {
      const title = result

      // 创建默认对话数据
      const sessionData = {
        title: title,
        name: "",
        identity: "",
        system_prompt: "",
        avatar_url: ""
      }

      // 调用API创建对话
      const newSession = await apiService.createSession(sessionData)

      // 刷新对话列表
      await loadSessions()

      // 自动选择新创建的对话
      selectSession(newSession)

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
      const response = await apiService.deleteSession(session.id)
      if (response.success) {
        sessions.value = sessions.value.filter(s => s.id !== session.id);
        toast.success("对话删除成功");
      } else {
        console.error('删除对话失败:', response.error || '未知错误')
        toast.error("对话删除失败");
      }
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
