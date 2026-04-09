<template>
  <div class="flex flex-col h-full w-full">
    <!-- 聊天头部 -->
    <ChatHeader :sidebar-visible="localSidebarVisible" :has-more-options="false" title="新建对话"
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
        <ChatInput v-model:value="inputMessage.content" v-model:thinking-enabled="thinkingEnabled" :config="{
          modelId: currentModelId,
          maxMemoryLength: (lastModelConfig.value as any)?.maxMemoryLength || currentCharacter?.settings?.maxMemoryLength,
          knowledgeBaseIds: currentSession?.settings?.referencedKbs || []
        }" @config-change="handleConfigChange" :buttons="chatInputButtons" :files="inputMessage.files"
          :streaming="false" @send="sendMessage" @toggle-thinking="toggleDeepThinking" />
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
        <el-input v-model="characterSearchText" placeholder="搜索角色..." clearable>
          <template #prefix>
            <el-icon>
              <SearchFilled />
            </el-icon>
          </template>
        </el-input>
      </div>

      <!-- 角色列表 -->
      <div class="character-list max-h-96 overflow-y-auto">
        <div v-for="character in filteredCharacters" :key="character.id"
          class="character-item flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors border border-transparent"
          :class="{ 'bg-blue-50 border-blue-200': currentSession.characterId === character.id }"
          @click="selectCharacter(character)">
          <div class="w-12 h-12 flex-shrink-0 overflow-hidden rounded">
            <Avatar :src="character.avatar_url" type="assistant" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-700 truncate">{{ character.title }}</p>
            <p class="text-xs text-gray-500 truncate mt-1">{{ character.description || '暂无描述' }}</p>
          </div>
          <el-icon v-if="currentSession.characterId === character.id" class="text-blue-500 flex-shrink-0" size="20">
            <CheckCircleFilled />
          </el-icon>
        </div>

        <!-- 空状态 -->
        <div v-if="filteredCharacters.length === 0" class="text-center py-8 text-gray-400">
          <el-icon :size="48" color="rgb(156 163 175)" class="mb-2">
            <SearchFilled />
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

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useStorage } from "@vueuse/core"
import { apiService } from '@/services/ApiService';
import { usePopup } from "../composables/usePopup";
import { useTitle } from "../composables/useTitle";
import { useRouter } from 'vue-router';
// 组件导入
import { ChatInput } from "./ui";
import ChatHeader from "./ChatHeader.vue";

import { ArrowRightTwotone, CheckCircleFilled, AppsFilled, SearchFilled } from '@vicons/material'

// UI 组件导入
import { ElButton } from "element-plus";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

// 弹出层工具
const { notify } = usePopup();
const router = useRouter();

// 响应式数据 - 类型化
const title = useTitle();

// 角色数据
const characters = ref<any[]>([]);
const showCharacterSelector = ref(false);
const characterSearchText = ref('');

// const lastSelectedModelId = useStorage('lastSelectedModelId', '');
const lastModelConfig = useStorage<any>('lastModelConfig', {});
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');

// 思考模型状态本地存储
const lastThinkingEnabled = useStorage<boolean>('lastThinkingEnabled', false);

// 用户手动选择的模型 ID（刷新页面后从 localStorage 恢复）
const userSelectedModelId = useStorage<string | null>('userSelectedModelId', null);

// 🔥 新增：用户选择的知识库 ID 列表（刷新页面后从 localStorage 恢复）
const userSelectedKnowledgeBaseIds = useStorage<string[]>('userSelectedKnowledgeBaseIds', []);

const inputMessage = ref({
  content: "",
  files: []
});

// 计算属性
const currentSession = ref<any>({
  characterId: null,  // 必须绑定角色
  model_id: null,
  avatar_url: null,
  title: "新建对话",
  settings: {
    thinkingEnabled: lastThinkingEnabled.value, // 从本地存储加载
    referencedKbs: userSelectedKnowledgeBaseIds.value, // 🔥 新增：从 localStorage 加载知识库选择
    modelName: null,
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
  if (currentSession.value.characterId) {
    return characters.value.find(c => c.id === currentSession.value.characterId);
  }
  return null;
});

// 当前使用的模型 ID（优先使用用户手动选择的，否则使用角色默认）
const currentModelId = computed(() => {
  // 如果用户手动选择过模型，使用用户选择的
  if (userSelectedModelId.value) {
    return userSelectedModelId.value;
  }
  // 否则使用角色的默认模型
  return currentCharacter.value?.model_id;
});

// 监听角色变化，当角色切换时重置为角色默认模型
watch(() => currentSession.value.characterId, (newCharId, oldCharId) => {
  if (newCharId && newCharId !== oldCharId) {
    // 角色切换时，重置为角色默认模型
    const newCharacter = characters.value.find(c => c.id === newCharId);
    if (newCharacter) {
      currentSession.value.model_id = newCharacter.model_id;
      // 切换角色时，思考模型状态重置为上次用户选择的状态（而非角色默认值）
      currentSession.value.settings = {
        ...(currentSession.value.settings || {}),
        thinking_enabled: lastThinkingEnabled.value,
        maxMemoryLength: newCharacter.settings?.maxMemoryLength
      };
      // 清空用户手动选择的模型 ID（这样 currentModelId 就会使用角色默认模型）
      // userSelectedModelId.value = null;
      // 更新本地存储的配置信息
      lastModelConfig.value = {
        ...lastModelConfig.value,
        modelId: newCharacter.model_id,
        maxMemoryLength: newCharacter.settings?.maxMemoryLength
      };
    }
  }
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



// Props & Emits - 类型化
const props = defineProps<{
  session?: any;
  sidebarVisible?: boolean;
}>();

// @ts-ignore - emit 类型定义
const emit = defineEmits<{
  'update:session': [session: any]
  'update:sidebarVisible': [visible: boolean]
  'create-session': [sessionData: any, messageData?: any]
}>();


const thinkingEnabled = computed({
  get() {
    return currentSession.value.settings?.thinking_enabled;
  },
  set(value) {
    currentSession.value.settings["thinking_enabled"] = value;
    // 保存到本地存储
    lastThinkingEnabled.value = value;
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
const loadCharacters = async (): Promise<void> => {
  try {
    const response = await apiService.fetchCharacters('private');
    characters.value = response.items || [];

    // 优先使用上次选择的角色
    if (characters.value.length > 0) {
      const savedCharacter = characters.value.find(c => c.id === lastSelectedCharacterId.value);
      if (savedCharacter) {
        currentSession.value.characterId = savedCharacter.id;
        // 如果有用户手动选择的模型，使用用户的；否则使用角色默认
        if (userSelectedModelId.value) {
          currentSession.value.model_id = userSelectedModelId.value;
          currentSession.value.settings = {
            ...currentSession.value.settings,
            maxMemoryLength: lastModelConfig.value.maxMemoryLength
          };
        } else {
          // 没有用户选择，使用角色默认模型
          currentSession.value.model_id = savedCharacter.model_id;
          currentSession.value.settings = {
            ...currentSession.value.settings,
            maxMemoryLength: savedCharacter.settings?.maxMemoryLength
          };
        }
      } else {
        // 如果没有保存的角色，使用第一个
        currentSession.value.characterId = characters.value[0].id;
        currentSession.value.model_id = characters.value[0].model_id;
        currentSession.value.settings = {
          ...currentSession.value.settings,
          maxMemoryLength: characters.value[0].settings?.maxMemoryLength
        };
      }
    }
  } catch (error) {
    console.error('获取角色列表失败:', error);
    notify.error('获取角色列表失败', error);
  }
};

// 选择角色
const selectCharacter = (character: any): void => {
  currentSession.value.characterId = character.id;
  lastSelectedCharacterId.value = character.id;
  showCharacterSelector.value = false;
  characterSearchText.value = '';
  // 切换角色时，使用角色的默认模型
  currentSession.value.model_id = character.model_id;
  // 思考模型状态保持用户上次选择的状态
  currentSession.value.settings = {
    ...(currentSession.value.settings || {}),
    thinking_enabled: lastThinkingEnabled.value,
    maxMemoryLength: character.settings?.maxMemoryLength
  };
  // 清空用户手动选择的模型 ID（这样 currentModelId 就会使用角色默认模型）
  userSelectedModelId.value = null;
  // 更新本地存储的配置信息
  lastModelConfig.value = {
    ...lastModelConfig.value,
    modelId: character.model_id,
    maxMemoryLength: character.settings?.maxMemoryLength
  }
};

const handleConfigChange = (config: any): void => {
  if (typeof config.modelId !== 'undefined') {
    currentSession.value.model_id = config.modelId;
    // 用户手动切换模型，保存到本地存储
    console.log('保存用户手动切换的模型:', config.modelId);
    userSelectedModelId.value = config.modelId;
  }
  if (typeof config.maxMemoryLength !== 'undefined') {
    // @ts-ignore - settings 类型需要更精确的定义
    currentSession.value.settings = { ...(currentSession.value.settings || {}), maxMemoryLength: config.maxMemoryLength };
    // 保存到本地存储
    lastModelConfig.value = { ...lastModelConfig.value, maxMemoryLength: config.maxMemoryLength };
  }
  // 🔥 新增：保存知识库选择到会话设置和本地存储
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { ...(currentSession.value.settings || {}), referencedKbs: config.knowledgeBaseIds };
    // 🔥 保存到 localStorage，实现持久化
    userSelectedKnowledgeBaseIds.value = config.knowledgeBaseIds;
    console.log('保存知识库选择到本地存储:', config.knowledgeBaseIds);
  }
};

// 前往角色管理页面
const goToCharactersPage = (): void => {
  showCharacterSelector.value = false;
  router.replace({ name: 'Characters' });
};

onMounted(() => {
  title.value = "你今天想聊点什么";
  // 初始化相关逻辑
  loadCharacters();
});

const autoTitle = (): string => {
  if (inputMessage.value.content && inputMessage.value.content.length > 0) {
    return inputMessage.value.content.substring(0, 20);
  }
  return "新建对话"
}

const sendMessage = (): void => {
  if (!currentSession.value.characterId) {
    notify.error("创建失败", '请先选择一个角色模板');
    return;
  }
  // 🔥 修复：传递完整的 payload，包含 knowledgeBaseIds
  emit("create-session", {
    characterId: currentSession.value.characterId,
    model_id: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings
  }, {
    content: inputMessage.value.content,      // ✅ 使用 content 字段
    files: inputMessage.value.files || [],    // ✅ 使用 files 字段
    knowledgeBaseIds: currentSession.value.settings?.referencedKbs  || []  // 🔥 新增：传递知识库 ID
  });
}

const handleCreateSessionClick = (): void => {
  if (!currentSession.value.characterId) {
    notify.error("创建失败", '请先选择一个角色模板');
    return;
  }
  emit("create-session" as any, {
    characterId: currentSession.value.characterId,
    model_id: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings
  })
}

// 设置操作

const toggleDeepThinking = (): void => { };

</script>