<template>
  <div class="w-full flex flex-col items-center">
    <!-- 输入框区域 -->
    <div class="input-area p-[16px_12px_10px_12px] min-h-15 w-full bg-white/80 dark:bg-[#2d2d2d]/80 backdrop-blur-xl backdrop-saturate-150" :class="styleClass">
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
        <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.displayName" :type="file.fileType"
          :ext="file.fileExtension" :size="file.fileSize"
          :preview-url="file.fileType === 'image' ? previewUrls.get(file.id) : undefined" closable
          :clickable="file.isPasted && file.originalContent && file.fileType === 'text'"
          :upload-progress="file.uploadProgress" :upload-status="file.uploadStatus" @close="removeFile(file.id)"
          @click="showFilePreview(file)">
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

      <!-- Tiptap 编辑器（替换 textarea） -->
      <div class="editor-container">
        <template v-if="props.readonly">
          <div class="readonly-placeholder"
            style="min-height: 58px; padding: 0 8px; font-size: var(--size-text-base, 14px); line-height: 1.8; color: var(--el-text-color-placeholder, #a8abb2); display: flex; align-items: center;">
            子代理会话为只读模式
          </div>
        </template>
        <template v-else>
          <component :is="EditorContent" :editor="editor" class="message-editor" />
          <!-- 命令选择弹窗 -->
          <CommandPicker v-if="commandPickerVisible" ref="commandPickerRef" :visible="commandPickerVisible"
            :items="commandsCache[commandTrigger]" :query="pickerQuery" :selected-index="selectedIndex"
            :trigger="commandTrigger" @select="selectCommand" @close="closeCommandPicker"
            @update:selected-index="selectedIndex = $event" />
        </template>
      </div>

      <!-- 隐藏的文件输入框 -->
      <input type="file" ref="fileInputRef" style="display: none" multiple
        :accept="getFileExtensionsFromType('TEXT').join(',')" @change="handleFileSelect">
      <input type="file" ref="imageInputRef" style="display: none" multiple
        :accept="getFileExtensionsFromType('IMAGE').join(',')" @change="handleImageSelect">
      <div class="input-actions w-full flex justify-between">
        <div class="tools left-tools flex gap-0.5 items-center">
          <slot name="buttons"></slot>
          <!-- 运行模式按钮 -->
          <template v-if="!props.readonly">
            <button ref="runModeButtonRef" class="tool-btn" @click.stop="toggleRunModePopover">
              <el-icon size="16">
                <component :is="runModeIcon" class="text-gray-600" />
              </el-icon>
              <span class="text-xs font-medium">{{ runModeLabel }}</span>
            </button>
            <RunModePopover v-model:visible="runModePopoverVisible" :anchor-el="runModeButtonRef"
              :current-value="currentRunMode" @select="handleRunModeChange" />
            <el-divider direction="vertical"></el-divider>
          </template>

          <!-- 附件/图片/知识库按钮 -->
          <template v-if="!props.readonly">
            <button ref="attachButtonRef" class="tool-btn" @click.stop="toggleAttachPopover">
              <el-icon size="16">
                <Add24Regular />
              </el-icon>
            </button>
            <AttachmentPopover v-model:visible="attachPopoverVisible" :anchor-el="attachButtonRef"
              :knowledge-bases="knowledgeBases" :selected-ids="props.config?.knowledgeBaseIds || []"
              @select-image="triggerImageInput" @select-file="triggerFileInput"
              @toggle-kb="toggleKnowledgeBaseSelection" />
          </template>
        </div>
        <div class="right-actions flex items-center gap-1">
          <slot name="right-actions-before" />
          <!-- 模型选择按钮 -->
          <button ref="modelButtonRef" @click.stop="openModelPanel" class="model-selector-btn"
            :class="{ 'is-open': modelButtonExpanded }" :style="{ width: modelButtonWidth }">
            <span class="text-sm font-medium truncate flex-1 min-w-0"
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{
                currentModelNameOnly }}</span>
            <span v-if="currentThinkingLabel" class="text-xs text-gray-400 shrink-0 ml-1">{{ currentThinkingLabel
            }}</span>
          </button>
          <!-- 会话设置按钮 -->
          <el-tooltip v-if="!props.readonly" content="Token 上限" placement="top">
            <button ref="settingsButtonRef" class="tool-btn" @click.stop="toggleSettingsPopover">
              <span class="text-xs font-medium">{{ maxTokensLabel }}</span>
            </button>
          </el-tooltip>
          <MaxTokensPopover v-model:visible="settingsPopoverVisible" :anchor-el="settingsButtonRef"
            :current-value="props.config?.maxTokensLimit ?? null" @change="handleMaxTokensChange" />
          <!-- 发送/停止按钮 -->
          <el-tooltip v-if="!streaming" content="发送" placement="top">
            <button class="send-btn" @click="sendMessage"
              :disabled="props.readonly || !inputContent.trim() || !props.config?.modelId">
              <el-icon size="20">
                <Send24Filled />
              </el-icon>
            </button>
          </el-tooltip>
          <el-tooltip v-else content="停止生成" placement="top">
            <button class="send-btn stop-btn" @click="abortResponse">
              <el-icon size="20">
                <Stop24Filled />
              </el-icon>
            </button>
          </el-tooltip>
        </div>
      </div>

      <!-- 模型选择器弹窗 -->
      <ModelSelectorPanel v-model:visible="modelPanelVisible" :anchor-el="modelButtonRef" :models="models"
        :providers="providers" :current-model-id="props.config?.modelId || null"
        :thinking-effort-options="thinkingEffortOptions" :thinking-effort-value="localThinkingEffort"
        @select="handleModelSelect" @favorite-changed="handleFavoriteChanged"
        @select-thinking-effort="handleThinkingEffortChange" />

      <!-- 粘贴文本预览弹窗（利用 el-dialog 原生滚动） -->
      <el-dialog v-model="previewDialogVisible" :title="'原始内容预览 - ' + previewFileName" width="640px"
        :close-on-click-modal="false" destroy-on-close class="pasted-preview-dialog" @close="closeFilePreview">
        <pre class="pasted-preview-text">{{ previewContent }}</pre>
        <template #footer>
          <el-button @click="closeFilePreview">关闭</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>


<script setup lang="ts">
// @ts-nocheck - ChatInput 组件复杂度高，临时使用@ts-nocheck
import { ref, watch, computed, nextTick, onUnmounted, onMounted, reactive } from 'vue'
import { ElIcon, ElButton, ElDialog, ElTabs, ElTabPane, ElInput, ElForm, ElFormItem, ElTag, ElMessageBox } from 'element-plus';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import FileItem from '../ui/FileItem.vue';
import Avatar from '../ui/Avatar.vue';
import ElSliderOptional from '../ui/ElSliderOptional.vue';
import CustomPopover from '../ui/CustomPopover.vue';
import KnowledgeBasePanel from './chat-input/KnowledgeBasePanel.vue';
import AttachmentPopover from './chat-input/AttachmentPopover.vue';
import MaxTokensPopover from './chat-input/MaxTokensPopover.vue';
import RunModePopover from './chat-input/RunModePopover.vue';
import ModelSelectorPanel from './chat-input/ModelSelectorPanel.vue';
import { CommandNode } from './chat-input/commandNode';
import CommandPicker from './chat-input/CommandPicker.vue';
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
  Send24Filled, Stop24Filled, Star24Regular, Star24Filled, BookSearch24Regular,
  Apps20Regular, DrinkCoffee16Regular, ClipboardTask24Regular, ShieldLock24Regular, Add24Regular
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
// 弹窗触发按钮引用
const modelButtonRef = ref<any>(null);
// Token 上限 popover
const settingsButtonRef = ref<HTMLElement | null>(null);
const settingsPopoverVisible = ref(false);
// 知识库选择器相关
const knowledgeBases = ref<any[]>([]); // 知识库列表

// Tiptap 编辑器相关
const editor = ref<Editor>();
const commandPickerVisible = ref(false);
const pickerQuery = ref('');
const selectedIndex = ref(0);
const commandsCache = reactive<{ slash: any[]; mention: any[] }>({
  slash: [],
  mention: [],
});
const commandTrigger = ref<'slash' | 'mention'>('slash');
const editorContent = ref('');

// 命令选择弹窗 ref
const commandPickerRef = ref<any>();

// 抽屉面板状态（会话设置保持抽屉样式 - 已废弃，改用模态框）
const settingsPanelVisible = ref(false)
// 弹窗面板状态（模型和知识库使用弹窗样式）
const modelPanelVisible = ref(false)
const modelButtonExpanded = ref(false)
const modelButtonWidth = ref<string | undefined>()
const attachPopoverVisible = ref(false)
const attachButtonRef = ref<any>(null)

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
      '.docx',  // Word 文档
      '.xlsx',  // Excel 文档
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

// 图片预览 URL 字典（与 file 对象解耦）
const previewUrls = ref(new Map());

const props = defineProps({
  value: { type: String, default: '' },
  files: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  buttons: { type: Object, default: () => [] },
  class: { type: String, default: '' },
  sessionId: { type: [String, Number], default: null },
  characterId: { type: String, default: null },
  // 模式：create 为创建会话模式，chat 为对话模式
  mode: { type: String, default: 'chat' },
  config: {
    type: Object,
    default: () => ({
      modelId: null,
      thinkingEffort: 'none',
      workspacePath: null,
      maxTokensLimit: null,
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
  // 始终应用默认样式 
  classes.push('rounded-[22px]');
  if (focused.value) {
    classes.push('shadow-[0_2px_22px_rgba(0,0,0,0.16)] dark:shadow-none');
    classes.push('border border-gray-300 dark:border-transparent');
  } else {
    classes.push('shadow-[0_2px_12px_rgba(0,0,0,0.11)] dark:shadow-none');
    classes.push('border border-gray-300 dark:border-transparent');
  }
  return classes.join(' ') + ' ' + props.class;
});

const inputContent = computed({
  get: () => props.value,
  set: (value) => emit('update:value', value)
});

// Tiptap 编辑器内容同步
watch(editorContent, (val) => {
  if (inputContent.value !== val) {
    inputContent.value = val;
  }
});

/**
 * 将纯文本中的 [/type:name ...] 标记转换为 HTML 标签
 * 供 Tiptap 解析为 Command 节点
 */
const parseCommandTags = (text: string): string => {
  if (!text) return text;
  // 匹配 [/type:name label="xxx"] 或 [@type:name label="xxx"]
  return text.replace(
    /\[([\/@])([a-zA-Z][\w\-\/]*):([\w-]+)(?:\s+label="([^"]*)")?\s*\]/g,
    (_, prefix, provider, name, label) => {
      const displayText = label || `${prefix}${name}`;
      return `<span data-type="command" data-provider-id="${provider}" data-name="${name}" data-label="${label || ''}" data-trigger="${prefix}" class="command-badge" contenteditable="false">${displayText}</span>`;
    }
  );
};

watch(() => props.value, (val) => {
  if (editor.value && editor.value.getText() !== val) {
    // 将纯文本中的 \n 转换为 <br>，确保 setContent 作为 HTML 解析时保留换行
    const htmlContent = parseCommandTags(val).replace(/\n/g, '<br>');
    editor.value.commands.setContent(htmlContent, false);
  }
});

// 管理上传文件列表，自动处理图片预览 URL 的生命周期
const uploadFiles = computed({
  get: () => {
    const files = props.files;

    // 为每个图片文件确保有预览 URL（懒加载）
    files.forEach(file => {
      if (file.fileType === 'image' && file.file && !previewUrls.value.has(file.id)) {
        const previewUrl = URL.createObjectURL(file.file);
        previewUrls.value.set(file.id, previewUrl);
      }
    });

    // 清理不再存在的文件的预览 URL
    const currentFileIds = new Set(files.map(f => f.id));
    previewUrls.value.forEach((url, fileId) => {
      if (!currentFileIds.has(fileId)) {
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
        previewUrls.value.delete(fileId);
      }
    });

    return files;
  },
  set: (newFiles) => {
    // 直接发射更新事件，让父组件处理
    emit('update:files', newFiles);
  }
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
const localThinkingEffort = ref<string>('none'); // 'none' | 'low' | 'medium' | 'high' | 'max' | ...

// 运行模式相关
const runModeButtonRef = ref<any>(null);
const runModePopoverVisible = ref(false);

const currentRunMode = computed(() => props.config?.runMode || 'normal');
const runModeLabel = computed(() => {
  if (currentRunMode.value === 'plan') return '计划模式';
  if (currentRunMode.value === 'sandbox') return '轻沙盒模式';
  return '工作模式';
});
const runModeIcon = computed(() => {
  if (currentRunMode.value === 'plan') return ClipboardTask24Regular;
  if (currentRunMode.value === 'sandbox') return ShieldLock24Regular;
  return DrinkCoffee16Regular;
});

const toggleRunModePopover = () => {
  runModePopoverVisible.value = !runModePopoverVisible.value;
};

const handleRunModeChange = (mode: string) => {
  emit('config-change', { runMode: mode });
};

const thinkingEffortOptions = computed(() => {
  if (!currentModel.value) return [];
  return getModelThinkingEfforts(currentModel.value, providers.value);
});

// 初始化思考强度（从 config 中读取保存的值）
const initThinkingEffort = () => {
  if (props.config?.thinkingEffort) {
    localThinkingEffort.value = props.config.thinkingEffort;
  } else {
    localThinkingEffort.value = 'none';
  }
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
    thinkingEffort: effort, // 始终发送 effort 值，包括 'none'
  };

  console.log('Thinking effort changed:', configChanges);
  emit('config-change', configChanges);
};

const currentModelNameOnly = computed(() => {
  const model = currentModel.value;
  return model ? model.modelName.split("/").pop() : "请选择模型";
});

const currentThinkingLabel = computed(() => {
  if (!showButtons.thinkingButton) return '';
  const effort = localThinkingEffort.value;
  return getThinkingEffortLabel(effort);
});

const currentModelName = computed(() => {
  const name = currentModelNameOnly.value;
  const effort = currentThinkingLabel.value;
  return effort ? `${name} · ${effort}` : name;
});

// 当前选中的知识库列表（根据 ID 从完整列表中过滤）
const selectedKnowledgeBases = computed(() => {
  const kbIds = props.config?.knowledgeBaseIds || [];
  return knowledgeBases.value.filter(kb => kbIds.includes(kb.id));
});

// Token 上限标签
const maxTokensLabel = computed(() => {
  const v = props.config?.maxTokensLimit;
  if (!v) return '不限';
  if (v >= 1000000 && v % 1000000 === 0) return `${v / 1000000}M`;
  if (v >= 1000 && v % 1000 === 0) return `${v / 1000}K`;
  return '自定义';
});

// 切换 Token 上限 popover
const toggleSettingsPopover = () => {
  settingsPopoverVisible.value = !settingsPopoverVisible.value;
};

// 处理 Token 上限变更
const handleMaxTokensChange = (val: number | null) => {
  emit('config-change', { maxTokensLimit: val });
};

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
  'update:files',
  'send', 'abort', 'files-change',
  'focus', 'blur',
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
  const timestamp = Date.now();
  // 检测是否有通过粘贴附加的原始文本内容
  const hasOriginalContent = file._originalContent;

  return {
    id: fileIdCounter++,
    fileName: file.name || `pasted-${fileType.toLowerCase()}-${timestamp}.${getFileExtensionFromType(file.type)}`,
    fileSize: file.size,
    fileExtension: isPasted ? getFileExtensionFromType(file.type) : getFileExtension(file.name),
    fileType: FILE_TYPES[fileType].type,
    displayName: file.name ? getFileNameWithoutExtension(file.name) : `pasted-${fileType.toLowerCase()}-${timestamp}`,
    file: file,
    // 标记是否为粘贴自动转换的文件
    isPasted: !!hasOriginalContent || isPasted,
    // 粘贴转换的原始文本内容（仅粘贴转文件时有值）
    originalContent: hasOriginalContent || undefined,
    // 新增：上传进度状态
    uploadProgress: 0,
    uploadStatus: null, // 'queued' | 'uploading' | 'uploaded' | 'failed'
  };
};

// 打开模型面板
const MODEL_BUTTON_MAX_WIDTH = 200
const MODEL_BUTTON_TRANSITION_MS = 200
let modelOpenTimer: ReturnType<typeof setTimeout> | null = null;
let modelCloseTimer: ReturnType<typeof setTimeout> | null = null;

function measureModelButtonNaturalWidth(): number {
  const button = modelButtonRef.value as HTMLElement | null
  if (!button) return 80

  const clone = button.cloneNode(true) as HTMLElement
  clone.classList.remove('is-open')
  clone.style.position = 'fixed'
  clone.style.visibility = 'hidden'
  clone.style.pointerEvents = 'none'
  clone.style.width = 'auto'
  clone.style.maxWidth = `${MODEL_BUTTON_MAX_WIDTH}px`
  clone.style.left = '-9999px'
  document.body.appendChild(clone)
  const width = Math.min(MODEL_BUTTON_MAX_WIDTH, Math.max(80, clone.getBoundingClientRect().width))
  clone.remove()
  return width
}

function collapseModelButton() {
  if (modelOpenTimer) {
    clearTimeout(modelOpenTimer)
    modelOpenTimer = null
  }
  if (modelCloseTimer) clearTimeout(modelCloseTimer)

  modelButtonExpanded.value = false
  modelButtonWidth.value = `${measureModelButtonNaturalWidth()}px`
  modelCloseTimer = setTimeout(() => {
    modelButtonWidth.value = undefined
    modelCloseTimer = null
  }, MODEL_BUTTON_TRANSITION_MS)
}

const openModelPanel = () => {
  if (modelPanelVisible.value) {
    modelPanelVisible.value = false
    return
  }

  const button = modelButtonRef.value as HTMLElement | null
  if (!button) return

  if (modelOpenTimer) clearTimeout(modelOpenTimer)
  if (modelCloseTimer) {
    clearTimeout(modelCloseTimer)
    modelCloseTimer = null
  }

  // 从当前自适应宽度开始，再在下一帧过渡到最大宽度
  modelButtonWidth.value = `${button.getBoundingClientRect().width}px`
  modelButtonExpanded.value = true
  requestAnimationFrame(() => {
    modelButtonWidth.value = `${MODEL_BUTTON_MAX_WIDTH}px`
  })

  modelOpenTimer = setTimeout(() => {
    modelPanelVisible.value = true
    modelOpenTimer = null
  }, MODEL_BUTTON_TRANSITION_MS)
};

// 外部点击或 ESC 关闭弹窗时，反向收起按钮
watch(modelPanelVisible, (val) => {
  if (!val && modelButtonExpanded.value) {
    collapseModelButton()
  }
})

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
    const nonOffOptions = options.filter(e => e !== 'none');

    if (currentEffort === 'none') {
      // 原来是 off 但新选项不含 off → 选最小思考档
      newThinkingEffort = nonOffOptions.length > 0 ? nonOffOptions[0] : 'none';
    } else {
      // 原来的非 off 值失效 → 选中间值
      newThinkingEffort = nonOffOptions.length > 0 ? nonOffOptions[Math.floor(nonOffOptions.length / 2)] : 'none';
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
};

// 处理收藏状态变化（同步更新本地模型数据）
const handleFavoriteChanged = (modelId: string, isFavorite: boolean) => {
  const model = models.value.find(m => m.id === modelId);
  if (model) {
    model.isFavorite = isFavorite;
  }
};

// 重新加载模型列表
const reloadModels = async () => {
  models.value = [];
  providers.value = [];
  await loadModels();
};

// 附件弹窗切换
const toggleAttachPopover = async () => {
  if (attachPopoverVisible.value) {
    attachPopoverVisible.value = false;
    return;
  }
  try {
    await loadKnowledgeBases();
  } catch (error) {
    console.error('加载知识库列表失败:', error);
  }
  attachPopoverVisible.value = true;
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

    uploadFiles.value = []; // setter 会自动清理预览 URL
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
      uploadFiles.value.push(fileObj);
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
  // 只有输入框被聚焦时才处理粘贴事件
  if (!focused.value) return;

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
  const MAX_TEXT_LENGTH = 2000;
  if (pastedText && pastedText.length > MAX_TEXT_LENGTH) {
    // 超长文本 → 转为 .txt 文件
    const blob = new Blob([pastedText], { type: 'text/plain' });
    const file = new File([blob], `pasted_text_${Date.now()}.txt`, { type: 'text/plain' });
    // 在 File 对象上挂载原始文本，供 createFileObject 检测并存储
    file._originalContent = pastedText;
    filesToProcess.push(file);
  } else if (pastedText) {
    // 短文本 → 插入到 Tiptap 编辑器
    if (editor.value) {
      editor.value.chain().focus().insertContent(pastedText).scrollIntoView().run();
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


// 内容预览相关（粘贴自动转换的文本文件预览）
const previewDialogVisible = ref(false);
const previewContent = ref('');
const previewFileName = ref('');

const showFilePreview = (file: any) => {
  if (!file.isPasted || !file.originalContent) return;
  previewContent.value = file.originalContent;
  previewFileName.value = file.displayName;
  previewDialogVisible.value = true;
};

const closeFilePreview = () => {
  previewDialogVisible.value = false;
  previewContent.value = '';
  previewFileName.value = '';
};

const removeFile = (fileId) => {
  const index = uploadFiles.value.findIndex(file => file.id === fileId);
  if (index !== -1) {
    uploadFiles.value.splice(index, 1); // setter 会自动清理预览 URL
  }
};

// UI 交互函数
const triggerFileInput = () => fileInputRef.value.click();
const triggerImageInput = () => imageInputRef.value.click();

const sendMessage = async () => {
  const content = editor.value ? editor.value.getText() : inputContent.value;
  if (!content.trim() && uploadFiles.value.length === 0) {
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
    content: editor.value ? editor.value.getText() : inputContent.value,
    files: uploadedFiles,
    knowledgeBaseIds: props.config?.knowledgeBaseIds || []
  });

  // 清空编辑器和文件列表
  editor.value?.chain().clearContent().focus().run();
  uploadFiles.value = [];
};

// 显示上传等待对话框
async function showUploadWaitingDialog(uploadingCount: number): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      `当前有 ${uploadingCount} 个文件正在上传中，您可以选择等待上传完成或直接发送消息（仅发送已完成的文件）。`,
      '文件上传中',
      {
        confirmButtonText: '继续等待',
        cancelButtonText: '直接发送',
        type: 'warning',
        distinguishCancelAndClose: true,
        closeOnClickModal: false,
      }
    );
    return true; // 用户点击"继续等待"
  } catch {
    return false; // 用户点击"直接发送"或关闭弹窗
  }
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

const abortResponse = () => {
  emit('abort')
}

const handleFocus = () => {
  focused.value = true;
  emit('focus');
};

const handleBlur = () => {
  focused.value = false;
  emit('blur');
};

// ==================== 命令选择弹窗（斜杠/艾特） ====================
const openCommandPicker = async (query: string = '', trigger: 'slash' | 'mention' = 'slash') => {
  pickerQuery.value = query;
  selectedIndex.value = 0;
  commandTrigger.value = trigger;
  // 按需加载对应触发方式的命令
  await loadCommands(trigger);
  commandPickerVisible.value = true;
};

const closeCommandPicker = () => {
  commandPickerVisible.value = false;
  pickerQuery.value = '';
  selectedIndex.value = 0;
};

const checkCommandTrigger = () => {
  if (!editor.value) return;

  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');

  // 检测 / 触发（斜杠命令）
  const lastSlashIndex = textBefore.lastIndexOf('/');
  if (lastSlashIndex >= 0) {
    const charBeforeSlash = textBefore[lastSlashIndex - 1];
    if (lastSlashIndex === 0 || charBeforeSlash === ' ' || charBeforeSlash === '\n') {
      const query = textBefore.slice(lastSlashIndex + 1);
      if (!query.includes(' ')) {
        openCommandPicker(query, 'slash');
        return;
      }
    }
  }

  // 检测 @ 触发（艾特命令）
  const lastAtIndex = textBefore.lastIndexOf('@');
  if (lastAtIndex >= 0) {
    const charBeforeAt = textBefore[lastAtIndex - 1];
    if (lastAtIndex === 0 || charBeforeAt === ' ' || charBeforeAt === '\n') {
      const query = textBefore.slice(lastAtIndex + 1);
      if (!query.includes(' ')) {
        openCommandPicker(query, 'mention');
        return;
      }
    }
  }

  closeCommandPicker();
};

const handlePickerKeydown = (e: KeyboardEvent) => {
  if (!commandPickerVisible.value || !commandPickerRef.value) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      commandPickerRef.value.moveDown();
      break;
    case 'ArrowUp':
      e.preventDefault();
      commandPickerRef.value.moveUp();
      break;
    case 'Enter':
      e.preventDefault();
      commandPickerRef.value.confirmSelection();
      break;
    case 'Escape':
      e.preventDefault();
      closeCommandPicker();
      break;
  }
};

const selectCommand = (item: any) => {
  if (!editor.value) return;

  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
  const slashIndex = textBefore.lastIndexOf('/');

  // 删除触发字符（/ 或 @）及其后的查询文本
  const triggerIndex = textBefore.lastIndexOf('/');
  const atIndex = textBefore.lastIndexOf('@');
  const delIndex = Math.max(triggerIndex, atIndex);

  if (delIndex >= 0) {
    const from = $from.start() + delIndex;
    const to = $from.pos;
    editor.value.chain().focus().deleteRange({ from, to }).run();
  }

  const providerId = item.providerId || 'skill';
  const name = item.name;
  const label = item.label || item.name;
  const trigger = commandTrigger.value === 'mention' ? '@' : '/';

  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'command',
      attrs: { providerId, name, label, trigger },
    })
    .run();

  closeCommandPicker();
  editorContent.value = editor.value.getText();
};

// ==================== 命令数据加载（按需 + 缓存） ====================
const loadCommands = async (trigger: 'slash' | 'mention') => {
  try {
    const res = await apiService.fetchCommands(trigger, props.characterId || undefined);
    commandsCache[trigger] = res.items || [];
  } catch (error) {
    console.error('获取命令列表失败:', error);
  }
};

// 全局点击关闭面板
// 生命周期和监听器

// 编辑器高度自适应
watch(editorContent, () => {
  nextTick(() => {
    const pmEl = document.querySelector('.message-editor .ProseMirror');
    if (pmEl) {
      pmEl.style.minHeight = '58px';
      pmEl.style.maxHeight = '240px';
      isInputExpanded.value = pmEl.scrollHeight > 60;
    }
  });
});

// 监听思考强度配置变化，同步到本地状态
watch(() => props.config?.thinkingEffort, (newEffort) => {
  if (newEffort !== undefined && newEffort !== localThinkingEffort.value) {
    localThinkingEffort.value = newEffort;
  }
}, { immediate: true });

watch(() => props.buttons, (value) => {
  // 外部传入的按钮配置只影响非模型特性控制的按钮
  Object.keys(showButtons).forEach(key => {
    if (key in value) {
      showButtons[key] = value[key];
    }
  });
}, { immediate: true });

// textarea 高度调整已废弃，改用 Tiptap 编辑器
// watch(inputContent, () => {
//   nextTick(adjustTextareaHeight);
// }, { immediate: true });

onMounted(() => {
  adjustTextareaHeight();
  loadModels();
  loadKnowledgeBases(); // 加载知识库列表
  initThinkingEffort(); // 初始化思考强度

  // 初始化 Tiptap 编辑器
  try {
    const tiptapEditor = new Editor({
      extensions: [
        StarterKit,
        CommandNode,
        Placeholder.configure({
          placeholder: '按 / 使用技能，@ 召唤agent，Shift+Enter 换行',
        }),
      ],
      content: parseCommandTags(props.value || ''),
      editable: true,
      editorProps: {
        handleKeyDown: (_view, event) => {
          // 弹窗打开时拦截键盘事件
          if (commandPickerVisible.value) {
            if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) {
              handlePickerKeydown(event);
              return true;
            }
          }
          // Shift+Enter 换行，Enter 发送消息
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
            return true;
          }
          // Shift+Enter 允许默认行为（换行）
          if (event.key === 'Enter' && event.shiftKey) {
            return false;
          }
          return false;
        },
        handlePaste: (_view, event) => {
          // 调用自定义粘贴处理，阻止 Tiptap 默认行为
          handlePaste(event);
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        editorContent.value = ed.getText();
        checkCommandTrigger();
        nextTick(() => {
          const pmEl = document.querySelector('.message-editor .ProseMirror');
          if (pmEl) {
            const height = Math.min(pmEl.scrollHeight, 240);
            pmEl.style.minHeight = '58px';
            pmEl.style.maxHeight = '240px';
            isInputExpanded.value = pmEl.scrollHeight > 60;
            // 自动滚动光标到可见区域（修复 Shift+Enter 换行时光标被遮挡）
            ed.commands.scrollIntoView();
          }
        });
      },
      onFocus: () => {
        focused.value = true;
        emit('focus');
      },
      onBlur: () => {
        focused.value = false;
        emit('blur');
        setTimeout(() => {
          if (!document.querySelector('.command-picker:hover')) {
            closeCommandPicker();
          }
        }, 200);
      },
    });
    editor.value = tiptapEditor;

    // 将编辑器处理器挂载到 DOM 元素，供全局右键菜单使用（解耦方式）
    const editorEl = document.querySelector('.message-editor') as (HTMLElement & { __editorHandler?: unknown }) | null;
    if (editorEl) {
      editorEl.__editorHandler = {
        getSelectionText: () => {
          return tiptapEditor.state.doc.textBetween(
            tiptapEditor.state.selection.from,
            tiptapEditor.state.selection.to,
            '',
          );
        },
        paste: (text: string) => {
          tiptapEditor.chain().focus().insertContent(text).scrollIntoView().run();
        },
        deleteSelection: () => {
          tiptapEditor.commands.deleteSelection();
        },
        selectAll: () => {
          tiptapEditor.commands.focus();
          tiptapEditor.commands.selectAll();
        },
      };
      editorEl.setAttribute('data-editor-handler', 'true');
    }
  } catch (err) {
    console.error('[ChatInput] Tiptap editor init failed:', err);
  }
});

// 清理事件监听器和预览 URL
onUnmounted(() => {
  if (modelOpenTimer) clearTimeout(modelOpenTimer)
  if (modelCloseTimer) clearTimeout(modelCloseTimer)

  // 销毁编辑器
  if (editor.value) {
    editor.value.destroy();
  }

  // 清理所有预览 URL，防止内存泄漏
  previewUrls.value.forEach((url, fileId) => {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
  previewUrls.value.clear();
});
</script>
<style scoped>
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

/* Tiptap 编辑器样式 - 模拟 textarea */
:deep(.message-editor .ProseMirror) {
  width: 100%;
  min-height: 58px;
  max-height: 240px;
  border: none;
  resize: none;
  outline: none;
  font-size: var(--size-text-base, 14px);
  line-height: 1.8;
  padding: 0 8px;
  background: transparent;
  overflow-y: auto;
  box-sizing: border-box;
  transition: height 0.2s ease;
  color: inherit;
}

:deep(.message-editor .ProseMirror p) {
  margin: 0;
}

/* Placeholder 灰色提示文案样式 */
:deep(.message-editor .ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--el-text-color-placeholder, #a8abb2);
  pointer-events: none;
  height: 0;
}

/* 编辑器容器 */
.editor-container {
  position: relative;
}

/* 命令徽标样式 */
:deep(.command-badge) {
  display: inline;
  color: var(--el-color-primary);
  font-size: inherit;
  line-height: inherit;
  cursor: pointer;
  user-select: none;
}

/* 保留旧样式兼容 */
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
  overflow-y: auto;
  box-sizing: border-box;
  transition: height 0.2s ease;
  min-height: 58px;
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
  gap: 2px;
}

.right-tools {
  display: flex;
  align-items: center;
}


/* 工具按钮 - 原生 button */
.tool-btn {
  color: var(--color-text-gray);
  cursor: pointer;
  font-size: 14px;
  height: 28px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.2s;
  background: transparent;
  border: none;
  border-radius: 6px;
  outline: none;
}

.tool-btn:hover {
  background: var(--color-sidebar-bg-hover);
  color: var(--color-text);
}

.tool-btn:active {
  background: var(--color-sidebar-bg-active);
}

/* 模型选择器按钮 - 原生 button */
.model-selector-btn {
  cursor: pointer;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 16px;
  background-color: transparent;
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 200px;
  min-width: 80px;
  overflow: hidden;
  transition: all 0.2s;
  outline: none;
  font-size: 12px;
}

.model-selector-btn:hover {
  background: var(--color-sidebar-bg-hover);
  color: var(--color-text);
}

.model-selector-btn:active {
  background: var(--color-sidebar-bg-active);
}

.model-selector-btn.is-open {
  width: 200px;
  max-width: 200px;
  background: var(--color-sidebar-bg-active);
}

/* 发送按钮 - 原生 button */
.send-btn {
  cursor: pointer;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: var(--color-primary);
  color: var(--color-primary-text);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  outline: none;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.send-btn:active:not(:disabled) {
  background-color: var(--color-primary-active);
}

.send-btn:disabled {
  background-color: var(--color-text-disabled);
  cursor: not-allowed;
}

.send-btn.stop-btn {
  background-color: #f56c6c;
  color: #fff;
}

.send-btn.stop-btn:hover {
  background-color: #f78989;
}

.send-btn.stop-btn:active {
  background-color: #e64242;
}

/* ========== 粘贴文本预览弹窗样式 ========== */

/* 弹窗 body 利用 el-dialog 原生滚动 */
.pasted-preview-dialog :deep(.el-dialog__body) {
  max-height: 65vh;
  overflow-y: auto;
  padding: 16px 20px;
}

.pasted-preview-text {
  margin: 0;
  padding: 16px;
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Menlo', monospace;
  color: var(--el-text-color-primary, #303133);
}
</style>