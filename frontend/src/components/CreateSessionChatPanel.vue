<template>
  <div class="flex flex-col h-full w-full">
    <!-- 聊天头部 -->
    <div class="chat-header " style="display: none;">
      <template v-if="!localSidebarVisible">
        <n-button text @click="localSidebarVisible = true">
          <template #icon>
            <n-icon size="22">
              <FormatListBulletedSharp />
            </n-icon>
          </template>
        </n-button>
        <span class="ml-4"></span>
      </template>
      <span class="hidden md:block">{{ title }}</span>
    </div>



    <!-- 输入区域 -->
    <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center">
      <div class="banner max-w-full mx-auto w-80 mb-4">
        <img src="/images/chat_banner.webp" alt=""></img>
      </div>
      <h1 class="text-3xl mb-6 text-gray-600">Hi，想聊些什么？</h1>
      <!-- <div class="mb-3 mx-auto flex items-start w-full max-w-[900px]">
        <n-popselect v-model:value="currentSession.model_id" :options="modelOptions" trigger="click">
          <div
            class="animate-outside rounded-full border border-gray-200 hover:bg-gray-50 transition-all duration-300 ease-in-out overflow-hidden"
            :style="{ width: containerWidth + 'px' }">
            <div ref="innerEl"
              class="animate-inside flex items-center justify-center px-2 py-1 text-gray-500 cursor-pointer min-w-[min-content]"
              :style="{ width: 'fit-content' }">
              <OpenAI class="w-5 h-5 mr-1 flex-shrink-0" />
              <span class="whitespace-nowrap mr-1">{{ currentModelName }}</span>
            </div>
          </div>
        </n-popselect>
      </div> -->
      <div class="w-full  max-w-[900px]">
        <ChatInput class="border" :class="{ 'border-gray-400': !inputHasShadow}"
          v-model:value="inputMessage.text" v-model:web-search-enabled="webSearchEnabled"
          v-model:thinking-enabled="thinkingEnabled" :buttons="chatInputButtons" :files="inputMessage.files"
          :streaming="false" @send="sendMessage" @toggle-web-search="handleWebSearch"
          @toggle-thinking="toggleDeepThinking" :shadow="inputHasShadow" @focus="inputHasShadow = true"
          @blur="inputHasShadow = false">
          <template #buttons>
            <n-popselect v-model:value="currentSession.model_id" :options="modelOptions" trigger="click">
              <div
                class="animate-outside rounded-full border border-gray-200 hover:bg-gray-50 transition-all duration-300 ease-in-out overflow-hidden mr-2.5"
                :style="{ width: containerWidth + 'px' }" style="height:28px">
                <div ref="innerEl"
                  class="animate-inside flex items-center justify-center px-2 py-1 text-gray-500 cursor-pointer min-w-[min-content]"
                  :style="{ width: 'fit-content' }" style="height:26px">
                  <OpenAI class="w-5 h-5 mr-1 flex-shrink-0" />
                  <span class="whitespace-nowrap mr-1 text-sm">{{ currentModelName }}</span>
                </div>
              </div>
            </n-popselect>
          </template>
        </ChatInput>
      </div>
      <div>
        <div class="flex items-center justify-center mt-6">
          您也可以<span class="w-1"></span><n-button secondary type="primary" round size="small"
            @click="handleCreateSessionClick">直接创建会话</n-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUpdate, nextTick } from "vue";
import { useStorage } from "@vueuse/core"
import { apiService } from "../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useTitle } from "../composables/useTitle";
// 组件导入
import ChatInput from "./ChatInput.vue";

// 图标导入
import {
  SettingsTwotone,
  FormatListBulletedSharp
} from "@vicons/material";

import { OpenAI } from "@/components/icons"

// UI组件导入
import { NButton, NIcon, NDivider, NPopselect } from "naive-ui";

// 弹出层工具
const { notify } = usePopup();

// 响应式数据
const title = useTitle();
const itemRefs = ref({});

// 模型数据
const models = ref([]);
const providers = ref([]);

const inputHasShadow = ref(false);
const innerEl = ref(null)
const containerWidth = ref(100) // 初始宽度

const lastSelectedModelId = useStorage('lastSelectedModelId', '');

const inputMessage = ref({
  text: "",
  files: []
});


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

// 更新容器宽度
const updateContainerWidth = () => {
  if (innerEl.value) {
    const innerWidth = innerEl.value.scrollWidth
    containerWidth.value = innerWidth
  }
}

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

    models.value = response.models || []
    providers.value = response.providers || []
    if (models.value.length > 0) {
      if (lastSelectedModelId.value) {
        if (models.value.find(model => model.id === lastSelectedModelId.value)) {
          currentSession.value.model_id = lastSelectedModelId.value;
          return;
        }
      }
      currentSession.value.model_id = models.value[0].id
      lastSelectedModelId.value = currentSession.value.model_id
    }
  } catch (error) {
    console.error('获取模型列表失败:', error)
    notify.error('获取模型列表失败', error)
  }
}



// 生命周期
onBeforeUpdate(() => {
  itemRefs.value = {};
});

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
const handleWebSearch = () => {

};

const toggleDeepThinking = () => {

};



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
