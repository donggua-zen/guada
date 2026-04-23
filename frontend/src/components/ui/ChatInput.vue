<template>
  <div class="w-full flex flex-col items-center">
    <div class="p-[16px_12px_10px_12px] transition-all duration-300 min-h-15 w-full bg-white dark:bg-[#1e1e1e]"
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
            <el-button  round :type="localThinkingEnabled ? 'primary' : 'default'" plain
              @click="toggleDeepThinking" :icon="Thinking2">
              思考
            </el-button>
          </template>
          <!-- 知识库选择按钮 -->
          <el-button v-if="showButtons.knowledgeBaseButton" round plain @click="openKnowledgeBaseDialog"
            :icon="MenuBookOutlined" >
            知识库
          </el-button>
        </div>
        <div class="right-actions">
          <!-- 模型选择按钮 -->
          <el-button @click="openModelDialog" plain type="primary"
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
            <el-button v-if="showButtons.filesButton" class="tool-btn" title="上传文件" @click="triggerFileInput" text>
              <el-icon size="22">
                <Attach24Regular />
              </el-icon>
            </el-button>
            <el-button v-if="showButtons.imagesButton" class="tool-btn" title="添加图片" @click="triggerImageInput" text>
              <el-icon size="22">
                <Image24Regular />
              </el-icon>
            </el-button>
          </div>
          <div>
            <el-button v-if="!streaming" class="send-btn" type="primary" title="发送" @click="sendMessage" circle
              :disabled="!inputContent.trim() || !props.config?.modelId" :icon="ArrowSend" />
            <el-button v-else class="send-btn stop-btn" title="停止生成" @click="abortResponse" circle type="error"
              :icon="Stop">
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 模型选择对话框 -->
  <el-dialog v-model="modelDialogVisible" title="模型设置" :width="isMobile ? '90%' : '600px'" :append-to-body="true"
    destroy-on-close>
    <el-tabs v-model="modelDialogTab">
      <!-- 模型选择标签页 -->
      <el-tab-pane name="model" label="模型选择">
        <div class="mb-4">
          <el-input v-model="modelSearchText" placeholder="搜索模型..." clearable>
            <template #prefix>
              <el-icon>
                <SearchFilled />
              </el-icon>
            </template>
          </el-input>
        </div>
        <div class="model-list max-h-80 overflow-y-auto">
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
                  }" @click="selectModel(model.id)">
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
                    <el-icon v-if="tempModelId === model.id" class="text-primary shrink-0 mt-1" size="18">
                      <CheckCircleFilled />
                    </el-icon>
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
      </el-tab-pane>

      <!-- 高级设置标签页 -->
      <el-tab-pane name="advanced" label="高级设置">
        <el-form label-position="top" size="large">
          <el-form-item label="上下文条数">
            <el-slider-optional v-model="tempMaxMemoryLength" :min="2" :max="500" :step="1" show-input
              optional-direction="max" optional-text="No Limit" />
            <div class="text-xs text-gray-500 mt-2">
              控制保留的历史消息条数，影响对话的连贯性和上下文理解能力
            </div>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <div class="flex justify-end gap-3">
        <el-button @click="modelDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="applyModelSettings">应用</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 知识库选择对话框 -->
  <el-dialog v-model="kbDialogVisible" title="选择知识库" :width="isMobile ? '90%' : '600px'" :append-to-body="true"
    destroy-on-close>
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
          class="kb-item p-3 rounded-lg cursor-pointer border transition-all flex items-start gap-3" :class="{
            'bg-blue-50 border-blue-300': tempKnowledgeBaseIds.includes(kb.id),
            'border-gray-200 hover:bg-gray-50': !tempKnowledgeBaseIds.includes(kb.id)
          }" @click="toggleKnowledgeBaseSelection(kb.id)">
          <el-checkbox :model-value="tempKnowledgeBaseIds.includes(kb.id)" @click.stop
            @change="toggleKnowledgeBaseSelection(kb.id)" />
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm mb-1">{{ kb.name }}</div>
            <div v-if="kb.description" class="text-xs text-gray-500 truncate">{{ kb.description }}</div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="tempKnowledgeBaseIds.length > 0" class="mt-4 text-sm text-gray-600">
      <div class="flex items-center gap-2">
        <span>已选择 <span class="font-medium text-blue-600">{{ tempValidKnowledgeBasesCount }}</span> 个知识库</span>
        <!-- <template v-if="tempKnowledgeBaseIds.length !== tempValidKnowledgeBasesCount">
          <span class="text-gray-400">•</span>
          <span class="text-xs text-gray-500">
            （<span class="text-orange-600">{{ tempKnowledgeBaseIds.length - tempValidKnowledgeBasesCount
            }}</span> 个无效ID将被自动清理）
          </span>
        </template> -->
      </div>
      <!-- <div v-if="tempKnowledgeBaseIds.length !== tempValidKnowledgeBasesCount" class="mt-1 text-xs text-gray-500">
        注：无效的知识库ID指那些已被删除或不存在的知识库
      </div> -->
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <el-button @click="kbDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="applyKnowledgeBaseSelection">应用</el-button>
      </div>
    </template>
  </el-dialog>
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
  ArrowRightTwotone
} from "@vicons/material";
import { Thinking2, ArrowSend, Stop } from "@/components/icons";
import {
  TextT24Regular, LightbulbFilament24Regular, WrenchScrewdriver24Regular, Image24Regular, Attach24Regular
} from '@vicons/fluent'
import { usePopup } from '@/composables/usePopup';
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

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
const modelDialogTab = ref('model');
const modelSearchText = ref('');
const tempMaxMemoryLength = ref(null);
const tempModelId = ref(null); // 临时选中的模型 ID
const models = ref([]);
const providers = ref([]);
const sessionId = ref(null);
// 知识库选择器相关
const kbDialogVisible = ref(false);
const kbSearchText = ref('');
const tempKnowledgeBaseIds = ref<string[]>([]); // 临时选中的知识库 ID 列表
const knowledgeBases = ref<any[]>([]); // 知识库列表
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
  imagesButton: false,
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
      if (props.shadow) classes.push('shadow-[0_2px_32px_rgba(0,0,0,0.11)]');
      if (props.border) classes.push('border border-gray-300 dark:border-gray-700');
    } else {
      if (props.border) classes.push('border border-gray-400 dark:border-gray-700');
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
  // 图像按钮：当模型输入能力支持 image 时显示
  showButtons.imagesButton = config?.inputCapabilities?.includes('image') || false;
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

//  新增：临时选择的有效知识库数量（用于对话框显示）
const tempValidKnowledgeBasesCount = computed(() => {
  if (!tempKnowledgeBaseIds.value.length) return 0;
  // 从所有知识库中过滤出临时选择的且实际存在的知识库
  return knowledgeBases.value.filter(kb =>
    tempKnowledgeBaseIds.value.includes(kb.id)
  ).length;
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
  return providers.value.map(provider => ({
    ...provider,
    models: filtered.filter(model => model.providerId === provider.id)
  })).filter(provider => provider.models.length > 0);
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

// 打开模型对话框
const openModelDialog = () => {
  modelDialogTab.value = 'model';
  modelSearchText.value = '';
  // 初始化临时值为当前值
  tempModelId.value = props.config?.modelId || null;
  tempMaxMemoryLength.value = props.config?.maxMemoryLength || null;
  modelDialogVisible.value = true;
};

// 选择模型（仅更新临时状态，不关闭对话框）
const selectModel = (modelId) => {
  tempModelId.value = modelId;
};

// 应用模型设置
const applyModelSettings = () => {
  // 构建配置变更对象
  const configChanges = {};

  // 检查模型 ID 是否有变化
  if (tempModelId.value !== props.config?.modelId) {
    configChanges.modelId = tempModelId.value;
  }

  // 检查上下文条数是否有变化
  if (tempMaxMemoryLength.value !== props.config?.maxMemoryLength && tempMaxMemoryLength.value !== null) {
    configChanges.maxMemoryLength = tempMaxMemoryLength.value;
  }

  // 只有当有配置变更时才发送事件
  if (Object.keys(configChanges).length > 0) {
    console.log('Applying model settings:', configChanges);
    emit('config-change', configChanges);
  }

  modelDialogVisible.value = false;
};

// 打开知识库对话框
const openKnowledgeBaseDialog = async () => {
  kbSearchText.value = '';
  // 重新加载知识库列表，确保数据是最新的
  try {
    await loadKnowledgeBases();
  } catch (error) {
    console.error('加载知识库列表失败:', error);
  }
  // 初始化临时值为当前值
  tempKnowledgeBaseIds.value = [...(props.config?.knowledgeBaseIds || [])];
  kbDialogVisible.value = true;
};

// 切换知识库选中状态
const toggleKnowledgeBaseSelection = (kbId: string) => {
  const index = tempKnowledgeBaseIds.value.indexOf(kbId);
  if (index === -1) {
    tempKnowledgeBaseIds.value.push(kbId);
  } else {
    tempKnowledgeBaseIds.value.splice(index, 1);
  }
};

// 应用知识库选择
const applyKnowledgeBaseSelection = () => {
  // 构建配置变更对象
  const configChanges = {};

  //  改进：过滤掉无效的知识库ID（那些在实际知识库列表中不存在的ID）
  const validTempKbIds = tempKnowledgeBaseIds.value.filter(id =>
    knowledgeBases.value.some(kb => kb.id === id)
  );

  // 检查知识库 ID 列表是否有变化
  const currentKbIds = props.config?.knowledgeBaseIds || [];
  if (JSON.stringify(validTempKbIds.sort()) !== JSON.stringify(currentKbIds.sort())) {
    configChanges.knowledgeBaseIds = validTempKbIds;
  }

  // 只有当有配置变更时才发送事件
  if (Object.keys(configChanges).length > 0) {
    console.log(' 应用知识库选择:', {
      临时选择: tempKnowledgeBaseIds.value,
      有效选择: validTempKbIds,
      当前选择: currentKbIds,
      变更: configChanges
    });
    emit('config-change', configChanges);
  }

  kbDialogVisible.value = false;
};

// 移除单个知识库
const removeKnowledgeBase = (kbId: string) => {
  const currentKbIds = props.config?.knowledgeBaseIds || [];
  const newKbIds = currentKbIds.filter(id => id !== kbId);

  //  修复：同时触发两个事件
  emit('update:knowledgeBaseIds', newKbIds);  // 更新本地状态
  emit('config-change', { knowledgeBaseIds: newKbIds });  // 通知父组件保存配置
};

// 加载模型列表
const loadModels = async () => {
  try {
    const { apiService } = await import('@/services/ApiService');
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
    const { apiService } = await import('@/services/ApiService');
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
  adjustTextareaHeight();
  loadModels();
  loadKnowledgeBases(); // 加载知识库列表

  // 清理事件监听器
  onUnmounted(() => {
    document.removeEventListener('paste', handlePaste);
    uploadFiles.value.forEach(revokeImagePreviewUrl);
  });
});
</script>
<style scoped>
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

:deep(.provider-group) {
  margin-bottom: 1rem;
}

:deep(.provider-name) {
  color: var(--el-text-color-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
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

.kb-list {
  padding: 0 2px;
}
</style>