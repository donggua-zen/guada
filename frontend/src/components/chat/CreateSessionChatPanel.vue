<template>

  <!-- 输入区域 -->
  <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center mb-20">
    <div class="w-full flex items-center justify-center mb-20">
      <div class="banner w-20 mb-4">
        <img :src="bannerPath" alt="" />
      </div>
      <h1 class="text-4xl mb-6 text-(--gd-color-text) ml-5">
        <span class="typewriter-text">{{ displayedText }}</span>
        <span class="typewriter-cursor" :class="{ 'cursor-blink': isTypingComplete }"></span>
      </h1>
    </div>
    <!-- 已选智能体 + 抽屉切换 -->
    <div class="w-full max-w-192 flex flex-col items-start mx-auto relative">
      <!-- 智能体选择行 -->
      <div class="flex items-center justify-center gap-1.5 mb-4 text-sm text-(--gd-color-text-gray) ml-4">
        <span>{{ t('chat.welcome.use') }}</span>
        <span v-if="currentAgent"
          class="agent-chip group cursor-pointer inline-flex items-center gap-1.5 px-2 py-0.5 rounded-(--gd-size-dialog-rounded-radius) bg-(--gd-color-surface) border border-(--gd-color-surface-border) hover:bg-(--gd-color-surface-hover) transition-colors"
          @click="goToAgents">
          <Avatar :src="currentAgent.avatarUrl" type="assistant" :name="currentAgent.name"
            class="w-4 h-4 shrink-0 rounded overflow-hidden" />
          <span class="text-sm font-medium text-(--gd-color-text)">{{ currentAgent.name }}</span>
          <el-icon size="12"
            class="shrink-0 text-(--gd-color-text-gray) group-hover:text-(--gd-color-text) transition-colors">
            <ChevronRight24Regular />
          </el-icon>
        </span>
        <button v-else
          class="agent-chip group cursor-pointer inline-flex items-center gap-1 px-2 py-0.5 rounded-(--gd-size-dialog-rounded-radius) bg-(--gd-color-surface) border border-(--gd-color-surface-border) hover:bg-(--gd-color-surface-hover) transition-colors"
          @click="goToAgents">
          <el-icon size="14" class="text-(--gd-color-text-gray) group-hover:text-(--gd-color-text) transition-colors">
            <PersonAdd24Regular />
          </el-icon>
          <span class="text-sm font-medium text-(--gd-color-text-gray) group-hover:text-(--gd-color-text)">{{
            t('chat.welcome.selectAgent') }}</span>
        </button>
        <span>{{ t('chat.welcome.startNewSession') }}</span>
      </div>
      <!-- 附加内容胶囊已并入 ChatInput 内部(与知识库标签同排),此处不再外置 -->
      <ChatInputToolbar :config="chatInputConfig" @config-change="handleConfigChange" />
      <div class="w-full relative z-30">
        <!-- files 必须双向绑定：单向 :files 会让 ChatInput 里选好的附件全部丢失
             （ChatInput 只 emit('update:files')，父组件不接就没人保存） -->
        <ChatInput v-model:value="inputMessage.content" :config="chatInputConfig" mode="create"
          :agent-id="currentSession.agentId || ''" @config-change="handleConfigChange"
          :buttons="chatInputButtons" v-model:files="inputMessage.files" :streaming="false" @send="sendMessage" />
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
import { useSelectedAgent } from '@/composables/useSelectedAgent';
// 组件导入
import { ChatInput, Avatar } from "../ui";
import ChatInputToolbar from "./chat-input/ChatInputToolbar.vue";
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

// 智能体数据
const agents = ref<any[]>([]);

// 模型数据
const models = ref<any[]>([]);

// const lastSelectedModelId = useStorage('lastSelectedModelId', '');
const lastModelConfig = useStorage<any>('lastModelConfig', {});
const lastSelectedAgentId = useStorage('lastSelectedAgentId', '');

// 用户手动选择的模型 ID（刷新页面后从 localStorage 恢复）
const userSelectedModelId = useStorage<string | null>('userSelectedModelId', null);

// 用户上次选择的思考强度（'' = 从未选择 → 由档位菜单决定默认中间档）
const userSelectedThinkingEffort = useStorage<string>('userSelectedThinkingEffort2', '');

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
  agentId: null,  // 必须绑定智能体
  model_id: null,
  avatar_url: null,
  title: t('chat.welcome.newSession'),
  workspacePath: null,  // 工作目录路径，默认为 null 使用系统默认目录
  settings: {
    referencedKbs: userSelectedKnowledgeBaseIds.value,
    modelName: null,
    // 未选择过（''）不写入：让会话保持"未设置"，由档位菜单决定默认中间档
    thinkingEffort: userSelectedThinkingEffort.value || null,
    sandboxMode: 'workspace-write',
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



// 当前选中的智能体
const currentAgent = computed(() => {
  if (currentSession.value.agentId) {
    return agents.value.find(c => c.id === currentSession.value.agentId);
  }
  return null;
});

// 当前使用的模型 ID（三级回退逻辑）
const currentModelId = computed(() => {
  // 第一优先级：如果用户手动选择过模型，使用用户选择的
  if (userSelectedModelId.value) {
    return userSelectedModelId.value;
  }

  // 第二优先级：使用智能体的默认模型
  if (currentAgent.value?.modelId) {
    return currentAgent.value.modelId;
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

// 监听智能体变化，当智能体切换时重置为智能体默认模型
watch(() => currentSession.value.agentId, (newCharId, oldCharId) => {
  // 如果是初始化阶段，跳过处理（由 loadAgents 直接设置）
  if (isInitializing.value) {
    return;
  }

  if (newCharId && newCharId !== oldCharId) {
    // 智能体切换时，使用三级回退逻辑选择模型
    const newAgent = agents.value.find(c => c.id === newCharId);
    if (newAgent) {
      let selectedModelId: string | null = null;

      // 第一优先级：智能体的默认模型
      if (newAgent.modelId) {
        selectedModelId = newAgent.modelId;
        // 清空用户手动选择的模型 ID（因为智能体有推荐模型）
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

      // 切换智能体时，重置会话设置
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

// 加载智能体列表
const loadAgents = async (): Promise<void> => {
  try {
    const response = await apiService.fetchAgents();
    agents.value = response.items || [];

    // 优先使用上次选择的智能体
    if (agents.value.length > 0) {
      // 设置初始化标志，防止 watch 干扰
      isInitializing.value = true;

      const savedAgent = agents.value.find(c => c.id === lastSelectedAgentId.value);
      const targetAgent = savedAgent || agents.value[0];

      if (targetAgent) {
        currentSession.value.agentId = targetAgent.id;

        // 三级回退逻辑确定模型 ID
        let selectedModelId: string | null = null;

        // 第一优先级：用户手动选择的模型
        if (userSelectedModelId.value) {
          selectedModelId = userSelectedModelId.value;
        }
        // 第二优先级：智能体的默认模型
        else if (targetAgent.modelId) {
          selectedModelId = targetAgent.modelId;
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
    console.error('获取智能体列表失败:', error);
    notify.error(t('common.error.loadFailed'), error);
    // 即使出错也要恢复标志
    isInitializing.value = false;
  }
};

// 选择智能体（从抽屉中选择）
const handleAgentSelect = (agent: any): void => {
  currentSession.value.agentId = agent.id;
  lastSelectedAgentId.value = agent.id;

  // 切换智能体时的模型选择逻辑
  let selectedModelId: string | null = null;

  if (agent.modelId) {
    selectedModelId = agent.modelId;
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

const handleAgentSelectById = (agentId: string): void => {
  const agent = agents.value.find(c => c.id === agentId);
  if (agent) handleAgentSelect(agent);
};

// 前往智能体页面切换智能体
const goToAgents = (): void => {
  router.push({ name: 'Agents' });
};

// ========== ChatInput 配置管理 ==========

/**
 * ChatInput 组件的配置对象（计算属性）
 * 与 handleConfigChange 中的处理逻辑一一对应，方便对照维护
 */
const chatInputConfig = computed(() => ({
  // 模型 ID
  modelId: currentModelId.value,

  // 未设置 = 会话从未选过档位 → 交给 ChatInput 取菜单默认中间档（不要在这里填 'none'）
  thinkingEffort: currentSession.value?.settings?.thinkingEffort || undefined,

  // Token 上限（会话级别独立配置）
  maxTokensLimit: currentSession.value?.settings?.maxTokensLimit ?? null,

  // 知识库 IDs
  knowledgeBaseIds: currentSession.value?.settings?.referencedKbs || [],

  // 运行模式
  sandboxMode: currentSession.value?.settings?.sandboxMode || 'workspace-write',

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

  // 处理思考强度变更（只有真实选择才落库/持久化，空值不覆盖已存值）
  if (config.thinkingEffort) {
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

  // 处理安全模式变更
  if (typeof config.sandboxMode !== 'undefined') {
    currentSession.value.settings.sandboxMode = config.sandboxMode;
    console.log('保存 sandboxMode 到会话:', config.sandboxMode);
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

// 前往智能体管理页面

const workspaceStore = useWorkspaceStore()
const { consumePrefill } = usePrefillInput()
const { consumeSelectedAgent } = useSelectedAgent()

onMounted(() => {
  title.value = t('chat.welcome.pageTitle');
  // 先加载模型列表，再加载智能体列表
  Promise.all([loadModels(), loadAgents()]).then(() => {
    // 智能体列表加载完成后，检查是否有跨页面传递的预选智能体
    const preSelectedId = consumeSelectedAgent();
    if (preSelectedId) {
      const agent = agents.value.find(c => c.id === preSelectedId);
      if (agent) {
        handleAgentSelect(agent);
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

/**
 * @param payload ChatInput 的 send 载荷。附件以载荷为准——它带的是 ChatInput 内部
 *   归一后的列表；直接读 inputMessage.files 在双向绑定之外的场景（粘贴等）可能还是旧的。
 */
const sendMessage = async (payload?: { content?: string; files?: any[]; knowledgeBaseIds?: string[] }): Promise<void> => {
  if (!currentSession.value.agentId) {
    notify.error(t('common.createFailed'), t('chat.welcome.createFailedNoAgent'));
    return;
  }
  // 修复：传递完整的 payload，包含 knowledgeBaseIds
  emit("create-session", {
    agentId: currentSession.value.agentId,
    modelId: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings,
    workspacePath: currentSession.value.workspacePath || null,
    groupId: currentSession.value.groupId || null
  }, {
    content: payload?.content ?? inputMessage.value.content,
    files: payload?.files ?? inputMessage.value.files ?? [],
    knowledgeBaseIds: payload?.knowledgeBaseIds ?? currentSession.value.settings?.referencedKbs ?? []
  });
}


// 设置操作

</script>

<style scoped>
/* 创建会话页：输入区域不透明，消除与工具栏负边距重叠时的半透明穿透 */
:deep(.input-area) {
  background: var(--gd-color-input-bg) !important;
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