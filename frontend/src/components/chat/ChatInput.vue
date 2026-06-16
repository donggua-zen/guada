<template>
  <div class="w-full flex flex-col items-center">
    <!-- 输入框区域 -->
    <div class="input-area p-[16px_12px_10px_12px] min-h-15 w-full bg-white dark:bg-[#252525]" :class="styleClass">
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
        <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.displayName" :type="file.fileType"
          :ext="file.fileExtension" :size="file.fileSize"
          :preview-url="file.fileType === 'image' ? previewUrls.get(file.id) : undefined" closable
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

      <!-- Tiptap 编辑器（替换 textarea） -->
      <div class="editor-container">
        <component :is="EditorContent" :editor="editor" class="message-editor" />
        <!-- 技能选择弹窗 -->
        <div v-if="skillPickerVisible" class="skill-picker">
          <div class="skill-picker-list">
            <div v-for="(skill, index) in filteredSkills" :key="skill.id" class="skill-picker-item"
              :class="{ active: index === selectedIndex }" @click="selectSkill(skill)"
              @mouseenter="selectedIndex = index">
              <div class="skill-picker-content">
                <span class="skill-picker-icon">
                  <el-icon size="16">
                    <Apps20Regular />
                  </el-icon>
                </span>
                <div class="skill-picker-info flex items-center gap-2">
                  <div class="skill-picker-name whitespace-nowrap" :class="{ 'text-primary': index === selectedIndex }">
                    {{ skill.manifest?.name || skill.name || skill.id }}
                  </div>
                  <div class="skill-picker-desc truncate">
                    {{ skill.manifest?.description || skill.description || '' }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="filteredSkills.length === 0" class="skill-picker-empty">
            未找到匹配的技能
          </div>
        </div>
      </div>

      <!-- 隐藏的文件输入框 -->
      <input type="file" ref="fileInputRef" style="display: none" multiple
        :accept="getFileExtensionsFromType('TEXT').join(',')" @change="handleFileSelect">
      <input type="file" ref="imageInputRef" style="display: none" multiple
        :accept="getFileExtensionsFromType('IMAGE').join(',')" @change="handleImageSelect">
      <div class="input-actions w-full flex justify-between">
        <div class="tools left-tools flex gap-0.5 items-center">
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
            <div class="flex items-center gap-1.5" style="height:24px; max-width: 200px;">
              <Avatar v-if="currentModel"
                :src="getModelAvatarPath(currentModel.modelName, currentModel.provider?.name) || undefined"
                :name="getModelDisplayName(currentModel.modelName)" type="assistant" :round="false"
                class="w-5 h-5 shrink-0" />
              <OpenAI v-else class="w-5 h-5 shrink-0" />
              <span class="text-sm font-medium truncate flex-1 min-w-0"
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{
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
              <el-button class="send-btn stop-btn" @click="abortResponse" circle type="danger" :icon="Stop24Filled">
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
      <SessionSettingsDialog v-model:visible="settingsDialogVisible" :config="sessionMemoryConfig"
        @confirm="applySessionSettings" @cancel="settingsDialogVisible = false" />

      <!-- 工作目录设置弹窗 -->
      <WorkspaceSettingsDialog v-model:visible="workspaceDialogVisible"
        :current-workspace-path="props.config?.workspacePath || null" @confirm="applyWorkspaceSettings" />
    </div>
    <div class="mt-1 w-full flex justify-start px-1 gap-1">
      <!-- 工作目录按钮 -->
      <el-button class="tool-btn mr-0.5" @click.stop="openWorkspaceDialog" text>
        <el-icon size="22">
          <FolderOpen24Regular />
        </el-icon>
        <template v-if="mode == 'create'">
          <span class="text-xs font-medium">
            工作目录：{{ props.config?.workspacePath || '自动创建' }}
          </span>
          <el-icon size="16" class="ml-0.5">
            <ChevronUpDown16Regular />
          </el-icon>
        </template>
        <template v-else>
          <span class="text-xs font-medium">{{ props.config?.workspacePath || '打开工作目录' }}</span>
        </template>
      </el-button>

      <!-- 分组选择按钮（仅创建模式） -->
      <template v-if="mode == 'create'">
        <el-button ref="groupButtonRef" class="tool-btn mr-0.5" @click.stop="openGroupSelector" text>
          <span class="text-xs font-medium">
            分组：{{ selectedGroupName }}
          </span>
          <el-icon size="16" class="ml-0.5">
            <ChevronUpDown16Regular />
          </el-icon>
        </el-button>
      </template>
    </div>

    <!-- 分组选择弹窗 -->
    <el-dialog v-model="groupSelectorVisible" title="请选择分组" width="360px" :close-on-click-modal="false">
      <div class="space-y-1 py-2">
        <div v-for="g in groupSelectorOptions" :key="g.value"
          class="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 text-sm"
          :class="selectedGroupId === g.value ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'"
          @click="selectGroup(g.value)">
          <el-icon class="w-4 h-4">
            <Folder20Regular />
          </el-icon>
          <span class="flex-1">{{ g.label }}</span>
          <el-icon v-if="selectedGroupId === g.value" class="w-4 h-4">
            <Checkmark16Filled />
          </el-icon>
        </div>
      </div>
    </el-dialog>

  </div>
</template>


<script setup lang="ts">
// @ts-nocheck - ChatInput 组件复杂度高，临时使用@ts-nocheck
import { ref, watch, computed, nextTick, onUnmounted, onMounted, reactive } from 'vue'
import { ElIcon, ElButton, ElDialog, ElTabs, ElTabPane, ElInput, ElForm, ElFormItem, ElTag, ElMessage, ElMessageBox } from 'element-plus';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import FileItem from '../ui/FileItem.vue';
import Avatar from '../ui/Avatar.vue';
import ElSliderOptional from '../ui/ElSliderOptional.vue';
import CustomPopover from '../ui/CustomPopover.vue';
import KnowledgeBasePanel from './chat-input/KnowledgeBasePanel.vue';
import SessionSettingsDialog from './chat-input/SessionSettingsDialog.vue';
import ThinkingEffortPopover from './chat-input/ThinkingEffortPopover.vue';
import ModelSelectorPanel from './chat-input/ModelSelectorPanel.vue';
import WorkspaceSettingsDialog from './chat-input/WorkspaceSettingsDialog.vue';
import { SkillNode } from '@/utils/skillNode';
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
  Send24Filled, Stop24Filled, Star24Regular, Star24Filled, Settings24Regular, BookSearch24Regular, FolderOpen24Regular, ChevronUpDown16Regular,
  Apps20Regular, Folder20Regular, Checkmark16Filled
} from '@vicons/fluent'
import {
  ThunderboltOutlined,
  SyncOutlined
} from '@vicons/antd'
import { usePopup } from '@/composables/usePopup';
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import { apiService } from '@/services/ApiService';
import { useSessionGroupStore, UNGROUPED_ID } from '@/stores/sessionGroup';

const sessionGroupStore = useSessionGroupStore();

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
const kbButtonRef = ref<any>(null);
// 会话设置对话框相关
const settingsDialogVisible = ref(false);
// 知识库选择器相关
const knowledgeBases = ref<any[]>([]); // 知识库列表

// Tiptap 编辑器相关
const editor = ref<Editor>();
const skillPickerVisible = ref(false);
const pickerQuery = ref('');
const selectedIndex = ref(0);
const allSkills = ref<any[]>([]);
const editorContent = ref('');

// 抽屉面板状态（会话设置保持抽屉样式 - 已废弃，改用模态框）
const settingsPanelVisible = ref(false)
// 弹窗面板状态（模型和知识库使用弹窗样式）
const modelPanelVisible = ref(false)
const kbPanelVisible = ref(false)

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
  buttons: { type: Object, default: () => [] },
  class: { type: String, default: '' },
  sessionId: { type: [String, Number], default: null },
  // 模式：create 为创建会话模式，chat 为对话模式
  mode: { type: String, default: 'chat' },
  config: {
    type: Object,
    default: () => ({
      modelId: null,
      thinkingEffort: 'off', // 思考强度配置
      workspacePath: null, // 工作目录路径
      // 新增：记忆与压缩配置分组
      memory: {
        useCustom: true, // 默认开启自定义，方便用户直接看到设置
        maxMemoryLength: null,
        compressionTriggerRatio: 0.8,
        compressionTargetRatio: 0.5,
        summaryMode: 'memory_sync', // 默认记忆同步模式
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
 * 将纯文本中的 <skill:xxx> 标记转换为 HTML 标签
 * 供 Tiptap 解析为 Skill 节点
 */
const parseSkillTags = (text: string): string => {
  if (!text) return text;
  return text.replace(/<skill:([^>]+)>/g, '<span data-type="skill" data-skill-name="$1" class="skill-badge" contenteditable="false">/$1</span>');
};

watch(() => props.value, (val) => {
  if (editor.value && editor.value.getText() !== val) {
    const htmlContent = parseSkillTags(val);
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
const localThinkingEffort = ref<string>('off'); // 'off' | 'low' | 'medium' | 'high' | 'max' | ...
const thinkingButtonRef = ref<any>(null);
const thinkingPopoverVisible = ref(false);

// 工作目录设置相关
const workspaceDialogVisible = ref(false);

// 分组选择相关
const groupSelectorVisible = ref(false);
const groupButtonRef = ref<any>(null);

// 初始化时加载分组列表（store 已做防重复请求处理）
sessionGroupStore.loadGroups();

/**
 * 分组选择选项（包含虚拟的未分组）
 */
const groupSelectorOptions = computed(() => {
  const options = sessionGroupStore.sortedGroups.map(g => ({
    label: g.name,
    value: g.id
  }));
  // 始终添加未分组选项
  options.unshift({
    label: '任务列表',
    value: UNGROUPED_ID
  });
  return options;
});

/**
 * 当前选中的分组名称
 */
const selectedGroupName = computed(() => {
  const groupId = props.config?.groupId;
  if (groupId === UNGROUPED_ID || groupId === undefined || groupId === null) {
    return '任务列表';
  }
  const group = sessionGroupStore.sortedGroups.find(g => g.id === groupId);
  return group?.name || '任务列表';
});

/**
 * 当前选中的分组ID
 */
const selectedGroupId = computed(() => {
  return props.config?.groupId || UNGROUPED_ID;
});

/**
 * 打开分组选择弹窗
 */
const openGroupSelector = () => {
  groupSelectorVisible.value = true;
};

/**
 * 选择分组
 */
const selectGroup = (groupId: string) => {
  const groupIdToSet = groupId === UNGROUPED_ID ? null : groupId;
  emit('config-change', { groupId: groupIdToSet });
  groupSelectorVisible.value = false;
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

// 为会话设置对话框构造配置对象（将 memoryEnabled 映射为 useCustom）
const sessionMemoryConfig = computed(() => {
  const config = props.config;
  if (!config) return {};

  return {
    useCustom: config.memoryEnabled ?? true, // 将 memoryEnabled 映射为 useCustom
    ...config.memory, // 展开 memory 对象的其他属性
    workspacePath: config.workspacePath || null, // 工作目录路径
  };
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
  'update:files',
  'send', 'abort', 'files-change',
  'focus', 'blur',
  'update:modelId', 'config-change', 'update:knowledgeBaseIds',
  'toggle-workspace-pane'
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

  return {
    id: fileIdCounter++,
    fileName: file.name || `pasted-${fileType.toLowerCase()}-${timestamp}.${getFileExtensionFromType(file.type)}`,
    fileSize: file.size,
    fileExtension: isPasted ? getFileExtensionFromType(file.type) : getFileExtension(file.name),
    fileType: FILE_TYPES[fileType].type,
    displayName: file.name ? getFileNameWithoutExtension(file.name) : `pasted-${fileType.toLowerCase()}-${timestamp}`,
    file: file,
    // 新增：上传进度状态
    uploadProgress: 0,
    uploadStatus: null, // 'queued' | 'uploading' | 'uploaded' | 'failed'
  };
};

// 打开模型面板
const openModelPanel = () => {
  // 如果面板已经打开，则关闭它（实现切换效果）
  if (modelPanelVisible.value) {
    modelPanelVisible.value = false
    return
  }

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
      newThinkingEffort = nonOffOptions.length > 0 ? nonOffOptions[nonOffOptions.length - 1] : 'off';
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

  modelPanelVisible.value = false
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

// 打开工作目录设置弹窗
const openWorkspaceDialog = () => {
  // 对话模式下仅触发窗格切换事件，由父组件控制显隐
  if (props.mode === 'chat') {
    emit('toggle-workspace-pane');
    return;
  }
  // 创建模式下打开工作目录设置弹窗
  workspaceDialogVisible.value = true;
};

// 应用工作目录设置
const applyWorkspaceSettings = (workspacePath: string | null) => {
  console.log('Applying workspace path:', workspacePath);
  emit('config-change', { workspacePath });
  ElMessage.success('工作目录已更新');
};

// 打开知识库面板
const openKnowledgeBasePanel = async () => {
  // 如果面板已经打开，则关闭它（实现切换效果）
  if (kbPanelVisible.value) {
    kbPanelVisible.value = false
    return
  }

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
    filesToProcess.push(file);
  } else if (pastedText) {
    // 短文本 → 插入到 Tiptap 编辑器
    if (editor.value) {
      editor.value.chain().focus().insertContent(pastedText).run();
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

// ==================== 技能选择弹窗 ====================
const openSkillPicker = (query: string = '') => {
  pickerQuery.value = query;
  selectedIndex.value = 0;
  skillPickerVisible.value = true;
};

const closeSkillPicker = () => {
  skillPickerVisible.value = false;
  pickerQuery.value = '';
  selectedIndex.value = 0;
};

const scrollToSelectedItem = () => {
  nextTick(() => {
    const listEl = document.querySelector('.skill-picker-list');
    const selectedEl = document.querySelectorAll('.skill-picker-item')[selectedIndex.value];
    if (!listEl || !selectedEl) return;

    const listRect = listEl.getBoundingClientRect();
    const selectedRect = selectedEl.getBoundingClientRect();

    if (selectedRect.top < listRect.top) {
      listEl.scrollTop -= listRect.top - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom) {
      listEl.scrollTop += selectedRect.bottom - listRect.bottom;
    }
  });
};

const checkSkillTrigger = () => {
  if (!editor.value) return;

  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
  const lastSlashIndex = textBefore.lastIndexOf('/');
  if (lastSlashIndex < 0) {
    closeSkillPicker();
    return;
  }

  const charBeforeSlash = textBefore[lastSlashIndex - 1];
  if (lastSlashIndex > 0 && charBeforeSlash !== ' ' && charBeforeSlash !== '\n') {
    closeSkillPicker();
    return;
  }

  const query = textBefore.slice(lastSlashIndex + 1);
  if (query.includes(' ')) {
    closeSkillPicker();
    return;
  }

  openSkillPicker(query);
};

const handlePickerKeydown = (e: KeyboardEvent) => {
  if (!skillPickerVisible.value) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selectedIndex.value = (selectedIndex.value + 1) % filteredSkills.value.length;
      scrollToSelectedItem();
      break;
    case 'ArrowUp':
      e.preventDefault();
      selectedIndex.value = (selectedIndex.value - 1 + filteredSkills.value.length) % filteredSkills.value.length;
      scrollToSelectedItem();
      break;
    case 'Enter':
      e.preventDefault();
      if (filteredSkills.value[selectedIndex.value]) {
        selectSkill(filteredSkills.value[selectedIndex.value]);
      }
      break;
    case 'Escape':
      e.preventDefault();
      closeSkillPicker();
      break;
  }
};

const selectSkill = (skill: any) => {
  if (!editor.value) return;

  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
  const slashIndex = textBefore.lastIndexOf('/');

  if (slashIndex >= 0) {
    const from = $from.start() + slashIndex;
    const to = $from.pos;
    editor.value.chain().focus().deleteRange({ from, to }).run();
  }

  const skillName = skill.manifest?.name || skill.name || skill.id;
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'skill',
      attrs: { name: skillName },
    })
    .run();

  closeSkillPicker();
  editorContent.value = editor.value.getText();
};

const filteredSkills = computed(() => {
  if (!pickerQuery.value) return allSkills.value;
  const q = pickerQuery.value.toLowerCase();
  return allSkills.value.filter((s: any) => {
    const name = s.manifest?.name || s.name || s.id;
    const desc = s.manifest?.description || s.description || '';
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });
});

// ==================== 技能数据加载 ====================
const loadSkills = async () => {
  try {
    const response = await apiService.fetchSkills();
    allSkills.value = response.items || [];
  } catch (error) {
    console.error('获取技能列表失败:', error);
  }
};

// 全局点击关闭面板
// 生命周期和监听器

// 编辑器高度自适应
watch(editorContent, () => {
  nextTick(() => {
    const pmEl = document.querySelector('.message-editor .ProseMirror');
    if (pmEl) {
      pmEl.style.minHeight = '56px';
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
  loadSkills(); // 加载技能列表
  initThinkingEffort(); // 初始化思考强度

  // 初始化 Tiptap 编辑器
  try {
    const tiptapEditor = new Editor({
      extensions: [
        StarterKit,
        SkillNode,
        Placeholder.configure({
          placeholder: '按 / 使用技能，Shift+Enter 换行',
        }),
      ],
      content: parseSkillTags(props.value || ''),
      editable: true,
      editorProps: {
        handleKeyDown: (_view, event) => {
          // 弹窗打开时拦截键盘事件
          if (skillPickerVisible.value) {
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
        checkSkillTrigger();
        nextTick(() => {
          const pmEl = document.querySelector('.message-editor .ProseMirror');
          if (pmEl) {
            const height = Math.min(pmEl.scrollHeight, 240);
            pmEl.style.minHeight = '56px';
            pmEl.style.maxHeight = '240px';
            isInputExpanded.value = pmEl.scrollHeight > 60;
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
          if (!document.querySelector('.skill-picker:hover')) {
            closeSkillPicker();
          }
        }, 200);
      },
    });
    editor.value = tiptapEditor;
    console.log('[ChatInput] Tiptap editor created:', tiptapEditor);

    // 将 editor 实例挂载到 DOM 元素，供全局右键菜单使用
    const editorEl = document.querySelector('.message-editor');
    if (editorEl) {
      (editorEl as any).__tiptapEditor = tiptapEditor;
    }
  } catch (err) {
    console.error('[ChatInput] Tiptap editor init failed:', err);
  }
});

// 清理事件监听器和预览 URL
onUnmounted(() => {
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
  min-height: 56px;
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

/* 技能徽标样式 */
:deep(.skill-badge) {
  display: inline;
  color: var(--el-color-primary);
  font-size: inherit;
  line-height: inherit;
  cursor: pointer;
  user-select: none;
}

/* 技能选择弹窗样式 - 悬浮在输入框上方 */
.skill-picker {
  position: absolute;
  bottom: calc(100% + 28px);
  left: 0;
  right: 0;
  z-index: 1000;
  padding: 8px;
  border-radius: 12px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #dcdfe6);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.dark .skill-picker {
  background: #2d2d2d;
  border-color: #3c3c3c;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
}

.skill-picker-list {
  max-height: 200px;
  overflow-y: auto;
}

.skill-picker-item {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 8px;
}

.skill-picker-item:hover,
.skill-picker-item.active {
  background: var(--el-fill-color-light, #f5f7fa);
}

.dark .skill-picker-item:hover,
.dark .skill-picker-item.active {
  background: #3c3c3c;
}

.skill-picker-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.skill-picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.skill-picker-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-picker-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  flex-shrink: 0;
}

.skill-picker-name.text-primary {
  color: var(--el-color-primary);
}

.skill-picker-desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.skill-picker-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
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
  min-height: 56px;
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
  padding: 0 3px;
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