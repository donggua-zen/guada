<template>

  <!-- 输入区域 -->
  <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center mb-20">
    <div class="w-full flex items-center justify-center mb-10">
      <div class="banner w-20 mb-4">
        <img :src="bannerPath" alt=""></img>
      </div>
      <h1 class="text-4xl mb-6 text-(--color-text) ml-5">
        <span class="typewriter-text">{{ displayedText }}</span>
        <span class="typewriter-cursor" :class="{ 'cursor-blink': isTypingComplete }"></span>
      </h1>
    </div>
    <!-- 已选角色 + 抽屉切换 -->
    <div class="w-full max-w-200 flex flex-col items-start mx-auto relative">
      <AgentSwitcherBar :character="currentCharacter" @select="handleCharacterSelect" />
      <div class="w-full relative z-30 -mt-4">
        <ChatInput v-model:value="inputMessage.content" :config="chatInputConfig" mode="create"
          @config-change="handleConfigChange" :buttons="chatInputButtons" :files="inputMessage.files" :streaming="false"
          @send="sendMessage" />
      </div>
      <ChatInputToolbar :config="chatInputConfig" @config-change="handleConfigChange" />
    </div>
    <div>
      <!-- <div class="flex items-center justify-center mt-6">
        您也可以<span class="w-1"></span>
        <el-button type="primary" plain round size="small" @click="handleCreateSessionClick">直接创建会话
        </el-button>
      </div> -->
    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useStorage } from "@vueuse/core"
import { apiService } from '@/services/ApiService';
import { usePopup } from "../../composables/usePopup";
import { useTitle } from "../../composables/useTitle";
import { useRouter, useRoute } from 'vue-router';
import { fixFrontendAssetUrl } from '@/utils/url'
import { DEFAULT_SUMMARY_MODE } from '@/constants'
// 组件导入
import { ChatInput } from "../ui";
import ChatInputToolbar from "./chat-input/ChatInputToolbar.vue";
import AgentSwitcherBar from "./AgentSwitcherBar.vue";


// UI 组件导入
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)

// 弹出层工具
const { notify } = usePopup();
const router = useRouter();
const route = useRoute();

// 响应式数据 - 类型化
const title = useTitle();

// 计算属性：自适应 Banner 路径
// const bannerPath = computed(() => fixFrontendAssetUrl('/images/chat_banner.webp'))

// Logo 路径（使用 fixFrontendAssetUrl 适配 Electron 环境）
const bannerPath = computed(() => fixFrontendAssetUrl('/images/guada_logo.png'))

// 角色数据
const characters = ref<any[]>([]);

// 模型数据
const models = ref<any[]>([]);

// const lastSelectedModelId = useStorage('lastSelectedModelId', '');
const lastModelConfig = useStorage<any>('lastModelConfig', {});
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');

// 用户手动选择的模型 ID（刷新页面后从 localStorage 恢复）
const userSelectedModelId = useStorage<string | null>('userSelectedModelId', null);

// 新增：用户上次选择的思考强度（刷新页面后从 localStorage 恢复）
const userSelectedThinkingEffort = useStorage<string>('userSelectedThinkingEffort', 'off');

// 新增：用户选择的知识库 ID 列表（刷新页面后从 localStorage 恢复）
const userSelectedKnowledgeBaseIds = useStorage<string[]>('userSelectedKnowledgeBaseIds', []);

const inputMessage = ref({
  content: "",
  files: []
});

// 打字机效果相关状态
const fullText = 'Hi，想聊些什么？';
const displayedText = ref('');
const isTypingComplete = ref(false);
let typeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 启动打字机效果
 * 逐字显示文本，完成后启动光标闪烁
 */
const startTypewriter = (): void => {
  let index = 0;
  displayedText.value = '';
  isTypingComplete.value = false;

  const typeNextChar = (): void => {
    if (index < fullText.length) {
      displayedText.value += fullText[index];
      index++;
      // 随机延迟 80-150ms，模拟自然打字节奏
      const delay = 80 + Math.random() * 70;
      typeTimer = setTimeout(typeNextChar, delay);
    } else {
      isTypingComplete.value = true;
    }
  };

  typeNextChar();
};

/**
 * 清理打字机定时器
 */
const clearTypewriterTimer = (): void => {
  if (typeTimer) {
    clearTimeout(typeTimer);
    typeTimer = null;
  }
};

// 计算属性
const currentSession = ref<any>({
  characterId: null,  // 必须绑定角色
  model_id: null,
  avatar_url: null,
  title: "新建对话",
  workspacePath: null,  // 工作目录路径，默认为 null 使用系统默认目录
  settings: {
    referencedKbs: userSelectedKnowledgeBaseIds.value, // 新增：从 localStorage 加载知识库选择
    modelName: null,
    // 新增：memoryEnabled 控制是否启用自定义配置
    memoryEnabled: false,  // 默认使用角色配置
    // 思考强度配置 - 从 localStorage 恢复用户上次选择
    thinkingEffort: userSelectedThinkingEffort.value,

    // 运行模式 - 默认工作模式
    runMode: 'normal',
    // 新增：memory 分组配置（压缩与记忆配置）
    memory: {
      compressionTriggerRatio: 0.8,
      compressionTargetRatio: 0.5,
      summaryMode: DEFAULT_SUMMARY_MODE, // 默认记忆同步模式
      maxTokensLimit: null
    }
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

      // 切换角色时，重置会话设置
      currentSession.value.settings = {
        ...(currentSession.value.settings || {}),
        memoryEnabled: false,  // 默认使用角色配置
        memory: {
          compressionTriggerRatio: newCharacter.settings?.memory?.compressionTriggerRatio || 0.8,
          compressionTargetRatio: newCharacter.settings?.memory?.compressionTargetRatio || 0.5,
          summaryMode: newCharacter.settings?.memory?.summaryMode || DEFAULT_SUMMARY_MODE,
          maxTokensLimit: newCharacter.settings?.memory?.maxTokensLimit || null
        }
      };

      // 更新本地存储的配置信息
      if (selectedModelId) {
        lastModelConfig.value = {
          ...lastModelConfig.value,
          modelId: selectedModelId
        };
      }
    }
  }
});

// Props & Emits - 类型化
const props = defineProps<{
  session?: any;
}>();

// @ts-ignore - emit 类型定义
const emit = defineEmits<{
  'update:session': [session: any]
  'create-session': [sessionData: any, messageData?: any]
}>();


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
          memoryEnabled: false,  // 默认使用角色配置
          memory: {
            compressionTriggerRatio: targetCharacter.settings?.memory?.compressionTriggerRatio || 0.8,
            compressionTargetRatio: targetCharacter.settings?.memory?.compressionTargetRatio || 0.5,
            summaryMode: targetCharacter.settings?.memory?.summaryMode || DEFAULT_SUMMARY_MODE,
            maxTokensLimit: targetCharacter.settings?.memory?.maxTokensLimit || null
          }
        };

        // 同步更新 lastModelConfig，确保一致性
        if (selectedModelId) {
          lastModelConfig.value = {
            ...lastModelConfig.value,
            modelId: selectedModelId
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

// 选择角色（从抽屉中选择）
const handleCharacterSelect = (character: any): void => {
  currentSession.value.characterId = character.id;
  lastSelectedCharacterId.value = character.id;

  // 切换角色时的模型选择逻辑
  let selectedModelId: string | null = null;

  if (character.model_id) {
    selectedModelId = character.model_id;
    userSelectedModelId.value = null;
  } else if (userSelectedModelId.value) {
    selectedModelId = userSelectedModelId.value;
  } else if (models.value.length > 0) {
    selectedModelId = models.value[0].id;
  }

  if (selectedModelId) {
    currentSession.value.model_id = selectedModelId;
  }

  currentSession.value.settings = {
    ...(currentSession.value.settings || {}),
    memoryEnabled: false,
    memory: {
      compressionTriggerRatio: character.settings?.memory?.compressionTriggerRatio || 0.8,
      compressionTargetRatio: character.settings?.memory?.compressionTargetRatio || 0.5,
      summaryMode: character.settings?.memory?.summaryMode || DEFAULT_SUMMARY_MODE,
      maxTokensLimit: character.settings?.memory?.maxTokensLimit || null
    }
  };

  if (selectedModelId) {
    lastModelConfig.value = {
      ...lastModelConfig.value,
      modelId: selectedModelId
    };
  }
};

// ========== ChatInput 配置管理 ==========

/**
 * ChatInput 组件的配置对象（计算属性）
 * 与 handleConfigChange 中的处理逻辑一一对应，方便对照维护
 */
const chatInputConfig = computed(() => ({
  // 模型 ID - 对应 handleConfigChange 中的 config.modelId
  modelId: currentModelId.value,

  // 思考强度 - 对应 handleConfigChange 中的 config.thinkingEffort
  thinkingEffort: currentSession.value?.settings?.thinkingEffort || 'off',

  // 记忆配置开关 - 对应 handleConfigChange 中的 config.memoryEnabled
  memoryEnabled: currentSession.value?.settings?.memoryEnabled,

  // 记忆配置详情 - 对应 handleConfigChange 中的 config.memory
  memory: currentSession.value?.settings?.memory || null,

  // 知识库 IDs - 对应 handleConfigChange 中的 config.knowledgeBaseIds
  knowledgeBaseIds: currentSession.value?.settings?.referencedKbs || [],

  // 运行模式 - 对应 handleConfigChange 中的 config.runMode
  runMode: currentSession.value?.settings?.runMode || 'normal',

  // 工作目录路径 - 对应 handleConfigChange 中的 config.workspacePath
  workspacePath: currentSession.value?.workspacePath || null,

  // 分组 ID - 对应 handleConfigChange 中的 config.groupId
  groupId: currentSession.value?.groupId || null,
}));

/**
 * 处理 ChatInput 配置变更
 * 与 chatInputConfig 计算属性中的字段一一对应
 */
const handleConfigChange = (config: any): void => {
  // 处理模型 ID 变更
  if (typeof config.modelId !== 'undefined') {
    currentSession.value.model_id = config.modelId;
    // 用户手动切换模型，保存到本地存储
    console.log('保存用户手动切换的模型:', config.modelId);
    userSelectedModelId.value = config.modelId;
  }

  // 处理思考强度变更
  if (typeof config.thinkingEffort !== 'undefined') {
    currentSession.value.settings.thinkingEffort = config.thinkingEffort;
    // 保存到 localStorage，实现持久化
    userSelectedThinkingEffort.value = config.thinkingEffort;
    console.log('保存 thinkingEffort 到会话和本地存储:', config.thinkingEffort);
  }

  // 处理记忆配置开关
  if (typeof config.memoryEnabled !== 'undefined') {
    currentSession.value.settings.memoryEnabled = config.memoryEnabled;
    console.log('保存 memoryEnabled 到会话:', config.memoryEnabled);
  }

  // 处理记忆配置详情
  if (typeof config.memory !== 'undefined') {
    currentSession.value.settings = {
      ...(currentSession.value.settings || {}),
      memory: {
        ...(currentSession.value.settings?.memory || {}),
        ...config.memory
      }
    };
    console.log('保存 memory 配置到会话:', config.memory);
  }

  // 处理知识库选择
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { ...(currentSession.value.settings || {}), referencedKbs: config.knowledgeBaseIds };
    // 保存到 localStorage，实现持久化
    userSelectedKnowledgeBaseIds.value = config.knowledgeBaseIds;
    console.log('保存知识库选择到本地存储:', config.knowledgeBaseIds);
  }

  // 处理工作目录路径
  if (typeof config.workspacePath !== 'undefined') {
    currentSession.value.workspacePath = config.workspacePath;
    console.log('保存 workspacePath 到会话:', config.workspacePath);
  }

  // 处理运行模式变更
  if (typeof config.runMode !== 'undefined') {
    currentSession.value.settings.runMode = config.runMode;
    console.log('保存 runMode 到会话:', config.runMode);
  }

  // 处理分组选择
  if (typeof config.groupId !== 'undefined') {
    currentSession.value.groupId = config.groupId;
    console.log('保存 groupId 到会话:', config.groupId);
  }
};

// 前往角色管理页面

onMounted(() => {
  title.value = "你今天想聊点什么";
  // 先加载模型列表，再加载角色列表
  Promise.all([loadModels(), loadCharacters()]).catch(error => {
    console.error('初始化数据失败:', error);
  });
  // 启动打字机效果
  startTypewriter();
  // 从 query 参数恢复分组预选
  const groupId = route.query.groupId;
  if (groupId && typeof groupId === 'string') {
    currentSession.value.groupId = groupId;
  }
});

// 监听 groupId 查询参数变化（已在新建面板时点击其他分组的情况）
watch(() => route.query.groupId, (newGroupId) => {
  if (newGroupId && typeof newGroupId === 'string') {
    currentSession.value.groupId = newGroupId;
  } else {
    currentSession.value.groupId = null;
  }
});

onUnmounted(() => {
  clearTypewriterTimer();
});

const autoTitle = (): string => {
  if (inputMessage.value.content && inputMessage.value.content.length > 0) {
    return inputMessage.value.content.substring(0, 20);
  }
  return "新建对话"
}

const sendMessage = async (): Promise<void> => {
  if (!currentSession.value.characterId) {
    notify.error("创建失败", '请先选择一个角色模板');
    return;
  }
  // 修复：传递完整的 payload，包含 knowledgeBaseIds
  emit("create-session", {
    characterId: currentSession.value.characterId,
    modelId: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings,
    workspacePath: currentSession.value.workspacePath || null,
    groupId: currentSession.value.groupId || null
  }, {
    content: inputMessage.value.content,      // 使用 content 字段
    files: inputMessage.value.files || [],    // 使用 files 字段
    knowledgeBaseIds: currentSession.value.settings?.referencedKbs || []  // 新增：传递知识库 ID
  });
}


// 设置操作

</script>

<style scoped>
/* 打字机光标样式 */
.typewriter-cursor {
  display: inline-block;
  width: 3px;
  height: 1em;
  background-color: currentColor;
  margin-left: 2px;
  vertical-align: text-bottom;
  opacity: 1;
  position: relative;
  top: -4px;
}

/* 光标闪烁动画 */
.cursor-blink {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>