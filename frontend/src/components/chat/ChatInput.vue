<template>
  <div class="w-full flex flex-col items-center">


    <!-- 输入框区域 -->
    <div class="input-area p-[16px_12px_10px_12px] min-h-15 w-full bg-white dark:bg-[#232428]" :class="styleClass">
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
              <BookSearch24Regular />
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
        <div class="tools left-tools flex gap-1 items-center">
          <slot name="buttons"></slot>
          <template v-if="showButtons.thinkingButton && currentModel">
            <!-- 思考强度按钮 -->
            <el-button ref="thinkingButtonRef" class="tool-btn" text @click.stop="toggleThinkingPopover">
              <el-icon size="20" :class="{ 'thinking-active': localThinkingEffort !== 'off' }">
                <LightbulbFilament24Regular />
              </el-icon>
              <span class="text-xs font-medium" :class="{ 'thinking-active-text': localThinkingEffort !== 'off' }">{{
                getThinkingEffortShortLabel(localThinkingEffort) }}</span>
            </el-button>

            <!-- 思考强度弹窗 -->
            <ThinkingEffortPopover v-model:visible="thinkingPopoverVisible" :anchor-el="thinkingButtonRef?.$el"
              :options="thinkingEffortOptions" :current-value="localThinkingEffort"
              @select="handleThinkingEffortChange" />
            <el-divider direction="vertical"></el-divider>
          </template>
          <!-- 图片按钮（高频使用，放在左侧） -->
          <el-tooltip content="添加图片" placement="top">
            <el-button class="tool-btn" @click="triggerImageInput" text>
              <el-icon size="22">
                <Image24Regular />
              </el-icon>
            </el-button>
          </el-tooltip>
          <!-- 附件按钮（高频使用，放在左侧） -->
          <el-tooltip content="上传文件" placement="top">
            <el-button class="tool-btn" @click="triggerFileInput" text>
              <el-icon size="22">
                <Attach24Regular />
              </el-icon>
            </el-button>
          </el-tooltip>
          <!-- 知识库选择按钮 -->
          <el-tooltip content="知识库" placement="top">
            <el-button ref="kbButtonRef" class="tool-btn" @click.stop="openKnowledgeBasePanel" text>
              <el-icon size="22">
                <BookSearch24Regular />
              </el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <div class="right-actions">
          <!-- 模型选择按钮 -->
          <el-button ref="modelButtonRef" @click.stop="openModelPanel" plain
            class="model-selector-btn rounded-full overflow-hidden flex items-center justify-center">
            <div class="flex items-center gap-1.5" style="height:24px">
              <Avatar v-if="currentModel"
                :src="getModelAvatarPath(currentModel.modelName, currentModel.provider?.name) || undefined"
                :name="getModelDisplayName(currentModel.modelName)" type="assistant" :round="false"
                class="w-5 h-5 shrink-0" />
              <OpenAI v-else class="w-5 h-5 shrink-0" />
              <span class="whitespace-nowrap text-sm font-medium"
                :style="{ display: isMobile ? 'none' : 'inline-flex' }">{{
                  currentModelName }}</span>
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

      <!-- 模型选择器弹窗 -->
      <ModelSelectorPanel v-model:visible="modelPanelVisible" :anchor-el="modelButtonRef?.$el" :models="models"
        :providers="providers" :current-model-id="props.config?.modelId || null" @select="handleModelSelect"
        @favorite-changed="handleFavoriteChanged" />

      <!-- 知识库选择弹窗 -->
      <KnowledgeBasePanel v-model:visible="kbPanelVisible" :anchor-el="kbButtonRef?.$el"
        :knowledge-bases="knowledgeBases" :selected-ids="props.config?.knowledgeBaseIds || []"
        @toggle="toggleKnowledgeBaseSelection" />

      <!-- 会话设置模态框 -->
      <SessionSettingsDialog v-model:visible="settingsDialogVisible" :config="props.config?.memory"
        @confirm="applySessionSettings" @cancel="settingsDialogVisible = false" />
    </div>
  </div>
</template>


<script setup lang="ts">
// @ts-nocheck - ChatInput 组件复杂度高，临时使用@ts-nocheck
import { ref, watch, computed, nextTick, onUnmounted, onMounted, reactive } from 'vue'
import { ElIcon, ElButton, ElDialog, ElTabs, ElTabPane, ElInput, ElForm, ElFormItem, ElTag, ElMessage } from 'element-plus';
import FileItem from '../ui/FileItem.vue';
import Avatar from '../ui/Avatar.vue';
import ElSliderOptional from '../ui/ElSliderOptional.vue';
import CustomPopover from '../ui/CustomPopover.vue';
import KnowledgeBasePanel from './chat-input/KnowledgeBasePanel.vue';
import SessionSettingsDialog from './chat-input/SessionSettingsDialog.vue';
import ThinkingEffortPopover from './chat-input/ThinkingEffortPopover.vue';
import ModelSelectorPanel from './chat-input/ModelSelectorPanel.vue';
import { getModelDisplayName, getModelAvatarPath, getModelThinkingEfforts, getThinkingEffortLabel } from '@/utils/modelUtils';
import { OpenAI } from "@/components/icons";
import {
  SearchFilled,
  CheckCircleFilled,
  ArrowRightTwotone,
  CloseOutlined
} from "@vicons/material";
import { Thinking2 } from "@/components/icons";
import {
  TextT24Regular, LightbulbFilament24Regular, LightbulbFilament24Filled, WrenchScrewdriver24Regular, Image24Regular, Attach24Regular,
  Send24Filled, Stop24Filled, Star24Regular, Star24Filled, Settings24Regular, BookSearch24Regular
} from '@vicons/fluent'
import {
  ThunderboltOutlined,
  SyncOutlined
} from '@vicons/antd'
import { usePopup } from '@/composables/usePopup';
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import { apiService } from '@/services/ApiService';

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg') // md = 768px

const { confirm } = usePopup();

// 响应式数据
const isInputExpanded = ref(false);
const messageInputRef = ref(null);
const fileInputRef = ref(null);
const imageInputRef = ref(null);
let fileIdCounter = 0;
const focused = ref(false);
// 模型选择器相关
const models = ref([]);
const providers = ref([]);
const sessionId = ref(null);
// 弹窗触发按钮引用
const modelButtonRef = ref<any>(null);
const kbButtonRef = ref<any>(null);
// 会话设置对话框相关
const settingsDialogVisible = ref(false);
// 知识库选择器相关
const knowledgeBases = ref<any[]>([]); // 知识库列表

// 抽屉面板状态（会话设置保持抽屉样式 - 已废弃，改用模态框）
const settingsPanelVisible = ref(false)
// 弹窗面板状态（模型和知识库使用弹窗样式）
const modelPanelVisible = ref(false)
const kbPanelVisible = ref(false)

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
  tokensButton: true,
});

const props = defineProps({
  value: { type: String, default: '' },
  files: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  webSearchEnabled: { type: Boolean, default: false },
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
      thinkingEffort: 'off', // 思考强度配置
      // 新增：记忆与压缩配置分组
      memory: {
        useCustom: true, // 默认开启自定义，方便用户直接看到设置
        maxMemoryLength: null,
        compressionTriggerRatio: 0.8,
        compressionTargetRatio: 0.5,
        summaryMode: 'fast', // 默认快速模式
        maxTokensLimit: null,
      },
      knowledgeBaseIds: [],
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
}, { immediate: true });

// 思考强度相关
const localThinkingEffort = ref<string>('off'); // 'off' | 'low' | 'medium' | 'high' | 'max' | ...
const thinkingButtonRef = ref<any>(null);
const thinkingPopoverVisible = ref(false);

const thinkingEffortOptions = computed(() => {
  if (!currentModel.value) return [];
  return getModelThinkingEfforts(currentModel.value, providers.value);
});

// 初始化思考强度（从 config 中读取保存的值）
const initThinkingEffort = () => {
  if (props.config?.thinkingEffort) {
    localThinkingEffort.value = props.config.thinkingEffort;
  } else {
    localThinkingEffort.value = 'off';
  }
};

// 切换思考强度弹窗
const toggleThinkingPopover = () => {
  thinkingPopoverVisible.value = !thinkingPopoverVisible.value;
};

// 获取思考强度的标签（用于按钮显示）
const getThinkingEffortShortLabel = (effort: string) => {
  return getThinkingEffortLabel(effort);
};

// 处理思考强度变更
const handleThinkingEffortChange = (effort: string) => {
  // 更新本地状态
  localThinkingEffort.value = effort;

  // 构建配置变更对象
  const configChanges = {
    thinkingEffort: effort, // 始终发送 effort 值，包括 'off'
  };

  console.log('Thinking effort changed:', configChanges);
  emit('config-change', configChanges);
};

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



const getFeatureLabel = (type) => {
  switch (type) {
    case 'tools': return '工具调用';
    case 'thinking': return '混合思考';
    default: return type;
  }
}

const emit = defineEmits([
  'update:value',
  'send', 'abort', 'tokens-statistic', 'files-change',
  'toggle-thinking', 'focus', 'blur',
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

  closeAllPanels()
  modelPanelVisible.value = true
};

// 处理模型选择
const handleModelSelect = (modelId: string) => {
  // 找到新模型对象
  const newModel = models.value.find(m => m.id === modelId);
  if (!newModel) {
    console.error('[ChatInput] Model not found:', modelId);
    return;
  }

  // 获取新模型的思考强度选项
  const options = getModelThinkingEfforts(newModel, providers.value);

  // 获取当前选择的思考强度
  const currentEffort = localThinkingEffort.value;

  // 智能迁移逻辑：
  let newThinkingEffort: string;

  if (options.includes(currentEffort)) {
    // 规则1：如果当前值在新选项中仍然有效，保持不变
    newThinkingEffort = currentEffort;
  } else {
    // 规则2：当前值无效，需要重新选择
    const nonOffOptions = options.filter(e => e !== 'off');

    if (currentEffort === 'off') {
      // 原来就是 'off'，保持 'off'
      newThinkingEffort = 'off';
    } else {
      // 原来是非 'off'，优先选择第一个非 'off' 选项
      newThinkingEffort = nonOffOptions.length > 0 ? nonOffOptions[0] : 'off';
    }
  }

  // 更新本地思考强度状态
  localThinkingEffort.value = newThinkingEffort;

  // 构建配置变更对象
  const configChanges = {
    modelId: modelId,
    thinkingEffort: newThinkingEffort,
  };

  emit('config-change', configChanges);

  closeAllPanels()
};

// 处理收藏状态变化（刷新模型列表）
const handleFavoriteChanged = async () => {
  await reloadModels();
};

// 重新加载模型列表
const reloadModels = async () => {
  models.value = [];
  providers.value = [];
  await loadModels();
};

// 打开会话设置模态框
const openSettingsPanel = () => {
  settingsDialogVisible.value = true
};

// 应用会话设置（模态框确认）
const applySessionSettings = (configChanges: any) => {
  console.log('Applying session settings:', configChanges);
  emit('config-change', configChanges);
  ElMessage.success('会话配置已更新');
  settingsDialogVisible.value = false
};

// 打开知识库面板
const openKnowledgeBasePanel = async () => {
  // 如果面板已经打开，则关闭它（实现切换效果）
  if (kbPanelVisible.value) {
    closeAllPanels()
    return
  }

  closeAllPanels()
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
  if (e.key === 'Escape') {
    if (anyPanelVisible.value) {
      closeAllPanels()
    }
  }
}

// 全局点击关闭面板
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
    if (key in value) {
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
  document.addEventListener('keydown', handleEscKey); // Esc 键监听
  adjustTextareaHeight();
  loadModels();
  loadKnowledgeBases(); // 加载知识库列表
  initThinkingEffort(); // 初始化思考强度
});

// 清理事件监听器
onUnmounted(() => {
  document.removeEventListener('paste', handlePaste);
  document.removeEventListener('keydown', handleEscKey); // 清理 Esc 键监听
  uploadFiles.value.forEach(revokeImagePreviewUrl);
});
</script>
<style scoped>
/* 弹窗容器基础样式 */
.popover-container {
  position: absolute;
  bottom: 100%;
  /* 在 input-area 顶部外侧 */
  left: 0;
  right: 0;
  pointer-events: none;
  /* 让点击穿透到下层 */
}

/* 上下文弹窗通用样式 */

/* 思考按钮激活状态 - 灯泡亮起 */
.thinking-active {
  color: #10b981 !important;
  filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.5));
}

.thinking-active-text {
  color: #10b981 !important;
  font-weight: 600;
}

/* 输入框区域样式 */
.input-area {
  position: relative;
  z-index: 10;
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
  padding: 0 3px;
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
  padding: 6px 6px;
  border-color: transparent;
  background-color: transparent;
  color: var(--el-text-color-regular);
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-selector-btn:hover {
  background-color: var(--el-fill-color-light, #f5f7fa);
  border-color: transparent;
  color: var(--el-text-color-primary);
}

.model-selector-btn:active {
  background-color: var(--el-fill-color, #e5e9ed);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .model-selector-btn {
    display: none !important;
  }
}
</style>