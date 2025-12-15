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
      <div class="w-full  max-w-[800px]">
        <ChatInput v-model:value="inputMessage.text" v-model:web-search-enabled="webSearchEnabled"
          v-model:thinking-enabled="thinkingEnabled" :buttons="chatInputButtons" :files="inputMessage.files"
          :streaming="false" @send="sendMessage" @toggle-web-search="handleWebSearch"
          @toggle-thinking="toggleDeepThinking">
          <template #buttons>
            <button @click="handleSwitchModelClick"
              class="hidden md:inline-flex rounded-full animate-outside transition-all duration-300 ease-in-out overflow-hidden mr-2.5 border border-[var(--primary-color)] bg-[var(--primary-color-0f)] hover:bg-[var(--primary-color-0f)]"
              :style="{ width: containerWidth + 'px' }" style="height:28px">
              <div ref="innerEl"
                class="animate-inside flex items-center justify-center px-2 py-1 text-[var(--primary-color)]  cursor-pointer min-w-[min-content]"
                :style="{ width: 'fit-content' }" style="height:26px">
                <OpenAI class="w-5 h-5 flex-shrink-0" />
                <span class="whitespace-nowrap mx-1 text-sm hidden md:block">{{ currentModelName }}</span>
              </div>
            </button>
          </template>
        </ChatInput>
      </div>
      <div>
        <div class="flex items-center justify-center mt-6">
          您也可以<span class="w-1"></span>
          <UiButton type="primary" plain round :border="false" size="small" @click="handleCreateSessionClick">直接创建会话
          </UiButton>
        </div>
      </div>
    </div>
    <n-popselect ref="popselectRef" scrollable :x="x" :y="y" v-model:value="currentSession.model_id"
      :options="modelOptions" trigger="manual" v-model:show="showPopover"
      @clickoutside="handleClickOutside">Loading</n-popselect>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useStorage } from "@vueuse/core"
import { apiService } from "../services/ApiService";
import { usePopup } from "../composables/usePopup";
import { useTitle } from "../composables/useTitle";
// 组件导入
import { ChatInput, UiButton } from "./ui";
import ChatHeader from "./ChatHeader.vue";

import { OpenAI } from "@/components/icons"

// UI组件导入
import { NPopselect } from "naive-ui";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

// 弹出层工具
const { notify } = usePopup();

// 响应式数据
const title = useTitle();
const popselectRef = ref(null);

// 模型数据
const models = ref([]);
const providers = ref([]);

const innerEl = ref(null)
const containerWidth = ref(100) // 初始宽度

const lastSelectedModelId = useStorage('lastSelectedModelId', '');

const inputMessage = ref({
  text: "",
  files: []
});

const x = ref(0)
const y = ref(0)
const showPopover = ref(false)

// 计算属性
const currentSession = ref({
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

const emitPopoverTarget = ref(null);

const handleSwitchModelClick = (e) => {
  e.stopPropagation();
  if (showPopover.value) {
    showPopover.value = false
  }
  else {
    showPopover.value = true
    emitPopoverTarget.value = e.target
    const el = e.target
    const rect = el.getBoundingClientRect()
    const bottom = rect.bottom
    const left = rect.left + (rect.width / 2)
    x.value = left
    y.value = bottom
  }
}

const handleClickOutside = (e) => {
  if (emitPopoverTarget.value && emitPopoverTarget.value === e.target) {
    return
  }
  showPopover.value = false
}

// 更新容器宽度
const updateContainerWidth = () => {
  if (innerEl.value) {
    const innerWidth = innerEl.value.scrollWidth
    containerWidth.value = innerWidth
  }
}

watch(isMobile, () => {
  updateContainerWidth()
})

// 监听模型名称变化
watch(currentModelName, async () => {
  showPopover.value = false
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

    models.value = response.models || []
    providers.value = response.providers || []
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

onMounted(() => {
  title.value = "你今天想聊点什么";
  // 初始化相关逻辑
  loadModels();
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
  emit("create-session", {
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
  emit("create-session", {
    model_id: currentModel.value.id,
    title: autoTitle(),
    settings: currentSession.value.settings
  })
}

// 设置操作
const handleWebSearch = () => { };

const toggleDeepThinking = () => { };

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
</style>