<template>

  <!-- 输入区域 -->
  <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center mb-20">
    <div class="w-full flex items-center justify-center mb-20">
      <div class="banner w-20 mb-4">
        <img :src="bannerPath" alt=""></img>
      </div>
      <h1 class="text-4xl mb-6 text-(--color-text) ml-5">
        <span class="typewriter-text">{{ displayedText }}</span>
        <span class="typewriter-cursor" :class="{ 'cursor-blink': isTypingComplete }"></span>
      </h1>
    </div>
    <!-- 已选角色 + 抽屉切换 -->
    <div class="w-full max-w-192 flex flex-col items-start mx-auto relative">
      <!-- 角色选择行 -->
      <div class="flex items-center justify-center gap-1.5 mb-4 text-sm text-(--color-text-gray) ml-4">
        <span>{{ t('chat.welcome.use') }}</span>
        <span v-if="currentCharacter"
          class="character-chip group cursor-pointer inline-flex items-center gap-1.5 px-2 py-0.5 rounded-(--size-dialog-rounded-radius) bg-(--color-surface) border border-(--color-surface-border) hover:bg-(--color-surface-hover) transition-colors"
          @click="goToCharacters">
          <Avatar :src="currentCharacter.avatarUrl" type="assistant" :name="currentCharacter.title"
            class="w-4 h-4 shrink-0 rounded overflow-hidden" />
          <span class="text-sm font-medium text-(--color-text)">{{ currentCharacter.title }}</span>
          <el-icon size="12"
            class="shrink-0 text-(--color-text-gray) group-hover:text-(--color-text) transition-colors">
            <ChevronRight24Regular />
          </el-icon>
        </span>
        <button v-else
          class="character-chip group cursor-pointer inline-flex items-center gap-1 px-2 py-0.5 rounded-(--size-dialog-rounded-radius) bg-(--color-surface) border border-(--color-surface-border) hover:bg-(--color-surface-hover) transition-colors"
          @click="goToCharacters">
          <el-icon size="14" class="text-(--color-text-gray) group-hover:text-(--color-text) transition-colors">
            <PersonAdd24Regular />
          </el-icon>
          <span class="text-sm font-medium text-(--color-text-gray) group-hover:text-(--color-text)">{{
            t('chat.welcome.selectCharacter') }}</span>
        </button>
        <span>{{ t('chat.welcome.startNewSession') }}</span>
      </div>
      <!-- 附加内容胶囊 -->
      <AttachmentChips v-if="attachmentChips.length > 0" :chips="attachmentChips" @remove="removeAttachment" />
      <ChatInputToolbar :config="chatInputConfig" @config-change="handleConfigChange" />
      <div class="w-full relative z-30">
        <ChatInput v-model:value="inputMessage.content" :config="chatInputConfig" mode="create"
          :character-id="currentSession.characterId || ''" @config-change="handleConfigChange"
          :buttons="chatInputButtons" :files="inputMessage.files" :streaming="false" @send="sendMessage" />
      </div>

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
import { useI18n } from "vue-i18n";
const { t } = useI18n()
import { useStorage } from "@vueuse/core"
import { apiService } from '@/services/ApiService';
import { usePopup } from "../../composables/usePopup";
import { useTitle } from "../../composables/useTitle";
import { useRouter, useRoute } from 'vue-router';
import { fixFrontendAssetUrl } from '@/utils/url'
import { useWorkspaceStore } from '@/stores/workspace';
import { usePrefillInput } from '@/composables/usePrefillInput';
import { useSelectedCharacter } from '@/composables/useSelectedCharacter';
// 组件导入
import { ChatInput, Avatar } from "../ui";
import ChatInputToolbar from "./chat-input/ChatInputToolbar.vue";
import AttachmentChips from "./AttachmentChips.vue";
import type { AttachmentChip } from "./AttachmentChips.vue";
import { ChevronRight24Regular, PersonAdd24Regular } from '@vicons/fluent'


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
const userSelectedThinkingEffort = useStorage<string>('userSelectedThinkingEffort', 'none');

// 新增：用户选择的知识库 ID 列表（刷新页面后从 localStorage 恢复）
const userSelectedKnowledgeBaseIds = useStorage<string[]>('userSelectedKnowledgeBaseIds', []);

const inputMessage = ref({
  content: "",
  files: []
});

// 打字机效果相关状态
const fullText = t('chat.welcome.greeting');
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
  title: t('chat.welcome.newSession'),
  workspacePath: null,  // 工作目录路径，默认为 null 使用系统默认目录
  settings: {
    referencedKbs: userSelectedKnowledgeBaseIds.value,
    modelName: null,
    thinkingEffort: userSelectedThinkingEffort.value,
    runMode: 'normal',
    maxTokensLimit: null
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
    notify.error(t('common.error.loadFailed'), error);
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
    notify.error(t('common.error.loadFailed'), error);
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
  };

  if (selectedModelId) {
    lastModelConfig.value = {
      ...lastModelConfig.value,
      modelId: selectedModelId
    };
  }
};

const handleCharacterSelectById = (characterId: string): void => {
  const character = characters.value.find(c => c.id === characterId);
  if (character) handleCharacterSelect(character);
};

// 前往助手页面切换角色
const goToCharacters = (): void => {
  router.push({ name: 'Characters' });
};

// ========== ChatInput 配置管理 ==========

/**
 * ChatInput 组件的配置对象（计算属性）
 * 与 handleConfigChange 中的处理逻辑一一对应，方便对照维护
 */
const chatInputConfig = computed(() => ({
  // 模型 ID
  modelId: currentModelId.value,

  // 思考强度
  thinkingEffort: currentSession.value?.settings?.thinkingEffort || 'none',

  // Token 上限（会话级别独立配置）
  maxTokensLimit: currentSession.value?.settings?.maxTokensLimit ?? null,

  // 知识库 IDs
  knowledgeBaseIds: currentSession.value?.settings?.referencedKbs || [],

  // 运行模式
  runMode: currentSession.value?.settings?.runMode || 'normal',

  // 工作目录路径
  workspacePath: currentSession.value?.workspacePath || null,

  // 分组 ID
  groupId: currentSession.value?.groupId || null,

  // 附件
  attachments: currentSession.value?.settings?.attachments || {},
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

  // 处理 Token 上限（会话级别独立配置）
  if (typeof config.maxTokensLimit !== 'undefined') {
    currentSession.value.settings.maxTokensLimit = config.maxTokensLimit;
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

  // 处理附件
  if (typeof config.attachments !== 'undefined') {
    if (!currentSession.value.settings) currentSession.value.settings = {};
    currentSession.value.settings.attachments = config.attachments;
  }
};

// ── 动态附件管理 ──
const attachmentTypes = ref<Array<{ id: string; label: string; icon: string; pluginId: string; _items?: Array<{ id: string; name: string; description?: string }> }>>([]);

const attachmentChips = computed<AttachmentChip[]>(() => {
  const attachments = currentSession.value?.settings?.attachments || {};
  const chips: AttachmentChip[] = [];
  for (const [typeId, itemIds] of Object.entries(attachments) as [string, string[]][]) {
    const typeInfo = attachmentTypes.value.find(t => t.id === typeId);
    if (!typeInfo) continue;
    for (const itemId of itemIds) {
      const item = typeInfo._items?.find(i => i.id === itemId);
      if (item) {
        chips.push({ typeId, id: itemId, name: item.name, subtitle: item.description });
      }
    }
  }
  return chips;
});

async function loadAttachmentTypes() {
  try {
    const types = await apiService.getAttachmentTypes();
    const results: typeof attachmentTypes.value = [];
    for (const t of types) {
      let items: Array<{ id: string; name: string; description?: string }> = [];
      try {
        const lists = await apiService.getPluginAttachments(t.pluginId);
        const found = lists.find(l => l.typeId === t.id);
        items = found?.items || [];
      } catch { }
      results.push({ ...t, _items: items });
    }
    attachmentTypes.value = results;
  } catch {
    attachmentTypes.value = [];
  }
}

function removeAttachment(typeId: string, itemId: string) {
  if (!currentSession.value) return;
  if (!currentSession.value.settings) currentSession.value.settings = {};
  if (!currentSession.value.settings.attachments) currentSession.value.settings.attachments = {};
  const ids = [...(currentSession.value.settings.attachments[typeId] || [])];
  const idx = ids.indexOf(itemId);
  if (idx !== -1) ids.splice(idx, 1);
  if (ids.length === 0) {
    delete currentSession.value.settings.attachments[typeId];
  } else {
    currentSession.value.settings.attachments[typeId] = ids;
  }
}

onMounted(() => {
  loadAttachmentTypes();
});

// 前往角色管理页面

const workspaceStore = useWorkspaceStore()
const { consumePrefill } = usePrefillInput()
const { consumeSelectedCharacter } = useSelectedCharacter()

onMounted(() => {
  title.value = t('chat.welcome.pageTitle');
  // 先加载模型列表，再加载角色列表
  Promise.all([loadModels(), loadCharacters()]).then(() => {
    // 角色列表加载完成后，检查是否有跨页面传递的预选角色
    const preSelectedId = consumeSelectedCharacter();
    if (preSelectedId) {
      const character = characters.value.find(c => c.id === preSelectedId);
      if (character) {
        handleCharacterSelect(character);
      }
    }
  }).catch(error => {
    console.error('初始化数据失败:', error);
  });
  // 启动打字机效果
  startTypewriter();
  // 从 query 参数恢复分组预选
  const groupId = route.query.groupId;
  if (groupId && typeof groupId === 'string') {
    currentSession.value.groupId = groupId;
  }
  // 根据上次选择初始化工作目录
  initWorkspacePath()
  // 消费跨页面预填文本（如定时任务页"在对话中创建"）
  const prefill = consumePrefill()
  if (prefill) {
    inputMessage.value.content = prefill
  }
});

async function initWorkspacePath() {
  await workspaceStore.ensureBaseDir()
  const publicPath = workspaceStore.getPublicPath()
  const lastChoice = workspaceStore.getLastChoice()

  if (!lastChoice) {
    // 无记录 → 默认公共目录
    if (publicPath) {
      currentSession.value.workspacePath = publicPath
      workspaceStore.addRecent(publicPath)
    }
    return
  }

  if (lastChoice.mode === 'auto') {
    currentSession.value.workspacePath = null
    return
  }

  if (lastChoice.mode === 'public') {
    if (publicPath) {
      currentSession.value.workspacePath = publicPath
      workspaceStore.addRecent(publicPath)
    }
    return
  }

  if (lastChoice.mode === 'custom' && lastChoice.path) {
    // 检查路径是否仍在最近列表中
    if (workspaceStore.recentList.includes(lastChoice.path)) {
      currentSession.value.workspacePath = lastChoice.path
    } else {
      // 路径不在列表中 → 回退到公共目录
      if (publicPath) {
        currentSession.value.workspacePath = publicPath
        workspaceStore.addRecent(publicPath)
      }
    }
    return
  }

  // 兜底
  if (publicPath) {
    currentSession.value.workspacePath = publicPath
    workspaceStore.addRecent(publicPath)
  }
}

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
  return t('chat.welcome.newSession')
}

const sendMessage = async (): Promise<void> => {
  if (!currentSession.value.characterId) {
    notify.error(t('common.createFailed'), t('chat.welcome.createFailedNoCharacter'));
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
/* 创建会话页：输入区域不透明，消除与工具栏负边距重叠时的半透明穿透 */
:deep(.input-area) {
  background: var(--color-input-bg) !important;
  backdrop-filter: none !important;
  backdrop-saturate: unset !important;
}

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

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0;
  }
}
</style>