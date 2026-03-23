<template>
  <div class="flex flex-col h-full w-full">
    <!-- 聊天头部 -->
    <ChatHeader :current-model-name="currentModelName" :sidebar-visible="localSidebarVisible" :has-more-options="false"
      @open-switch-model="handleSwitchModelClick" />

    <!-- 输入区域 -->
    <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center mb-40">
      <div class="banner max-w-full mx-auto w-80 mb-4">
        <img src="/images/chat_banner.webp" alt=""></img>
      </div>
      <h1 class="text-3xl mb-6 text-gray-600">Hi，想聊些什么？</h1>
      
      <!-- 角色选择提示 -->
      <div v-if="!currentSession.character_id" class="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg max-w-md">
        <div class="flex items-start">
          <el-icon class="text-blue-500 mt-1 mr-2"><InfoFilled /></el-icon>
          <div>
            <p class="text-sm text-gray-700 font-medium">需要选择角色模板</p>
            <p class="text-xs text-gray-600 mt-1">请先选择一个角色模板，然后才能创建会话</p>
            <el-button type="primary" size="small" class="mt-2" @click="showCharacterSelector = true">
              选择角色
            </el-button>
          </div>
        </div>
      </div>
      
      <!-- 已选角色显示 -->
      <div v-if="currentSession.character_id" class="mb-6 flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg max-w-md cursor-pointer hover:bg-gray-100 transition-colors" @click="showCharacterSelector = true">
        <div class="w-10 h-10 flex-shrink-0 overflow-hidden rounded">
          <Avatar :src="currentCharacter?.avatar_url" type="assistant" class="w-full h-full object-cover" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-700 truncate">{{ currentCharacter?.title || '未命名角色' }}</p>
          <p class="text-xs text-gray-500 truncate">{{ currentCharacter?.description || '暂无描述' }}</p>
        </div>
        <el-icon class="text-gray-400 flex-shrink-0"><ArrowRightTwotone /></el-icon>
      </div>
      
      <div v-if="currentSession.character_id" class="w-full  max-w-[800px]">
        <ChatInput v-model:value="inputMessage.text" v-model:web-search-enabled="webSearchEnabled"
          v-model:thinking-enabled="thinkingEnabled" :buttons="chatInputButtons" :files="inputMessage.files"
          :streaming="false" @send="sendMessage" @toggle-web-search="handleWebSearch"
          @toggle-thinking="toggleDeepThinking">
          <template #buttons>
            <el-button @click="handleSwitchModelClick" ref="outside" round plain type="primary"
              class="animate-outside transition-all duration-300 ease-in-out overflow-hidden"
              :style="{ width: containerWidth + 'px', display: isMobile ? 'none' : 'inline-flex' }">
              <div ref="innerEl" class="animate-inside flex items-center justify-center min-w-[min-content]"
                :style="{ width: 'fit-content' }" style="height:26px">
                <OpenAI class="w-4 h-4 flex-shrink-0" />
                <span class="whitespace-nowrap mx-1 text-sm hidden md:block">{{ currentModelName }}</span>
              </div>
            </el-button>
          </template>
        </ChatInput>
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
        <el-input v-model="characterSearchText" placeholder="搜索角色..." prefix-icon="Search" clearable />
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
          <el-icon size="48" class="mb-2"><Search /></el-icon>
          <p>未找到匹配的角色</p>
        </div>
      </div>
      
      <!-- 底部按钮 -->
      <template #footer>
        <div class="flex justify-between items-center">
          <el-button @click="goToCharactersPage" plain>
            <el-icon class="mr-1"><Apps /></el-icon>
            管理角色
          </el-button>
          <el-button @click="showCharacterSelector = false">取消</el-button>
        </div>
      </template>
    </el-dialog>
    
    <el-dropdown ref="dropdownRef" :virtual-ref="triggerRef" :show-arrow="false" virtual-triggering trigger="manual"
      placement="bottom" popper-class="model-selector-dropdown" @visible-change="handleVisibleChange"
      @command="handleCommand">
      <template #dropdown>
        <el-dropdown-menu class="max-h-80 overflow-y-auto">
          <template v-for="option in modelOptions" :key="option.key">
            <el-dropdown-item v-if="!option.disabled" :command="option.value"
              :class="{ 'bg-[var(--color-primary-200)]': currentSession.model_id === option.value }">
              <span :class="{ 'text-[var(--color-primary)]': currentSession.model_id === option.value }"> {{
                option.label }}</span>
            </el-dropdown-item>
            <div v-else class="px-4 py-2 text-gray-400 cursor-default">{{ option.label }}</div>
          </template>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick, onBeforeUnmount } from "vue";
import { useStorage } from "@vueuse/core"
import { apiService } from "../services/ApiService";
import { usePopup } from "../composables/usePopup";
import { useTitle } from "../composables/useTitle";
import { useRouter } from 'vue-router';
// 组件导入
import { ChatInput } from "./ui";
import ChatHeader from "./ChatHeader.vue";

import { OpenAI } from "@/components/icons"
import { InfoFilled } from '@vicons/material'

// UI组件导入
import { ElDropdown, ElDropdownMenu, ElDropdownItem, ElButton } from "element-plus";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

// 弹出层工具
const { notify } = usePopup();
const router = useRouter();

// 响应式数据
const title = useTitle();
const dropdownRef = ref(null);

// 模型数据
const models = ref([]);
const providers = ref([]);

// 角色数据
const characters = ref([]);
const showCharacterSelector = ref(false);
const characterSearchText = ref('');

const innerEl = ref(null)
const outside = ref(null)
const containerWidth = ref(100) // 初始宽度

const lastSelectedModelId = useStorage('lastSelectedModelId', '');
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');

const inputMessage = ref({
  text: "",
  files: []
});

const showDropdown = ref(false);

const triggerRef = ref(null)

// 计算属性
const currentSession = ref({
  character_id: null,  // 必须绑定角色
  model_id: null,
  avatar_url: null,
  title: "新建对话",
  settings: {
    web_search_enabled: false,
    thinking_enabled: false,
    model_name: null,
  }
})

const currentModel = computed(() => {
  if (currentSession.value.model_id) {
    const model = models.value.find(model => model.id === currentSession.value.model_id)
    return model
  }
  return null
});

const currentModelName = computed(() => {
  const model = currentModel.value
  return model ? model.model_name.split("/").pop() : "请选择对话模型"
});

// 当前选中的角色
const currentCharacter = computed(() => {
  if (currentSession.value.character_id) {
    return characters.value.find(c => c.id === currentSession.value.character_id);
  }
  return null;
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


const handleSwitchModelClick = (e) => {
  e.stopPropagation();
  // 查找最近的 button 元素，确保获取的是按钮本身的坐标
  const buttonEl = e.target.closest('button');
  console.log(buttonEl)
  if (buttonEl) {
    showDropdown.value = !showDropdown.value;
    triggerRef.value = buttonEl
    if (showDropdown.value) {
      dropdownRef.value.handleOpen();
    } else {
      dropdownRef.value.handleClose();
    }
  }
}

// 更新容器宽度
const updateContainerWidth = () => {
  if (innerEl.value) {
    const innerWidth = innerEl.value.scrollWidth
    const left = window.getComputedStyle(outside.value.$el)
    containerWidth.value = innerWidth + parseInt(left.paddingLeft) + parseInt(left.paddingRight)
  }
}

watch(isMobile, () => {
  if (!isMobile) {
    nextTick(() => {
      updateContainerWidth()
    })
  }
})

// 监听模型名称变化
watch(currentModelName, async () => {
  if (currentModel.value)
    lastSelectedModelId.value = currentModel.value.id
  await nextTick() // 等待DOM更新
  updateContainerWidth()
}, { immediate: true })

const modelOptions = computed(() => {
  if (!models.value.length || !providers.value.length) return []

  const options = []

  providers.value?.forEach(provider => {
    // 获取该供应商下的text类型模型
    const providerModels = models.value.filter(model =>
      model.provider_id === provider.id && model.model_type === 'text'
    )

    if (providerModels.length > 0) {
      // 添加分组标签
      options.push({
        label: provider.name,
        key: provider.id,
        disabled: true,
      })

      // 添加该分组下的模型选项
      providerModels.forEach(model => {
        options.push({
          label: model.model_name,
          value: model.id,
          key: model.id
        })
      })
    }
  })
  return options
})

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

const webSearchEnabled = computed({
  get() {
    return currentSession.value.settings?.web_search_enabled;
  },
  set(value) {
    currentSession.value.settings["web_search_enabled"] = value;
  }
});

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
    thinkingButton: currentModel.value?.features?.includes("thinking"),
    imagesButton: currentModel.value?.features?.includes("visual"),
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

const loadModels = async () => {
  try {
    const response = await apiService.fetchModels()
    response.items.forEach(provider => {
      models.value.push(...provider.models)
      delete provider.models
      providers.value.push(provider)
    })
    if (models.value.length > 0) {
      // 优先使用上次选择的模型
      const savedModel = models.value.find(model => model.id === lastSelectedModelId.value)
      currentSession.value.model_id = savedModel ? savedModel.id : models.value[0].id
      lastSelectedModelId.value = currentSession.value.model_id
    }
  } catch (error) {
    console.error('获取模型列表失败:', error)
    notify.error('获取模型列表失败', error)
  }
}

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
};

// 前往角色管理页面
const goToCharactersPage = () => {
  showCharacterSelector.value = false;
  router.replace({ name: 'Chat', params: { sessionId: 'characters' } });
};

onMounted(() => {
  title.value = "你今天想聊点什么";
  // 初始化相关逻辑
  loadModels();
  loadCharacters();
});

const autoTitle = () => {
  if (inputMessage.value.text && inputMessage.value.text.length > 0) {
    return inputMessage.value.text.substring(0, 20);
  }
  return "新建对话"
}

const sendMessage = () => {
  if (!currentModel.value) {
    notify.error('请选择对话模型');
    return;
  }
  if (!currentSession.value.character_id) {
    notify.error('请先选择一个角色模板');
    router.push({ name: 'Characters' });
    return;
  }
  emit("create-session", {
    character_id: currentSession.value.character_id,
    model_id: currentModel.value.id,
    title: autoTitle(),
    settings: currentSession.value.settings
  }, { ...inputMessage.value });
  inputMessage.value = { text: "", files: [] };
}

const handleCreateSessionClick = () => {
  if (!currentModel.value) {
    notify.error('请选择对话模型');
    return;
  }
  if (!currentSession.value.character_id) {
    notify.error('请先选择一个角色模板');
    router.push({ name: 'Characters' });
    return;
  }
  emit("create-session", {
    character_id: currentSession.value.character_id,
    model_id: currentModel.value.id,
    title: autoTitle(),
    settings: currentSession.value.settings
  })
}

// 设置操作
const handleWebSearch = () => { };

const toggleDeepThinking = () => { };

const handleVisibleChange = (visible) => {
  if (!visible) {
    showDropdown.value = false;
    if (currentModel.value) {
      lastSelectedModelId.value = currentModel.value.id
      updateContainerWidth()
    }
  }
}

// 添加处理下拉菜单选择的方法
const handleCommand = (command) => {
  currentSession.value.model_id = command;
  showDropdown.value = false;
  if (currentModel.value) {
    lastSelectedModelId.value = currentModel.value.id
    updateContainerWidth()
  }
}

// 在onMounted中添加事件监听器
onMounted(() => {
  // 点击外部关闭下拉框
  const handleClickOutside = (e) => {
    if (showDropdown.value && dropdownRef.value) {
      const dropdownEl = dropdownRef.value.triggerRef?.el;
      if (dropdownEl && !dropdownEl.contains(e.target)) {
        showDropdown.value = false;
      }
    }
  };

  document.addEventListener('click', handleClickOutside);

  // 清理事件监听器
  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside);
  });
});

</script>

<style scoped>
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid rgba(21, 23, 28, 0.1);
  border-radius: 0;
  margin: 0 40px;
}

:deep(.model-selector-dropdown) {
  transform: translateX(-50%) !important;
  min-width: 200px;
}
</style>