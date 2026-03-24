<template>
  <div class="flex flex-col h-full w-full">
    <!-- 聊天头部 -->
    <ChatHeader :sidebar-visible="localSidebarVisible" :has-more-options="false"
      @toggle-sidebar="emit('update:sidebarVisible', !localSidebarVisible)" />

    <!-- 输入区域 -->
    <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center mb-40">
      <div class="banner max-w-full mx-auto w-80 mb-4">
        <img src="/images/chat_banner.webp" alt=""></img>
      </div>
      <h1 class="text-3xl mb-6 text-gray-600">Hi，想聊些什么？</h1>

      <!-- 已选角色显示 -->
      <div
        class="w-full max-w-[800px] mb-[-0.7rem] flex items-center gap-3 p-2 pb-4 bg-gray-50 border border-gray-100 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
        @click="showCharacterSelector = true">
        <div class="w-10 h-10 flex-shrink-0 overflow-hidden rounded">
          <Avatar :src="currentCharacter?.avatar_url" type="assistant" class="w-full h-full object-cover" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-700 truncate">{{ currentCharacter?.title || '未命名角色' }}</p>
          <p class="text-xs text-gray-500 truncate">{{ currentCharacter?.description || '暂无描述' }}</p>
        </div>
        <el-icon class="text-gray-400 flex-shrink-0">
          <ArrowRightTwotone />
        </el-icon>
      </div>

      <div class="w-full  max-w-[800px]">
        <ChatInput v-model:value="inputMessage.text" v-model:thinking-enabled="thinkingEnabled"
          :config="{ modelId: lastModelConfig.modelId || currentCharacter?.model_id, maxMemoryLength: lastModelConfig.maxMemoryLength || currentCharacter?.settings?.max_memory_length }"
          @config-change="handleConfigChange" :buttons="chatInputButtons" :files="inputMessage.files" :streaming="false"
          :session-id="null" @send="sendMessage" @toggle-web-search="handleWebSearch"
          @toggle-thinking="toggleDeepThinking" />
      </div>
      <div>
        <div class="flex items-center justify-center mt-6">
          您也可以<span class="w-1"></span>
          <el-button type="primary" plain round size="small" @click="handleCreateSessionClick">直接创建会话
          </el-button>
        </div>
      </div>
    </div>

    <!-- 角色选择器弹窗 -->
    <el-dialog v-model="showCharacterSelector" title="选择角色" :width="isMobile ? '90%' : '450px'" :append-to-body="true">
      <!-- 搜索框 -->
      <div class="mb-4">
        <el-input v-model="characterSearchText" placeholder="搜索角色..." prefix-icon="SearchFilled" clearable />
      </div>

      <!-- 角色列表 -->
      <div class="character-list max-h-96 overflow-y-auto">
        <div v-for="character in filteredCharacters" :key="character.id"
          class="character-item flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors border border-transparent"
          :class="{ 'bg-blue-50 border-blue-200': currentSession.character_id === character.id }"
          @click="selectCharacter(character)">
          <div class="w-12 h-12 flex-shrink-0 overflow-hidden rounded">
            <Avatar :src="character.avatar_url" type="assistant" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-700 truncate">{{ character.title }}</p>
            <p class="text-xs text-gray-500 truncate mt-1">{{ character.description || '暂无描述' }}</p>
          </div>
          <el-icon v-if="currentSession.character_id === character.id" class="text-blue-500 flex-shrink-0" size="20">
            <CheckCircleFilled />
          </el-icon>
        </div>

        <!-- 空状态 -->
        <div v-if="filteredCharacters.length === 0" class="text-center py-8 text-gray-400">
          <el-icon size="48" class="mb-2">
            <Search />
          </el-icon>
          <p>未找到匹配的角色</p>
        </div>
      </div>

      <!-- 底部按钮 -->
      <template #footer>
        <div class="flex justify-between items-center">
          <el-button @click="goToCharactersPage" plain>
            <el-icon class="mr-1">
              <AppsFilled />
            </el-icon>
            管理角色
          </el-button>
          <el-button @click="showCharacterSelector = false">取消</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useStorage } from "@vueuse/core"
import { apiService } from "../services/ApiService";
import { usePopup } from "../composables/usePopup";
import { useTitle } from "../composables/useTitle";
import { useRouter } from 'vue-router';
// 组件导入
import { ChatInput } from "./ui";
import ChatHeader from "./ChatHeader.vue";

import { ArrowRightTwotone, CheckCircleFilled, AppsFilled, SearchFilled } from '@vicons/material'

// UI组件导入
import { ElButton } from "element-plus";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

// 弹出层工具
const { notify } = usePopup();
const router = useRouter();

// 响应式数据
const title = useTitle();

// 模型数据
const models = ref([]);
const providers = ref([]);

// 角色数据
const characters = ref([]);
const showCharacterSelector = ref(false);
const characterSearchText = ref('');

// const lastSelectedModelId = useStorage('lastSelectedModelId', '');
const lastModelConfig = useStorage('lastModelConfig', {});
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');

const inputMessage = ref({
  text: "",
  files: []
});

// 计算属性
const currentSession = ref({
  character_id: null,  // 必须绑定角色
  model_id: null,
  avatar_url: null,
  title: "新建对话",
  settings: {
    thinking_enabled: false,
    model_name: null,
  }
})

// const currentModel = computed(() => {
//   if (currentSession.value.model_id) {
//     const model = models.value.find(model => model.id === currentSession.value.model_id)
//     return model
//   }
//   return null
// });



// 当前选中的角色
const currentCharacter = computed(() => {
  if (currentSession.value.character_id) {
    return characters.value.find(c => c.id === currentSession.value.character_id);
  }
  return null;
});

watch(() => currentCharacter.value, (newCharacter) => {
  currentSession.value.model_id = newCharacter.model_id;
  currentSession.value.settings = { max_memory_length: newCharacter.value?.settings?.max_memory_length };
});

// 过滤后的角色列表（支持搜索）
const filteredCharacters = computed(() => {
  if (!characterSearchText.value) {
    return characters.value;
  }
  const searchText = characterSearchText.value.toLowerCase();
  return characters.value.filter(char =>
    char.title?.toLowerCase().includes(searchText) ||
    char.description?.toLowerCase().includes(searchText)
  );
});



// Props & Emits
const props = defineProps({
  session: {
    type: Object,
    default: () => ({})
  },
  sidebarVisible: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits([
  "update:session",
  "update:sidebarVisible",
  "create-session"
]);


const thinkingEnabled = computed({
  get() {
    return currentSession.value.settings?.thinking_enabled;
  },
  set(value) {
    currentSession.value.settings["thinking_enabled"] = value;
  }
});

const chatInputButtons = computed(() => {
  return {
    tokensButton: false,
  }
})

const localSidebarVisible = computed({
  get() {
    return props.sidebarVisible;
  },
  set(value) {
    emit("update:sidebarVisible", value);
  }
});


// 加载角色列表
const loadCharacters = async () => {
  try {
    const response = await apiService.fetchCharacters('private');
    characters.value = response.items || [];

    // 优先使用上次选择的角色
    if (characters.value.length > 0) {
      const savedCharacter = characters.value.find(c => c.id === lastSelectedCharacterId.value);
      if (savedCharacter) {
        currentSession.value.character_id = savedCharacter.id;
      } else {
        // 如果没有保存的角色，使用第一个
        currentSession.value.character_id = characters.value[0].id;
      }
    }
  } catch (error) {
    console.error('获取角色列表失败:', error);
    notify.error('获取角色列表失败', error);
  }
};

// 选择角色
const selectCharacter = (character) => {
  currentSession.value.character_id = character.id;
  lastSelectedCharacterId.value = character.id;
  showCharacterSelector.value = false;
  characterSearchText.value = '';
  currentSession.value.model_id = character.model_id;
  currentSession.value.settings = { max_memory_length: character.settings?.max_memory_length };
  lastModelConfig.value = {
    modelId: character.model_id,
    maxMemoryLength: character.settings?.max_memory_length
  }
};

const handleConfigChange = (config) => {
  if (typeof config.modelId !== 'undefined')
    currentSession.value.model_id = config.modelId;
  currentSession.value.settings = { max_memory_length: config.maxMemoryLength };
  lastModelConfig.value = { ...lastModelConfig.value, ...config };
};


// 前往角色管理页面
const goToCharactersPage = () => {
  showCharacterSelector.value = false;
  router.replace({ name: 'Characters' });
};

onMounted(() => {
  title.value = "你今天想聊点什么";
  // 初始化相关逻辑
  loadCharacters();
});

const autoTitle = () => {
  if (inputMessage.value.text && inputMessage.value.text.length > 0) {
    return inputMessage.value.text.substring(0, 20);
  }
  return "新建对话"
}

const sendMessage = () => {
  // if (!currentModel.value) {
  //   notify.error('请选择对话模型');
  //   return;
  // }
  if (!currentSession.value.character_id) {
    notify.error('请先选择一个角色模板');
    // router.push({ name: 'Characters' });
    return;
  }
  // console.log(currentSession.value)
  emit("create-session", {
    character_id: currentSession.value.character_id,
    model_id: currentSession.value.model_id,
    title: autoTitle(),
    settings: currentSession.value.settings
  }, { ...inputMessage.value });
  // inputMessage.value = { text: "", files: [] };
}

const handleCreateSessionClick = () => {
  // if (!currentModel.value) {
  //   notify.error('请选择对话模型');
  //   return;
  // }
  if (!currentSession.value.character_id) {
    notify.error('请先选择一个角色模板');
    // router.push({ name: 'Characters' });
    return;
  }
  // console.log(currentSession.value)
  emit("create-session", {
    character_id: currentSession.value.character_id,
    model_id: currentSession.value.model_id,
    title: autoTitle(),
    settings: currentSession.value.settings
  })
}

// 设置操作
const handleWebSearch = () => { };

const toggleDeepThinking = () => { };

</script>