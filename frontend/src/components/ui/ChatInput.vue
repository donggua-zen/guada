<template>
  <div class="w-full flex flex-col items-center">
    <!-- 抽屉容器 - 放在输入框之前 -->
    <div class="drawer-container relative" ref="drawerContainerRef">
      <!-- 模型选择器抽屉 -->
      <transition name="drawer-slide">
        <div v-if="modelPanelVisible" 
             class="drawer-panel model-drawer"
             @click.stop>
          <div class="drawer-header">
            <h3 class="drawer-title">选择模型</h3>
            <el-button text @click="closeAllPanels">
              <el-icon><CloseOutlined /></el-icon>
            </el-button>
          </div>
          <div class="drawer-content">
            <div class="mb-4">
              <el-input v-model="modelSearchText" placeholder="搜索模型..." clearable>
                <template #prefix>
                  <el-icon>
                    <SearchFilled />
                  </el-icon>
                </template>
              </el-input>
            </div>
            <div class="model-list">
              <template v-for="provider in filteredProviders" :key="provider.id">
                <div class="provider-group mb-4">
                  <div class="provider-name text-sm font-medium text-gray-700 mb-2">
                    {{ provider.name }}
                  </div>
                  <div class="provider-models space-y-1">
                    <div v-for="model in getProviderModels(provider.id)" :key="model.id"
                      class="model-item p-3 rounded-lg cursor-pointer border transition-all mb-2 last:mb-0" :class="{
                        'bg-pink-50 dark:bg-pink-900/20 border-pink-300 dark:border-pink-700': tempModelId === model.id,
                        'border-gray-100 dark:border-gray-700 hover:bg-pink-50/50 dark:hover:bg-pink-900/10': tempModelId !== model.id
                      }" @click="selectAndCloseModel(model.id)">
                      <div class="flex items-start justify-between gap-2">
                        <div class="flex-1 min-w-0">
                          <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate mb-1">
                            {{ model.modelName }}</div>
                          <!-- 特性图标组 -->
                          <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-medium text-[10px]">
                              {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                            </span>

                            <!-- 输入/输出能力箭头组 -->
                            <div
                              v-if="model.modelType === 'text' && (model.config?.inputCapabilities || model.config?.outputCapabilities)"
                              class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                              <template v-for="cap in (model.config?.inputCapabilities || ['text'])" :key="'in-' + cap">
                                <el-icon :size="14">
                                  <TextT24Regular v-if="cap === 'text'" />
                                  <Image24Regular v-else />
                                </el-icon>
                              </template>
                              <el-icon :size="10" class="text-gray-300">
                                <ArrowRightTwotone />
                              </el-icon>
                              <template v-for="cap in (model.config?.outputCapabilities || ['text'])" :key="'out-' + cap">
                                <el-icon :size="14">
                                  <TextT24Regular v-if="cap === 'text'" />
                                  <Image24Regular v-else />
                                </el-icon>
                              </template>
                            </div>

                            <!-- 高级功能图标 -->
                            <template v-for="feature in (model.config?.features || [])" :key="feature">
                              <el-tooltip :content="getFeatureLabel(feature)" placement="top">
                                <el-icon class="hover:text-primary transition-colors" :size="14">
                                  <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                                  <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                                </el-icon>
                              </el-tooltip>
                            </template>
                          </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 mt-1">
                          <!-- 收藏按钮 -->
                          <el-icon 
                            class="favorite-icon cursor-pointer transition-all" 
                            :size="18"
                            @click.stop="toggleFavorite(model.id)"
                          >
                            <Star24Filled v-if="isModelFavorited(model.id)" class="text-yellow-500" />
                            <Star24Regular v-else class="text-gray-400 hover:text-yellow-500" />
                          </el-icon>
                          <!-- 选中标记 -->
                          <el-icon v-if="tempModelId === model.id" class="text-primary shrink-0" size="18">
                            <CheckCircleFilled />
                          </el-icon>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <div v-if="filteredModels.length === 0" class="text-center py-8 text-gray-400">
                <el-icon size="48" class="mb-2">
                  <SearchFilled />
                </el-icon>
                <p>未找到匹配的模型</p>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- 会话设置抽屉 -->
      <transition name="drawer-slide">
        <div v-if="settingsPanelVisible" 
             class="drawer-panel settings-drawer"
             @click.stop>
          <div class="drawer-header">
            <h3 class="drawer-title">会话设置</h3>
            <el-button text @click="closeAllPanels">
              <el-icon><CloseOutlined /></el-icon>
            </el-button>
          </div>
          <div class="drawer-content">
            <el-form label-position="top" size="large">
              <el-form-item label="上下文条数">
                <el-slider-optional v-model="tempMaxMemoryLength" :min="2" :max="500" :step="1" show-input
                  optional-direction="max" optional-text="No Limit" />
                <div class="text-xs text-gray-500 mt-2">
                  控制保留的历史消息条数，影响对话的连贯性和上下文理解能力
                </div>
              </el-form-item>
            </el-form>
            <div class="flex justify-end gap-3 mt-4">
              <el-button @click="closeAllPanels">取消</el-button>
              <el-button type="primary" @click="applySessionSettings">应用</el-button>
            </div>
          </div>
        </div>
      </transition>

      <!-- 知识库选择抽屉 -->
      <transition name="drawer-slide">
        <div v-if="kbPanelVisible" 
             class="drawer-panel kb-drawer"
             @click.stop>
          <div class="drawer-header">
            <h3 class="drawer-title">选择知识库</h3>
            <el-button text @click="closeAllPanels">
              <el-icon><CloseOutlined /></el-icon>
            </el-button>
          </div>
          <div class="drawer-content">
            <div class="mb-4">
              <el-input v-model="kbSearchText" placeholder="搜索知识库..." clearable>
                <template #prefix>
                  <el-icon>
                    <SearchFilled />
                  </el-icon>
                </template>
              </el-input>
            </div>
            <div class="kb-list-container max-h-80 overflow-y-auto">
              <div v-if="filteredKnowledgeBases.length === 0" class="text-center py-8 text-gray-400">
                <el-icon size="48" class="mb-2">
                  <SearchFilled />
                </el-icon>
                <p>未找到匹配的知识库</p>
              </div>
              <div v-else class="space-y-2">
                <div v-for="kb in filteredKnowledgeBases" :key="kb.id"
                  class="kb-item p-2.5 rounded-lg cursor-pointer border transition-all flex items-center gap-3" :class="{
                    'bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700': (props.config?.knowledgeBaseIds || []).includes(kb.id),
                    'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50': !(props.config?.knowledgeBaseIds || []).includes(kb.id)
                  }" @click="toggleKnowledgeBaseSelection(kb.id)">
                  <el-checkbox :model-value="(props.config?.knowledgeBaseIds || []).includes(kb.id)" @click.stop
                    @change="toggleKnowledgeBaseSelection(kb.id)" />
                  <div class="flex-1 min-w-0 flex items-center gap-2">
                    <div class="font-medium text-sm truncate flex-shrink">{{ kb.name }}</div>
                    <div v-if="kb.description" class="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">{{ kb.description }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 输入框区域 -->
    <div class="input-area p-[16px_12px_10px_12px] transition-all duration-300 min-h-15 w-full bg-white dark:bg-[#1e1e1e]"
      :class="styleClass">
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
        <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.displayName" :type="file.fileType"
          :ext="file.fileExtension" :size="file.fileSize" :preview-url="file.previewUrl" closable
          :upload-progress="file.uploadProgress" :upload-status="file.uploadStatus" @close="removeFile(file.id)">
        </FileItem>
      </div>

      <!-- 已选知识库标签显示区域 -->
      <div class="kb-list flex flex-wrap gap-2 mb-1.5 mx-1.5" v-if="selectedKnowledgeBases.length > 0">
        <el-tag v-for="kb in selectedKnowledgeBases" :key="kb.id" closable type="info"
          @close="removeKnowledgeBase(kb.id)" class="text-xs">
          <span class="flex items-center gap-1">
            <el-icon size="14">
              <MenuBookOutlined />
            </el-icon>
            {{ kb.name }}
          </span>
        </el-tag>
      </div>

      <textarea class="message-input" v-model="inputContent" placeholder="Enter发送, Shift+Enter换行"
        @keydown="handleKeydown" @input="adjustTextareaHeight" ref="messageInputRef" rows="1" @focus="handleFocus"
        @blur="handleBlur"></textarea>

      <!-- 隐藏的文件输入框 -->
      <input type="file" ref="fileInputRef" style="display: none" multiple
        :accept="getFileExtensionsFromType('TEXT').join(',')" @change="handleFileSelect">
      <input type="file" ref="imageInputRef" style="display: none" multiple
        :accept="getFileExtensionsFromType('IMAGE').join(',')" @change="handleImageSelect">
      <div class="input-actions w-full flex justify-between">
        <div class="tools left-tools flex gap-2 items-center">
          <slot name="buttons"></slot>
          <template v-if="showButtons.thinkingButton">
            <el-button round :type="localThinkingEnabled ? 'primary' : 'default'" plain @click="toggleDeepThinking"
              :icon="Thinking2">
              思考
            </el-button>
          </template>
          <!-- 知识库选择按钮 -->
          <el-button v-if="showButtons.knowledgeBaseButton" round plain @click.stop="openKnowledgeBasePanel"
            :icon="MenuBookOutlined">
            知识库
          </el-button>
        </div>
        <div class="right-actions">
          <!-- 模型选择按钮 -->
          <el-button @click.stop="openModelPanel" plain type="primary"
            class="model-selector-btn overflow-hidden flex items-center justify-center">
            <div class="flex items-center gap-1.5" style="height:24px">
              <OpenAI class="w-4 h-4 shrink-0 text-(--color-primary)" />
              <span class="whitespace-nowrap text-sm font-medium"
                :style="{ display: isMobile ? 'none' : 'inline-flex' }">{{
                  currentModelName }}</span>
              <el-icon class="text-xs opacity-60">
                <ArrowDropDownTwotone />
              </el-icon>
            </div>
          </el-button>
          <div class="tools right-tools">
            <!-- 会话设置按钮 -->
            <el-tooltip content="会话设置" placement="top">
              <el-button class="tool-btn" @click.stop="openSettingsPanel" text>
                <el-icon size="22">
                  <Settings24Regular />
                </el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="showButtons.filesButton" content="上传文件" placement="top">
              <el-button class="tool-btn" @click="triggerFileInput" text>
                <el-icon size="22">
                  <Attach24Regular />
                </el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="showButtons.imagesButton" content="添加图片" placement="top">
              <el-button class="tool-btn" @click="triggerImageInput" text>
                <el-icon size="22">
                  <Image24Regular />
                </el-icon>
              </el-button>
            </el-tooltip>
          </div>
          <div>
            <el-tooltip v-if="!streaming" content="发送" placement="top">
              <el-button class="send-btn" type="primary" @click="sendMessage" circle
                :disabled="!inputContent.trim() || !props.config?.modelId" :icon="Send24Filled" />
            </el-tooltip>
            <el-tooltip v-else content="停止生成" placement="top">
              <el-button class="send-btn stop-btn" @click="abortResponse" circle type="error" :icon="Stop24Filled">
              </el-button>
            </el-tooltip>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>


<script setup lang="ts">
// @ts-nocheck - ChatInput 组件复杂度高，临时使用@ts-nocheck
import { ref, watch, computed, nextTick, onUnmounted, onMounted, reactive } from 'vue'
import { ElIcon, ElButton, ElDialog, ElTabs, ElTabPane, ElInput, ElForm, ElFormItem, ElTag } from 'element-plus';
import FileItem from './FileItem.vue';
import { OpenAI } from "@/components/icons";
import {
  ArrowDropDownTwotone,
  SearchFilled,
  CheckCircleFilled,
  MenuBookOutlined,
  ArrowRightTwotone,
  CloseOutlined
} from "@vicons/material";
import { Thinking2 } from "@/components/icons";
import {
  TextT24Regular, LightbulbFilament24Regular, WrenchScrewdriver24Regular, Image24Regular, Attach24Regular,
  Send24Filled, Stop24Filled, Star24Regular, Star24Filled, Settings24Regular
} from '@vicons/fluent'
import { usePopup } from '@/composables/usePopup';
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import { apiService } from '@/services/ApiService';

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

const { confirm } = usePopup();

// 响应式数据
const isInputExpanded = ref(false);
const messageInputRef = ref(null);
const fileInputRef = ref(null);
const imageInputRef = ref(null);
let fileIdCounter = 0;
const focused = ref(false);
// 模型选择器相关
const modelDialogVisible = ref(false);
const modelSearchText = ref('');
const tempModelId = ref(null); // 临时选中的模型 ID
const tempFavoriteIds = ref<Set<string>>(new Set()); // 临时收藏的模型 ID 集合
const models = ref([]);
const providers = ref([]);
const sessionId = ref(null);
// 会话设置对话框相关
const settingsDialogVisible = ref(false);
const tempMaxMemoryLength = ref(null);
// 知识库选择器相关
const kbDialogVisible = ref(false);
const kbSearchText = ref('');
const knowledgeBases = ref<any[]>([]); // 知识库列表

// 抽屉面板状态
const modelPanelVisible = ref(false)
const settingsPanelVisible = ref(false)
const kbPanelVisible = ref(false)
const drawerContainerRef = ref<HTMLElement | null>(null)

// 计算是否有任意面板打开
const anyPanelVisible = computed(() => 
  modelPanelVisible.value || settingsPanelVisible.value || kbPanelVisible.value
)
// 常量定义
const FILE_TYPES = {
  TEXT: {
    extensions: [
      '.txt', '.md', '.js', '.ts', '.html', '.css', '.json', '.xml', '.csv', '.log',
      '.py', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.sql', '.sh',
      '.bat', '.yml', '.yaml', '.ini', '.conf', '.properties', '.vue', '.toml',
      '.env', '.cfg', '.config', '.reg', '.pem', '.tex', '.rst', '.adoc', '.org',
      '.swift', '.kt', '.scala', '.dart', '.ex', '.r', '.jl', '.ps1', '.vbs', '.fish',
      '.j2', '.ejs', '.hbs', '.lock', '.patch', '.diff', '.ics', '.vcf', '.srt',
      '.proto', '.graphql', '.sol', '.pdf',
      '.doc', '.docx',  // Word 文档
      '.dts', '.dtsi'   // 设备树源文件
    ],
    type: 'text'
  },
  IMAGE: {
    extensions: [
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico',
      '.tif', '.tiff', '.psd', '.ai', '.eps'
    ],
    type: 'image'
  }
};

const MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp',
  'image/svg+xml': 'svg', 'image/webp': 'webp', 'text/plain': 'txt', 'text/html': 'html',
  'text/css': 'css', 'application/javascript': 'js', 'application/json': 'json',
  'text/csv': 'csv', 'application/xml': 'xml'
};

// 配置
const showButtons = reactive({
  thinkingButton: false,
  webSearchButton: true,
  filesButton: true,
  imagesButton: true,
  tokensButton: true,
  knowledgeBaseButton: true, // 知识库选择按钮
});

const props = defineProps({
  value: { type: String, default: '' },
  files: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  webSearchEnabled: { type: Boolean, default: false },
  thinkingEnabled: { type: Boolean, default: false },
  shadow: { type: Boolean, default: true },
  buttons: { type: Object, default: () => [] },
  clean: { type: Boolean, default: false },
  border: { type: Boolean, default: true },
  round: { type: Boolean, default: true },
  class: { type: String, default: '' },
  sessionId: { type: [String, Number], default: null },
  config: {
    type: Object,
    default: () => ({
      modelId: null,
      maxMemoryLength: null,
      knowledgeBaseIds: [] // 新增：知识库 ID 列表
    })
  },
});

// 计算属性
const styleClass = computed(() => {
  const classes = [];
  if (isInputExpanded.value) {
    classes.push('expanded');
  }
  if (!props.clean) {
    if (props.round) classes.push('rounded-[22px]');
    if (focused.value) {
      if (props.shadow) classes.push('shadow-[0_2px_22px_rgba(0,0,0,0.21)]');
      if (props.border) classes.push('border border-gray-400 dark:border-gray-700');
    } else {
      if (props.shadow) classes.push('shadow-[0_2px_22px_rgba(0,0,0,0.11)]');
      if (props.border) classes.push('border border-gray-300 dark:border-gray-700');
    }
  }
  return classes.join(' ') + ' ' + props.class;
});

const localWebSearchEnabled = computed({
  get: () => props.webSearchEnabled,
  set: (value) => emit('update:webSearchEnabled', value)
});

const localThinkingEnabled = computed({
  get: () => props.thinkingEnabled,
  set: (value) => emit('update:thinkingEnabled', value)
});

const inputContent = computed({
  get: () => props.value,
  set: (value) => emit('update:value', value)
});

const uploadFiles = computed({
  get: () => props.files,
  set: (value) => emit('update:files', value)
});

// 当前选中的模型
const currentModel = computed(() => {
  if (props.config?.modelId) {
    const model = models.value.find(m => m.id === props.config.modelId);
    return model;
  }
  return null;
});

// 根据模型特性动态控制按钮显示
watch(() => currentModel.value?.config, (config) => {
  // 思考按钮：当模型支持 thinking 时显示
  showButtons.thinkingButton = config?.features?.includes('thinking') || false;
  // 图像按钮：始终显示，不再根据模型输入能力检查
}, { immediate: true });

const currentModelName = computed(() => {
  const model = currentModel.value;
  return model ? model.modelName.split("/").pop() : "请选择模型";
});

// 当前选中的知识库列表（根据 ID 从完整列表中过滤）
const selectedKnowledgeBases = computed(() => {
  const kbIds = props.config?.knowledgeBaseIds || [];
  return knowledgeBases.value.filter(kb => kbIds.includes(kb.id));
});

//  新增：有效的已选择知识库数量（只统计实际存在的知识库）
const selectedKnowledgeBasesCount = computed(() => {
  return selectedKnowledgeBases.value.length;
});

//  新增：本地存储中的知识库ID总数（包含已删除的无效ID）
const totalKnowledgeBasesCount = computed(() => {
  return props.config?.knowledgeBaseIds?.length || 0;
});



// 过滤后的知识库列表（支持搜索）
const filteredKnowledgeBases = computed(() => {
  if (!kbSearchText.value) return knowledgeBases.value;
  const searchText = kbSearchText.value.toLowerCase();
  return knowledgeBases.value.filter(kb =>
    kb.name?.toLowerCase().includes(searchText) ||
    kb.description?.toLowerCase().includes(searchText)
  );
});

const getFeatureLabel = (type) => {
  switch (type) {
    case 'tools': return '工具调用';
    case 'thinking': return '混合思考';
    default: return type;
  }
}

// 过滤后的模型列表（支持搜索）
const filteredModels = computed(() => {
  if (!modelSearchText.value) return models.value;
  const searchText = modelSearchText.value.toLowerCase();
  return models.value.filter(model =>
    model.modelName?.toLowerCase().includes(searchText) ||
    model.description?.toLowerCase().includes(searchText)
  );
});

// 按供应商分组的过滤后模型列表
const filteredProviders = computed(() => {
  if (!models.value.length || !providers.value.length) return [];

  const filtered = filteredModels.value;
  
  // 分离收藏和未收藏的模型
  const favoritedModels = filtered.filter((model: any) => tempFavoriteIds.value.has(model.id));
  
  const result = [];
  
  // 如果有收藏的模型,按供应商分组添加到"收藏"大分组
  if (favoritedModels.length > 0) {
    // 按供应商ID分组收藏的模型
    const favoritedByProvider: Record<string, any[]> = {};
    favoritedModels.forEach((model: any) => {
      if (!favoritedByProvider[model.providerId]) {
        favoritedByProvider[model.providerId] = [];
      }
      favoritedByProvider[model.providerId].push(model);
    });
    
    // 为每个有收藏模型的供应商创建子分组
    Object.entries(favoritedByProvider).forEach(([providerId, models]) => {
      const provider = providers.value.find((p: any) => p.id === providerId);
      if (provider && models.length > 0) {
        result.push({
          id: `fav-${providerId}`,
          name: `${provider.name} (收藏)`,
          models: models,
          isFavoriteGroup: true
        });
      }
    });
  }
  
  // 所有模型都按供应商分组显示(包括收藏的)
  const providerGroups = providers.value.map(provider => ({
    ...provider,
    models: filtered.filter((model: any) => model.providerId === provider.id),
    isFavoriteGroup: false
  })).filter((provider: any) => provider.models.length > 0);
  
  result.push(...providerGroups);
  
  return result;
});

// 获取指定供应商的模型列表
const getProviderModels = (providerId) => {
  const provider = filteredProviders.value.find(p => p.id === providerId);
  return provider ? provider.models : [];
};

const emit = defineEmits([
  'update:value', 'update:webSearchEnabled', 'update:thinkingEnabled',
  'send', 'abort', 'tokens-statistic', 'files-change',
  'toggle-web-search', 'toggle-thinking', 'focus', 'blur',
  'update:modelId', 'config-change', 'update:knowledgeBaseIds'
]);

// 工具函数
const getFileExtension = (fileName) => {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).toUpperCase() : 'FILE';
};

const getFileNameWithoutExtension = (fileName) => {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
};

const getFileExtensionFromType = (mimeType) => {
  return MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'file';
};

const isFileType = (file, fileType) => {
  const fileName = file.name.toLowerCase();
  return FILE_TYPES[fileType].extensions.some(ext => fileName.endsWith(ext));
};

const getFileExtensionsFromType = (type) => {
  return FILE_TYPES[type].extensions;
}

const createFileObject = (file, fileType, isPasted = false) => {
  const isImage = fileType === 'IMAGE';
  const previewUrl = isImage ? URL.createObjectURL(file) : '';
  const timestamp = Date.now();

  return {
    id: fileIdCounter++,
    fileName: file.name || `pasted-${fileType.toLowerCase()}-${timestamp}.${getFileExtensionFromType(file.type)}`,
    fileSize: file.size,
    fileExtension: isPasted ? getFileExtensionFromType(file.type) : getFileExtension(file.name),
    fileType: FILE_TYPES[fileType].type,
    displayName: file.name ? getFileNameWithoutExtension(file.name) : `pasted-${fileType.toLowerCase()}-${timestamp}`,
    file: file,
    previewUrl: previewUrl,
    // 新增：上传进度状态
    uploadProgress: 0,
    uploadStatus: null, // 'queued' | 'uploading' | 'uploaded' | 'failed'
  };
};

const revokeImagePreviewUrl = (file) => {
  if (file?.fileType === 'image' && file.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(file.previewUrl);
    file.previewUrl = null;
  }
};

// 打开模型面板
const openModelPanel = () => {
  // 如果面板已经打开，则关闭它（实现切换效果）
  if (modelPanelVisible.value) {
    closeAllPanels()
    return
  }
  
  closeAllPanels() // 先关闭其他面板
  modelSearchText.value = ''
  // 初始化临时值为当前值
  tempModelId.value = props.config?.modelId || null
  
  // 初始化临时收藏状态
  tempFavoriteIds.value = new Set(
    models.value.filter((m: any) => m.isFavorite).map((m: any) => m.id)
  )
  
  modelPanelVisible.value = true
};

// 选择模型并立即关闭面板
const selectAndCloseModel = (modelId: string) => {
  // 构建配置变更对象
  const configChanges = {
    modelId: modelId
  };
  
  console.log('Applying model selection:', configChanges);
  emit('config-change', configChanges);
  
  closeAllPanels()
};

// 检查模型是否被收藏
const isModelFavorited = (modelId: string) => {
  return tempFavoriteIds.value.has(modelId);
};

// 切换收藏状态
const toggleFavorite = async (modelId: string) => {
  try {
    await apiService.toggleModelFavorite(modelId);
    
    // 只更新临时状态,不重新加载列表
    if (tempFavoriteIds.value.has(modelId)) {
      tempFavoriteIds.value.delete(modelId);
    } else {
      tempFavoriteIds.value.add(modelId);
    }
  } catch (error) {
    console.error('切换收藏状态失败:', error);
    ElMessage.error('操作失败');
  }
};

// 重新加载模型列表
const reloadModels = async () => {
  models.value = [];
  providers.value = [];
  await loadModels();
};

// 打开会话设置面板
const openSettingsPanel = () => {
  // 如果面板已经打开，则关闭它（实现切换效果）
  if (settingsPanelVisible.value) {
    closeAllPanels()
    return
  }
  
  closeAllPanels()
  tempMaxMemoryLength.value = props.config?.maxMemoryLength || null
  settingsPanelVisible.value = true
};

// 应用会话设置
const applySessionSettings = () => {
  // 构建配置变更对象
  const configChanges = {};

  // 检查上下文条数是否有变化
  if (tempMaxMemoryLength.value !== props.config?.maxMemoryLength && tempMaxMemoryLength.value !== null) {
    configChanges.maxMemoryLength = tempMaxMemoryLength.value;
  }

  // 只有当有配置变更时才发送事件
  if (Object.keys(configChanges).length > 0) {
    console.log('Applying session settings:', configChanges);
    emit('config-change', configChanges);
  }

  closeAllPanels()
};

// 打开知识库面板
const openKnowledgeBasePanel = async () => {
  // 如果面板已经打开，则关闭它（实现切换效果）
  if (kbPanelVisible.value) {
    closeAllPanels()
    return
  }
  
  closeAllPanels()
  kbSearchText.value = ''
  // 重新加载知识库列表，确保数据是最新的
  try {
    await loadKnowledgeBases();
  } catch (error) {
    console.error('加载知识库列表失败:', error);
  }
  kbPanelVisible.value = true
};

// 切换知识库选中状态 - 立即同步到父组件
const toggleKnowledgeBaseSelection = (kbId: string) => {
  const currentKbIds = props.config?.knowledgeBaseIds || [];
  const newKbIds = [...currentKbIds];
  const index = newKbIds.indexOf(kbId);
  
  if (index === -1) {
    // 添加知识库
    newKbIds.push(kbId);
  } else {
    // 移除知识库
    newKbIds.splice(index, 1);
  }
  
  // 立即触发配置变更事件
  emit('config-change', { knowledgeBaseIds: newKbIds });
};



// 移除单个知识库
const removeKnowledgeBase = (kbId: string) => {
  const currentKbIds = props.config?.knowledgeBaseIds || [];
  const newKbIds = currentKbIds.filter(id => id !== kbId);

  //  修复：同时触发两个事件
  emit('update:knowledgeBaseIds', newKbIds);  // 更新本地状态
  emit('config-change', { knowledgeBaseIds: newKbIds });  // 通知父组件保存配置
};

// 关闭所有面板
const closeAllPanels = () => {
  modelPanelVisible.value = false
  settingsPanelVisible.value = false
  kbPanelVisible.value = false
}

// 加载模型列表
const loadModels = async () => {
  try {
    const response = await apiService.fetchModels();
    response.items.forEach(provider => {
      // 过滤只保留 mode_type 为 'text' 的模型
      const textModels = provider.models.filter(model => model.modelType === "text");
      models.value.push(...textModels);
      delete provider.models;
      // 只有当该供应商有符合条件的模型时才加入列表
      if (textModels.length > 0) {
        providers.value.push(provider);
      }
    });
    if (models.value.length > 0 && !props.modelId) {
      // 如果没有传入 modelId，默认选择第一个
      emit('update:modelId', models.value[0].id);
    }
  } catch (error) {
    console.error('获取模型列表失败:', error);
  }
};

// 加载知识库列表
const loadKnowledgeBases = async () => {
  try {
    const response = await apiService.fetchKnowledgeBases();
    knowledgeBases.value = response.items || [];

    //  新增：自动清理本地存储中的无效知识库ID
    const localKbIds = props.config?.knowledgeBaseIds || [];
    if (localKbIds.length > 0 && knowledgeBases.value.length > 0) {
      // 过滤出有效的知识库ID
      const validKbIds = localKbIds.filter(id =>
        knowledgeBases.value.some(kb => kb.id === id)
      );

      // 如果本地存储中有无效的ID，自动清理它们
      if (validKbIds.length !== localKbIds.length) {
        console.log(' 自动清理无效知识库ID', {
          原数量: localKbIds.length,
          有效数量: validKbIds.length,
          清理数量: localKbIds.length - validKbIds.length
        });

        // 通知父组件更新配置，清除无效的知识库ID
        emit('config-change', { knowledgeBaseIds: validKbIds });
      }
    }
  } catch (error) {
    console.error('获取知识库列表失败:', error);
  }
};

// 文件处理函数
const checkFileConflict = async (newFileType) => {
  const currentFileType = uploadFiles.value[0]?.fileType;
  const conflictType = newFileType === 'image' ? '文件' : '图片';

  if (currentFileType && currentFileType !== newFileType) {
    const confirmed = await confirm(`覆盖${conflictType}`, `暂不支持同时上传图片和文件，是否要覆盖全部${conflictType}？`);
    if (!confirmed) return false;

    uploadFiles.value.forEach(revokeImagePreviewUrl);
    uploadFiles.value = [];
  }
  return true;
};

const processFiles = async (files, fileType) => {
  if (files.length === 0) return;

  const normalizedFileType = fileType.toUpperCase();
  if (!(await checkFileConflict(FILE_TYPES[normalizedFileType].type))) return;

  for (const file of files) {
    if (isFileType(file, normalizedFileType)) {
      const fileObj = createFileObject(file, normalizedFileType);

      // 如果当前有 sessionId，立即开始上传并跟踪进度
      if (sessionId.value) {
        try {
          const { useFileUploadStore } = await import('@/stores/fileUpload');
          const uploadStore = useFileUploadStore();

          // 标记为排队中
          fileObj.uploadStatus = 'queued';
          uploadFiles.value.push(fileObj);

          // 异步上传，不阻塞用户操作
          uploadToSessionWithProgress(fileObj, sessionId.value, uploadStore);
        } catch (error) {
          console.error('初始化文件上传失败:', error);
          fileObj.uploadStatus = 'failed';
          uploadFiles.value.push(fileObj);
        }
      } else {
        // 没有 sessionId，直接添加（稍后在发送消息时上传）
        uploadFiles.value.push(fileObj);
      }
    }
  }
};

// 事件处理函数
const handleFileSelect = (event) => {
  processFiles(Array.from(event.target.files), 'TEXT');
  event.target.value = '';
};

const handleImageSelect = (event) => {
  processFiles(Array.from(event.target.files), 'IMAGE');
  event.target.value = '';
};

const handlePaste = async (event) => {
  const clipboardData = event.clipboardData;
  if (!clipboardData?.items) return;

  // 立即阻止默认粘贴行为，避免浏览器自动插入内容
  event.preventDefault();

  const items = Array.from(clipboardData.items);
  let pastedText = '';
  const filesToProcess = [];

  // 提取所有文件项（包括可能的图片）
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) filesToProcess.push(file);
    }
  }

  // 提取文本内容（异步）
  const textItem = items.find(item => item.kind === 'string' && item.type.startsWith('text/'));
  if (textItem) {
    pastedText = await new Promise((resolve) => {
      textItem.getAsString(resolve);
    });
  }

  // Step 3: 判断文本长度并决定如何处理
  const MAX_TEXT_LENGTH = 1000;
  if (pastedText && pastedText.length > MAX_TEXT_LENGTH) {
    // 超长文本 → 转为 .txt 文件
    const blob = new Blob([pastedText], { type: 'text/plain' });
    const file = new File([blob], `pasted_text_${Date.now()}.txt`, { type: 'text/plain' });
    filesToProcess.push(file);
  } else if (pastedText) {
    // 短文本 → 手动插入到 textarea，保留光标位置
    const textarea = messageInputRef.value;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = inputContent.value || '';
      const newValue = currentValue.slice(0, start) + pastedText + currentValue.slice(end);

      // 更新绑定值
      inputContent.value = newValue;

      // 恢复光标位置（需 nextTick 确保 DOM 已更新）
      nextTick(() => {
        textarea.setSelectionRange(start + pastedText.length, start + pastedText.length);
        textarea.focus();
      });
    }
  }

  // 处理文件（优先图片，否则文本类文件）
  if (filesToProcess.length > 0) {
    const imageFiles = filesToProcess.filter(file => isFileType(file, 'IMAGE'));
    const textFiles = filesToProcess.filter(file => isFileType(file, 'TEXT'));

    if (imageFiles.length > 0) {
      await processFiles(imageFiles, 'IMAGE');
    } else if (textFiles.length > 0) {
      await processFiles(textFiles, 'TEXT');
    }
    // TODO：如果既不是图片也不是支持的文本类型，会被忽略（可选加提示）
  }
};

// 带进度反馈的会话文件上传
async function uploadToSessionWithProgress(fileObj, sessionId, uploadStore) {
  try {
    const task = await uploadStore.uploadToSession(
      sessionId,
      fileObj.file,
      (status) => {
        // 更新文件对象的上传状态
        fileObj.uploadProgress = status.progress;
        fileObj.uploadStatus = status.status;
      }
    );

    // 上传完成后更新文件 ID
    if (task.fileId && task.fileId !== 'pending') {
      fileObj.id = task.fileId;
      fileObj.uploadStatus = 'uploaded';
    }
  } catch (error) {
    console.error('文件上传失败:', error);
    fileObj.uploadStatus = 'failed';
  }
}

const removeFile = (fileId) => {
  const index = uploadFiles.value.findIndex(file => file.id === fileId);
  if (index !== -1) {
    revokeImagePreviewUrl(uploadFiles.value[index]);
    uploadFiles.value.splice(index, 1);
  }
};

// UI 交互函数
const triggerFileInput = () => fileInputRef.value.click();
const triggerImageInput = () => imageInputRef.value.click();

const sendMessage = async () => {
  if (!inputContent.value.trim() && uploadFiles.value.length === 0) {
    return;
  }

  // 检查是否有文件正在上传
  const uploadingFiles = uploadFiles.value.filter(f =>
    f.uploadStatus === 'uploading' || f.uploadStatus === 'queued'
  );

  if (uploadingFiles.length > 0) {
    // 弹窗提醒用户选择
    const shouldWait = await showUploadWaitingDialog(uploadingFiles.length);

    if (shouldWait) {
      // 用户选择继续等待,仅关闭弹窗,不执行发送
      // 用户观察上传完成后再次点击发送按钮即可
      return;
    }
    // 用户选择直接发送或关闭弹窗,继续执行下面的发送逻辑
  }

  // 过滤出已上传完成的文件(包括没有上传状态的文件)
  const uploadedFiles = uploadFiles.value.filter(f =>
    f.uploadStatus === 'uploaded' || !f.uploadStatus
  );

  // 发送消息(仅包含已上传完成的文件)
  emit('send', {
    content: inputContent.value,
    files: uploadedFiles,
    knowledgeBaseIds: props.config?.knowledgeBaseIds || []
  });
};

// 显示上传等待对话框
async function showUploadWaitingDialog(uploadingCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    // 使用 Element Plus 的 MessageBox
    import('element-plus').then(({ ElMessageBox }) => {
      ElMessageBox.confirm(
        `当前有 ${uploadingCount} 个文件正在上传中，您可以选择等待上传完成或直接发送消息（仅发送已完成的文件）。`,
        '文件上传中',
        {
          confirmButtonText: '继续等待',
          cancelButtonText: '直接发送',
          type: 'warning',
          distinguishCancelAndClose: true,
          closeOnClickModal: false,
        }
      )
        .then(() => {
          resolve(true); // 用户点击"继续等待"
        })
        .catch(() => {
          resolve(false); // 用户点击"直接发送"或关闭弹窗
        });
    });
  });
}

const handleKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};

const adjustTextareaHeight = () => {
  const textarea = messageInputRef.value;
  if (!textarea) return;

  textarea.style.height = "auto";
  let height = Math.min(textarea.scrollHeight, 240);
  if (height < 45) height = 45;
  textarea.style.height = height + "px";
  isInputExpanded.value = textarea.scrollHeight > 60;
};

const handleWebSearch = () => {
  localWebSearchEnabled.value = !localWebSearchEnabled.value;
  emit('toggle-web-search')
}

const handleTokensStatistic = () => {
  emit('tokens-statistic')
}

const abortResponse = () => {
  emit('abort')
}

const toggleDeepThinking = () => {
  localThinkingEnabled.value = !localThinkingEnabled.value;
  emit('toggle-thinking')
}

const handleFocus = () => {
  focused.value = true;
  emit('focus');
};

const handleBlur = () => {
  focused.value = false;
  emit('blur');
};

// Esc 键关闭面板
const handleEscKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && anyPanelVisible.value) {
    closeAllPanels()
  }
}

// 全局点击关闭面板
const handleGlobalClick = (e: MouseEvent) => {
  if (!anyPanelVisible.value) return
  
  const target = e.target as HTMLElement
  const drawerContainer = drawerContainerRef.value
  
  // 如果点击的是抽屉容器内部，不关闭
  if (drawerContainer && drawerContainer.contains(target)) {
    return
  }
  
  // 否则关闭所有面板
  closeAllPanels()
}

// 生命周期和监听器
watch(() => props.config?.modelId, async () => {
  await nextTick();
  // 移除按钮宽度更新逻辑
}, { immediate: true });

watch(() => props.sessionId, (newSessionId) => {
  sessionId.value = newSessionId;
}, { immediate: true });

watch(() => props.buttons, (value) => {
  // 外部传入的按钮配置只影响非模型特性控制的按钮
  Object.keys(showButtons).forEach(key => {
    // thinkingButton 和 imagesButton 由模型特性控制，不受外部 props 影响
    if (key !== 'thinkingButton' && key !== 'imagesButton' && key in value) {
      showButtons[key] = value[key];
    }
  });
}, { immediate: true });

watch(() => props.files, (newFiles, oldFiles) => {
  oldFiles?.forEach(oldFile => {
    if (!newFiles.some(newFile => newFile.id === oldFile.id)) {
      revokeImagePreviewUrl(oldFile);
    }
  });
}, { deep: true });

watch(inputContent, () => {
  nextTick(adjustTextareaHeight);
}, { immediate: true });

onMounted(() => {
  document.addEventListener('paste', handlePaste);
  document.addEventListener('keydown', handleEscKey); // 新增 Esc 键监听
  document.addEventListener('click', handleGlobalClick); // 新增全局点击监听
  adjustTextareaHeight();
  loadModels();
  loadKnowledgeBases(); // 加载知识库列表
});

// 清理事件监听器
onUnmounted(() => {
  document.removeEventListener('paste', handlePaste);
  document.removeEventListener('keydown', handleEscKey); // 清理 Esc 键监听
  document.removeEventListener('click', handleGlobalClick); // 清理全局点击监听
  uploadFiles.value.forEach(revokeImagePreviewUrl);
});
</script>
<style scoped>
/* 抽屉容器基础样式 */
.drawer-container {
  position: relative;
  width: 100%; /* 恢复全宽 */
}

/* 抽屉面板通用样式 */
.drawer-panel {
  position: absolute;
  bottom: 100%; /* 从容器顶部开始（输入框上方） */
  left: 1px; /* 左右各收窄1像素 */
  right: 1px;
  max-height: 400px; /* 限制最大高度 */
  background: #f5f5f5; /* 浅灰色背景 */
  border-radius: 12px 12px 0 0; /* 仅上方有圆角，下方无圆角 */
  border: 1px solid #e0e0e0; /* 添加外边框 */
  border-bottom: none; /* 底部无边框，与输入框融合 */
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin-bottom: -16px; /* 负边距，让抽屉延伸到输入框圆角外 */
  z-index: 1; /* 降低层级，让输入框遮挡抽屉 */
}

.dark .drawer-panel {
  background: #2a2a2a; /* 深色模式使用深灰色 */
  border: 1px solid #404040; /* 深色模式边框 */
  border-bottom: none;
}

/* 抽屉头部样式 */
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  /* border-bottom: 1px solid var(--el-border-color-light, #e4e7ed); */ /* 取消底部边框，更紧凑 */
  flex-shrink: 0;
}

.drawer-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
}

.dark .drawer-title {
  color: var(--el-text-color-primary, #e5eaf3);
}

/* 抽屉内容区域样式 */
.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 40px 16px; /* 增加底部内边距，确保最后一个item不被遮挡 */
}

/* 自定义滚动条 */
.drawer-content::-webkit-scrollbar {
  width: 6px;
}

.drawer-content::-webkit-scrollbar-thumb {
  background: var(--el-border-color, #dcdfe6);
  border-radius: 3px;
}

.drawer-content::-webkit-scrollbar-thumb:hover {
  background: var(--el-border-color-dark, #c0c4cc);
}

/* 抽屉滑入动画 */
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-slide-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.drawer-slide-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}



/* 移动端适配 */
@media (max-width: 768px) {
  .drawer-panel {
    max-height: 60vh; /* 移动端使用视口高度比例 */
  }
  
  .drawer-content {
    max-height: calc(60vh - 60px);
  }
}

/* 输入框区域样式 */
.input-area {
  position: relative;
  z-index: 10; /* 高于抽屉，确保输入框遮挡抽屉 */
}

.message-input {
  width: 100%;
  height: auto;
  border: none;
  resize: none;
  outline: none;
  font-size: var(--size-text-base);
  line-height: 1.8;
  padding: 0 8px;
  background: transparent;
  /* color: #333; */
  overflow-y: auto;
  margin-bottom: 10px;
  box-sizing: border-box;
  transition: height 0.2s ease;
  min-height: 45px;
}


.left-tools {
  display: flex;
  align-items: center;
}

:deep(.left-tools .el-button--primary.is-plain) {
  --el-button-hover-bg-color: var(--el-color-primary-light-8) !important;
  --el-button-hover-text-color: var(--el-color-primary) !important;
  --el-button-active-bg-color: var(--el-color-primary-light-7) !important;
}

:deep(.el-button+.el-button) {
  margin-left: 0;
}

.right-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.right-tools {
  display: flex;
  align-items: center;
}


.tool-btn {
  color: #888;
  cursor: pointer;
  font-size: 14px;
  height: 28px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}


.right-tools .tool-btn {
  padding: 0 5px;
}

/* 深度思考按钮激活状态样式 */
.tool-btn.active {
  border-color: var(--color-primary);
  background-color: var(--color-primary-0f);
  color: var(--color-primary);
}

/* 模型选择器按钮样式 */
.model-selector-btn {
  transition: all 0.3s ease-in-out;
  overflow: hidden;
  height: 32px;
  padding: 6px 12px;
  border-color: transparent;
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-selector-btn:hover {
  background-color: var(--el-color-primary-light-9);
  border-color: transparent;
  color: var(--el-color-primary);
}

.model-selector-btn:active {
  background-color: var(--el-color-primary-light-8);
}

/* 模型选择器对话框样式 */
:deep(.model-item) {
  transition: all 0.2s;
}

:deep(.model-item:hover) {
  border-color: var(--el-color-primary-light-5);
}

/* 收藏按钮悬停效果 */
:deep(.model-item .el-icon.cursor-pointer) {
  transition: all 0.2s ease;
}

:deep(.model-item .el-icon.cursor-pointer:hover) {
  transform: scale(1.1);
}

/* 收藏图标颜色强制应用 */
:deep(.favorite-icon svg) {
  fill: currentColor !important;
}

:deep(.favorite-icon .text-yellow-500) {
  color: #f59e0b !important;
}

:deep(.favorite-icon .text-gray-400) {
  color: #9ca3af !important;
}

:deep(.provider-group) {
  margin-bottom: 1rem;
}

:deep(.provider-name) {
  color: var(--el-text-color-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

/* 收藏分组特殊样式 */
:deep(.provider-group .provider-name) {
  transition: color 0.2s;
}

:deep(.provider-group:first-child .provider-name) {
  color: #f59e0b;
  font-weight: 600;
}

/* 移动端特性标签隐藏 */
@media (max-width: 768px) {
  :deep(.model-item .el-tag) {
    display: none;
  }
}

/* 移动端适配 */
@media (max-width: 768px) {
  .model-selector-btn {
    display: none !important;
  }
}

/* 知识库选择对话框样式 */
:deep(.kb-item) {
  transition: all 0.2s;
}

:deep(.kb-item:hover) {
  border-color: var(--el-color-primary-light-5);
}

.kb-list-container {
  padding: 0 2px;
}
</style>