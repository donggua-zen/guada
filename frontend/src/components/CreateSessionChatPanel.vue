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
      <span class="hidden md:block">{{ chatTitle }}</span>
      <n-divider vertical />
      <n-button tertiary round size="small" icon-placement="left" @click="handleSwitchModelClick">
        {{ currentModelName }}
        <template #icon>
          <n-icon size="18">
            <SettingsTwotone />
          </n-icon>
        </template>
      </n-button>
    </div>



    <!-- 输入区域 -->
    <div class="px-5 pb-2.5 w-full flex-1 flex flex-col items-center justify-center">
      <h1 class="text-3xl mb-4 text-gray-600">想聊些什么？</h1>
      <div class="mb-3 mx-auto flex items-start w-full  max-w-[900px]">
        <n-popselect v-model:value="currentSession.model_id" :options="modelOptions" trigger="click">
          <div
            class="flex items-center justify-center rounded-full border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors text-gray-500 cursor-pointer">
            <OpenAI class="w-5 h-5 mr-1" />
            <span>{{ currentModelName }}</span>
          </div>
        </n-popselect>
      </div>
      <div class="w-full  max-w-[900px]">
        <ChatInput class="border border-gray-300" v-model:value="inputMessage.text"
          v-model:web-search-enabled="webSearchEnabled" v-model:thinking-enabled="thinkingEnabled"
          :buttons="chatInputButtons" :files="inputMessage.files" :streaming="false" @send="sendMessage"
          @image-upload="handleImageUpload" @toggle-web-search="handleWebSearch" @toggle-thinking="toggleDeepThinking"
          :shadow="inputHasShadow" @focus="inputHasShadow = true" @blur="inputHasShadow = false" />
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUpdate, reactive } from "vue";
import { store } from "../store/store";
import { apiService } from "../services/ApiService";
import { usePopup } from "@/composables/usePopup";
import { useRouter } from "vue-router";

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
const currentSessionId = ref(null);
const itemRefs = ref({});

// 模型数据
const models = ref([]);
const providers = ref([]);

const inputHasShadow = ref(false);

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
  "createSession"
]);


const chatTitle = ""



const inputMessage = computed({
  get: () => store.getInputMessage(currentSessionId.value) || { text: "", files: [] },
  set: (value) => store.setInputMessage(currentSessionId.value, value)
});


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
  // 初始化相关逻辑
  loadModels();
});

// 消息发送处理
async function sendNewMessage(sessionId, text, files, replaceMessageId = null) {

}



const handleSwitchModelClick = (modelId) => {
  emit("openSwitchModel", modelId);
};




const sendMessage = async () => {
  if (!currentModel.value) {
    notify.error('请选择对话模型');
    return;
  }
  emit("createSession", {
    model_id: currentModel.value.id,
    title: currentSession.value.title,
    settings: currentSession.value.settings
  }, { ...inputMessage.value });
  inputMessage.value = { text: "", files: [] };
}


// 设置操作
const handleWebSearch = () => {

};

const toggleDeepThinking = () => {

};

function handleImageUpload() {
  console.log("图片上传功能");
}


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
