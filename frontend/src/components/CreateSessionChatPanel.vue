<template>

  <!-- 输入区域 -->
  <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center mb-40">
    <div class="banner max-w-full mx-auto w-80 mb-4">
      <img src="/images/chat_banner.webp" alt=""></img>
    </div>
    <h1 class="text-3xl mb-6 text-gray-600">Hi，想聊些什么？</h1>

    <!-- 已选角色显示 -->
    <div
      class="w-full max-w-200 mb-[-0.7rem] flex items-center gap-3 p-2 pb-4 bg-gray-50 border border-gray-100 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
      @click="showCharacterSelector = true">
      <div class="w-10 h-10 shrink-0 overflow-hidden rounded">
        <Avatar :src="currentCharacter?.avatarUrl" type="assistant" :name="currentCharacter?.title"
          class="w-full h-full object-cover" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-gray-700 truncate">{{ currentCharacter?.title || '未命名角色' }}</p>
        <p class="text-xs text-gray-500 truncate">{{ currentCharacter?.description || '暂无描述' }}</p>
      </div>
      <el-icon class="text-gray-400 shrink-0">
        <ArrowRightTwotone />
      </el-icon>
    </div>

    <div class="w-full  max-w-200">
      <ChatInput v-model:value="inputMessage.content" v-model:thinking-enabled="thinkingEnabled" :config="{
        modelId: currentModelId,
        maxMemoryLength: (lastModelConfig.value as any)?.maxMemoryLength || currentCharacter?.settings?.maxMemoryLength,
        knowledgeBaseIds: currentSession?.settings?.referencedKbs || []
      }" @config-change="handleConfigChange" :buttons="chatInputButtons" :files="inputMessage.files" :streaming="false"
        @send="sendMessage" @toggle-thinking="toggleDeepThinking" />
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
        <div class="w-12 h-12 shrink-0 overflow-hidden rounded">
          <Avatar :src="character.avatarUrl" type="assistant" :name="character.title"
            class="w-full h-full object-cover" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-700 truncate">{{ character.title }}</p>
          <p class="text-xs text-gray-500 truncate mt-1">{{ character.description || '暂无描述' }}</p>
        </div>
        <el-icon v-if="currentSession.characterId === character.id" class="text-blue-500 shrink-0" size="20">
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

// 模型数据
const models = ref<any[]>([]);

// const lastSelectedModelId = useStorage('lastSelectedModelId', '');
const lastModelConfig = useStorage<any>('lastModelConfig', {});
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');

// 思考模型状态本地存储
const lastThinkingEnabled = useStorage<boolean>('lastThinkingEnabled', false);

// 用户手动选择的模型 ID（刷新页面后从 localStorage 恢复）
const userSelectedModelId = useStorage<string | null>('userSelectedModelId', null);

// 新增：用户选择的知识库 ID 列表（刷新页面后从 localStorage 恢复）
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
    referencedKbs: userSelectedKnowledgeBaseIds.value, // 新增：从 localStorage 加载知识库选择
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

// 当前使用的模型 ID（三级回退逻辑）
const currentModelId = computed(() => {
  // 第一优先级：如果用户手动选择过模型，使用用户选择的
  if (userSelectedModelId.value) {
    return userSelectedModelId.value;
  }
  
  // 第二优先级：使用角色的默认模型
  if (currentCharacter.value?.model_id) {
    return currentCharacter.value.model_id;
  }
  
  // 第三优先级：使用模型列表的第一个模型
  if (models.value.length > 0) {
    return models.value[0].id;
  }
  
  // 兜底：返回 null
  return null;
});

// 标记是否正在初始化，避免 watch 重复处理
const isInitializing = ref(false);

// 监听角色变化，当角色切换时重置为角色默认模型
watch(() => currentSession.value.characterId, (newCharId, oldCharId) => {
  // 如果是初始化阶段，跳过处理（由 loadCharacters 直接设置）
  if (isInitializing.value) {
    return;
  }

  if (newCharId && newCharId !== oldCharId) {
    // 角色切换时，使用三级回退逻辑选择模型
    const newCharacter = characters.value.find(c => c.id === newCharId);
    if (newCharacter) {
      let selectedModelId: string | null = null;
      
      // 第一优先级：角色的默认模型
      if (newCharacter.model_id) {
        selectedModelId = newCharacter.model_id;
        // 清空用户手动选择的模型 ID（因为角色有推荐模型）
        userSelectedModelId.value = null;
      }
      // 第二优先级：用户之前手动选择的模型
      else if (userSelectedModelId.value) {
        selectedModelId = userSelectedModelId.value;
      }
      // 第三优先级：模型列表的第一个模型
      else if (models.value.length > 0) {
        selectedModelId = models.value[0].id;
      }
      
      // 设置模型 ID
      if (selectedModelId) {
        currentSession.value.model_id = selectedModelId;
      }
      
      // 切换角色时，思考模型状态重置为上次用户选择的状态
      currentSession.value.settings = {
        ...(currentSession.value.settings || {}),
        thinkingEnabled: lastThinkingEnabled.value,
        maxMemoryLength: newCharacter.settings?.maxMemoryLength
      };
      
      // 更新本地存储的配置信息
      if (selectedModelId) {
        lastModelConfig.value = {
          ...lastModelConfig.value,
          modelId: selectedModelId,
          maxMemoryLength: newCharacter.settings?.maxMemoryLength
        };
      }
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
    return currentSession.value.settings?.thinkingEnabled;
  },
  set(value) {
    currentSession.value.settings["thinkingEnabled"] = value;
    // 保存到本地存储
    lastThinkingEnabled.value = value;
  }
});

const chatInputButtons = computed(() => {
  return {
    tokensButton: false,
  }
})

// 加载模型列表
const loadModels = async (): Promise<void> => {
  try {
    const response = await apiService.fetchModels();
    // 提取所有 text 类型的模型
    response.items.forEach(provider => {
      const textModels = provider.models?.filter((m: any) => m.modelType === 'text') || [];
      models.value.push(...textModels);
    });
  } catch (error) {
    console.error('获取模型列表失败:', error);
    notify.error('获取模型列表失败', error);
  }
};

// 加载角色列表
const loadCharacters = async (): Promise<void> => {
  try {
    const response = await apiService.fetchCharacters();
    characters.value = response.items || [];

    // 优先使用上次选择的角色
    if (characters.value.length > 0) {
      // 设置初始化标志，防止 watch 干扰
      isInitializing.value = true;

      const savedCharacter = characters.value.find(c => c.id === lastSelectedCharacterId.value);
      const targetCharacter = savedCharacter || characters.value[0];
      
      if (targetCharacter) {
        currentSession.value.characterId = targetCharacter.id;
        
        // 三级回退逻辑确定模型 ID
        let selectedModelId: string | null = null;
        
        // 第一优先级：用户手动选择的模型
        if (userSelectedModelId.value) {
          selectedModelId = userSelectedModelId.value;
        }
        // 第二优先级：角色的默认模型
        else if (targetCharacter.model_id) {
          selectedModelId = targetCharacter.model_id;
        }
        // 第三优先级：模型列表的第一个模型
        else if (models.value.length > 0) {
          selectedModelId = models.value[0].id;
        }
        
        // 设置模型 ID
        if (selectedModelId) {
          currentSession.value.model_id = selectedModelId;
        }
        
        // 设置会话配置
        currentSession.value.settings = {
          ...currentSession.value.settings,
          thinkingEnabled: lastThinkingEnabled.value,
          maxMemoryLength: targetCharacter.settings?.maxMemoryLength
        };
        
        // 同步更新 lastModelConfig，确保一致性
        if (selectedModelId) {
          lastModelConfig.value = {
            ...lastModelConfig.value,
            modelId: selectedModelId,
            maxMemoryLength: targetCharacter.settings?.maxMemoryLength
          };
        }
      }

      // 初始化完成，恢复 watch 监听
      isInitializing.value = false;
    }
  } catch (error) {
    console.error('获取角色列表失败:', error);
    notify.error('获取角色列表失败', error);
    // 即使出错也要恢复标志
    isInitializing.value = false;
  }
};

// 选择角色
const selectCharacter = (character: any): void => {
  currentSession.value.characterId = character.id;
  lastSelectedCharacterId.value = character.id;
  showCharacterSelector.value = false;
  characterSearchText.value = '';
  
  // 切换角色时的模型选择逻辑
  let selectedModelId: string | null = null;
  
  // 第一优先级：角色的默认模型
  if (character.model_id) {
    selectedModelId = character.model_id;
    // 清空用户手动选择的模型 ID（因为角色有推荐模型）
    userSelectedModelId.value = null;
  }
  // 第二优先级：用户之前手动选择的模型（角色没有推荐模型时保留）
  else if (userSelectedModelId.value) {
    selectedModelId = userSelectedModelId.value;
  }
  // 第三优先级：模型列表的第一个模型
  else if (models.value.length > 0) {
    selectedModelId = models.value[0].id;
  }
  
  // 设置模型 ID
  if (selectedModelId) {
    currentSession.value.model_id = selectedModelId;
  }
  
  // 思考模型状态保持用户上次选择的状态
  currentSession.value.settings = {
    ...(currentSession.value.settings || {}),
    thinkingEnabled: lastThinkingEnabled.value,
    maxMemoryLength: character.settings?.maxMemoryLength
  };
  
  // 更新本地存储的配置信息
  if (selectedModelId) {
    lastModelConfig.value = {
      ...lastModelConfig.value,
      modelId: selectedModelId,
      maxMemoryLength: character.settings?.maxMemoryLength
    };
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
  // 新增：保存知识库选择到会话设置和本地存储
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { ...(currentSession.value.settings || {}), referencedKbs: config.knowledgeBaseIds };
    // 保存到 localStorage，实现持久化
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
  // 先加载模型列表，再加载角色列表（因为角色初始化可能依赖模型列表）
  Promise.all([loadModels(), loadCharacters()]).catch(error => {
    console.error('初始化数据失败:', error);
  });
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
  // 修复：传递完整的 payload，包含 knowledgeBaseIds
  emit("create-session", {
    characterId: currentSession.value.characterId,
    modelId: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings
  }, {
    content: inputMessage.value.content,      // 使用 content 字段
    files: inputMessage.value.files || [],    // 使用 files 字段
    knowledgeBaseIds: currentSession.value.settings?.referencedKbs || []  // 新增：传递知识库 ID
  });
}

const handleCreateSessionClick = (): void => {
  if (!currentSession.value.characterId) {
    notify.error("创建失败", '请先选择一个角色模板');
    return;
  }
  emit("create-session" as any, {
    characterId: currentSession.value.characterId,
    modelId: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings
  })
}

// 设置操作

const toggleDeepThinking = (): void => { };

</script>