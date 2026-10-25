<template>
  <div class="w-full flex flex-col items-center">
    <!-- 输入框区域：只读模式（子代理会话）仍渲染输入区外壳——承载停止按钮；
         内部按 readonly 禁用矩阵收口：编辑器不可编辑、模型选择/拖拽入口守卫、发送禁用。 -->
    <div
      class="input-area p-[12px_8px_10px_8px] min-h-15 w-full bg-(--gd-color-input-bg) border border-(--gd-color-input-border) rounded-(--gd-size-rounded-radius) transition-[border-color,background-color] duration-150"
      :class="[styleClass, { 'drag-over': isDragOver }, { 'bg-(--gd-color-input-bg)': !backdrop }, { 'bg-(--gd-color-input-bg)/60 backdrop-blur-xl ': backdrop }]"
      @dragover.prevent @dragenter.prevent="handleDragEnter" @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop">
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
        <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.displayName" :type="file.fileType"
          :ext="file.fileExtension" :size="file.fileSize"
          :preview-url="file.fileType === 'image' ? previewUrls.get(file.id) : undefined" closable
          :clickable="!!(file.isPasted && file.originalContent && file.fileType === 'file')"
          :upload-progress="file.uploadProgress" :upload-status="file.uploadStatus" :upload-error="file.uploadError"
          @close="removeFile(file.id)" @click="showFilePreview(file)">
        </FileItem>
      </div>

      <!-- 已选知识库 + 附加连接标签显示区域（同一排） -->
      <div class="kb-list flex flex-wrap gap-2 mb-1.5 mx-1.5"
        v-if="selectedKnowledgeBases.length > 0 || selectedAttachmentTags.length > 0">
        <el-tag v-for="kb in selectedKnowledgeBases" :key="`kb-${kb.id}`" closable type="info"
          @close="removeKnowledgeBase(kb.id)" class="text-xs">
          <span class="flex items-center gap-1">
            <el-icon size="14">
              <BookSearch24Regular />
            </el-icon>
            {{ kb.name }}
          </span>
        </el-tag>
        <el-tag v-for="tag in selectedAttachmentTags" :key="`att-${tag.typeId}-${tag.id}`" closable type="info"
          @close="removeAttachmentTag(tag.typeId, tag.id)" class="text-xs">
          <span class="flex items-center gap-1">
            <el-icon size="14">
              <Cloud24Regular />
            </el-icon>
            {{ tag.name }}
          </span>
        </el-tag>
      </div>

      <!-- Tiptap 编辑器（替换 textarea） -->
      <div class="editor-container">
        <component :is="EditorContent" :editor="editor" class="message-editor" />
        <!-- 命令选择弹窗 -->
        <CommandPicker v-if="commandPickerVisible" ref="commandPickerRef" :visible="commandPickerVisible"
          :items="commandsCache[commandTrigger]" :query="pickerQuery" :selected-index="selectedIndex"
          :trigger="commandTrigger" @select="selectCommand" @close="closeCommandPicker"
          @update:selected-index="selectedIndex = $event" />
      </div>

      <!-- 隐藏的文件输入框：文件侧不设 accept（任意格式都能作为路径引用附上） -->
      <input type="file" ref="fileInputRef" style="display: none" multiple @change="handleInputChange">
      <input type="file" ref="imageInputRef" style="display: none" multiple :accept="IMAGE_PICKER_ACCEPT"
        @change="handleInputChange">
      <div class="input-actions w-full flex justify-between">
        <div class="tools left-tools flex gap-0.5 items-center">
          <!-- 附件/图片/知识库按钮 -->
          <template v-if="!props.readonly">
            <button ref="attachButtonRef" class="tool-btn" @click.stop="toggleAttachPopover">
              <el-icon size="16">
                <Add16Filled />
              </el-icon>
            </button>
            <AttachmentPopover v-model:visible="attachPopoverVisible" :anchor-el="attachButtonRef"
              :knowledge-bases="knowledgeBases" :selected-kb-ids="props.config?.knowledgeBaseIds || []"
              :selected-attachments="props.config?.attachments || {}" @select-image="triggerImageInput"
              @select-file="triggerFileInput" @toggle-kb="toggleKnowledgeBaseSelection"
              @toggle-attachment="toggleAttachmentSelection" />
          </template>
            <slot name="buttons"></slot>
          <!-- 运行模式按钮 -->
          <template v-if="!props.readonly">
            <button ref="sandboxModeButtonRef" class="tool-btn" :class="{ 'run-mode-unrestricted': isUnrestrictedMode }"
              @click.stop="toggleSandboxModePopover">
              <el-icon size="16">
                <component :is="sandboxModeIcon" :class="isUnrestrictedMode ? 'text-red-500' : 'text-gray-600'" />
              </el-icon>
              <span class="run-mode-label text-xs font-medium" :class="isUnrestrictedMode ? 'text-red-500' : ''">{{
                sandboxModeLabel }}</span>
            </button>
            <SandboxModePopover v-model:visible="sandboxModePopoverVisible" :anchor-el="sandboxModeButtonRef"
              :current-value="currentSandboxMode" :plan-enabled="planModeEnabled" @select="handleSandboxModeChange"
              @toggle-plan="handlePlanModeToggle" />
            <!-- 计划模式退出按钮：**只在计划模式开启时存在**（按钮可见 = 计划模式开，故不再需要高亮表达状态）。
                 入口在安全档位弹窗里（计划模式项）；此处 hover 图标变 × 表示"点击即退出"。 -->
            <GdTooltip v-if="planModeEnabled" :content="t('chat.input.planModeOff')" placement="top">
              <button class="tool-btn plan-mode-btn" @click.stop="exitPlanMode">
                <el-icon size="16">
                  <Lightbulb24Regular class="plan-mode-icon-default" />
                  <Dismiss16Regular class="plan-mode-icon-hover" />
                </el-icon>
                <span class="plan-mode-label text-xs font-medium">{{ t('chat.input.planMode') }}</span>
              </button>
            </GdTooltip>
            <!-- <el-divider direction="vertical"></el-divider> -->
          </template>


        </div>
        <div class="right-actions flex items-center gap-1">
          <!-- 次要操作（上下文用量环等）：窄容器下整体让位，只留必要按钮 -->
          <div class="right-actions-before-slot">
            <slot name="right-actions-before" />
          </div>
          <!-- 模型选择按钮 -->
          <button ref="modelButtonRef" @click.stop="openModelPanel" class="model-selector-btn"
            :class="{ 'is-open': modelButtonExpanded, 'cursor-not-allowed': props.readonly }"
            :style="{ width: modelButtonWidth }">
            <span class="text-sm font-medium truncate flex-1 min-w-0"
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{
                currentModelNameOnly }}</span>
            <span v-if="currentThinkingLabel" class="text-xs text-gray-400 shrink-0 ml-1">{{ currentThinkingLabel
            }}</span>
          </button>
          <!-- 会话设置按钮 -->
          <GdTooltip v-if="!props.readonly" class="token-limit-control" :content="t('chat.input.tokenLimit')"
            placement="top">
            <button ref="settingsButtonRef" class="tool-btn" @click.stop="toggleSettingsPopover">
              <span class="text-xs font-medium">{{ maxTokensLabel }}</span>
            </button>
          </GdTooltip>
          <MaxTokensPopover v-model:visible="settingsPopoverVisible" :anchor-el="settingsButtonRef"
            :current-value="props.config?.maxTokensLimit ?? null" @change="handleMaxTokensChange" />
          <!-- 停止/发送按钮（单按钮，与参考项目一致）：流式中无输入=停止，有输入/附件=入队 -->
          <GdTooltip v-if="streaming && !inputContent.trim() && uploadFiles.length === 0"
            :content="t('chat.input.stopGenerating')" placement="top">
            <button class="send-btn stop-btn" @click="abortResponse">
              <el-icon size="18">
                <Stop24Filled />
              </el-icon>
            </button>
          </GdTooltip>
          <GdTooltip v-else :content="streaming ? t('chat.input.enqueue') : t('chat.input.send')" placement="top">
            <button class="send-btn" :class="{ 'queue-btn': streaming }" @click="sendMessage"
              :disabled="props.readonly || (!inputContent.trim() && uploadFiles.length === 0) || !props.config?.modelId || sending">
              <el-icon size="18">
                <Send24Filled />
              </el-icon>
            </button>
          </GdTooltip>
        </div>
      </div>

      <!-- 模型选择器弹窗 -->
      <ModelSelectorPanel v-model:visible="modelPanelVisible" :anchor-el="modelButtonRef" :models="models"
        :providers="providers" :current-model-id="props.config?.modelId || null"
        :thinking-effort-options="thinkingEffortOptions" :thinking-effort-value="localThinkingEffort"
        @select="handleModelSelect" @favorite-changed="handleFavoriteChanged"
        @select-thinking-effort="handleThinkingEffortChange" />

      <!-- 粘贴文本预览弹窗 -->
      <GdDialog v-model="previewDialogVisible" :title="t('chat.input.previewTitle', { name: previewFileName })"
        size="md" :close-on-click-modal="false" destroy-on-close @close="closeFilePreview">
        <pre class="pasted-preview-text">{{ previewContent }}</pre>
        <template #footer>
          <el-button @click="closeFilePreview">{{ t('common.close') }}</el-button>
        </template>
      </GdDialog>
    </div>
  </div>
</template>


<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, watch, computed, nextTick, onUnmounted, onMounted, reactive, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon, ElButton, ElTag, ElMessage } from 'element-plus';
import type { Model, ModelProvider } from '@/types/api'
import type { UploadResponse } from '@/types/service'
import type { ChatFileView } from '@/types/session'
import type { KnowledgeBase } from '@/stores/knowledgeBase'
import type { FileRefType } from '@/types/stream/content-block.types';
import type { SkillCommand } from '@/types/skills';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import FileItem from '../ui/FileItem.vue';
import GdDialog from '../ui/GdDialog.vue';
import GdTooltip from '../ui/GdTooltip.vue';
import AttachmentPopover from './chat-input/AttachmentPopover.vue';
import MaxTokensPopover from './chat-input/MaxTokensPopover.vue';
import SandboxModePopover from './chat-input/SandboxModePopover.vue';
import ModelSelectorPanel from './chat-input/ModelSelectorPanel.vue';
import { CommandNode } from './chat-input/commandNode';
import CommandPicker from './chat-input/CommandPicker.vue';
import { getDefaultThinkingEffort, getModelThinkingEfforts, getThinkingEffortLabel } from '@/utils/modelUtils';
import { toResourceUrl } from '@/utils/url';
import { isVisionImageMediaType, RASTER_IMAGE_EXTENSIONS } from '@/utils/media-type';
import { extensionFromName, planAttachment, type AttachmentPlan } from '@/utils/attachment-classify';
import {

  Send24Filled, Stop24Filled, BookSearch24Regular, Cloud24Regular,
  ClipboardTask24Regular, ShieldLock24Regular, ShieldError16Regular, Add16Filled,
  Lightbulb24Regular, Dismiss16Regular
} from '@vicons/fluent'
import { apiService } from '@/services/ApiService';

/** File object managed by ChatInput (created via createFileObject) */
interface ChatFile {
  id: number
  /** 完整文件名（含扩展名）—— FileRef.name 的来源 */
  fileName: string
  fileSize: number
  fileExtension: string
  /** 视图归类：'image'（可预览的位图）| 'file'（其余一律走路径引用） */
  fileType: 'image' | 'file'
  displayName: string
  /**
   * 待上传的原始 File。Electron 下仍保留（图片要上传；非图片虽不上传，
   * 但保留 File 便于「既无本机路径又需要上传」的兜底，如粘贴生成的 Blob 文件）。
   */
  file?: File
  isPasted: boolean
  originalContent?: string
  /** 上传进度（0-100），由发送时的上传流程真实驱动 */
  uploadProgress: number
  uploadStatus: 'queued' | 'uploading' | 'uploaded' | 'failed' | undefined
  /** 上传失败原因（uploadStatus='failed' 时展示） */
  uploadError?: string
  /** 已上传/编辑回填的引用锚点（图片为全局附件目录，普通文件为工作目录相对路径） */
  url?: string
  /** 预览路径（仅图片） */
  previewUrl?: string
  /** Electron 本机绝对路径（非图片附件，不经上传） */
  localPath?: string
  /** 引用形态，随上传响应/编辑回填带出；缺省按 store 解释 */
  refType?: FileRefType
}

/** Chat session config passed from parent */
interface ChatConfig {
  modelId?: string | null
  thinkingEffort?: string
  workspacePath?: string | null
  maxTokensLimit?: number | null
  knowledgeBaseIds?: string[]
  sandboxMode?: string
  /** 计划模式（协作状态，正交于 sandboxMode；开启后后端强制只读） */
  planEnabled?: boolean
  attachments?: Record<string, string[]>
}

/** File with optional _originalContent attached by paste handler */
type FileWithContent = File & { _originalContent?: string }

const { t } = useI18n()

// 聊天附件单文件上限（MB）——与后端 CHAT_UPLOAD_MAX_MB / upload-limits.ts 的默认值保持一致。
// 前端只做"别让用户白等一场"的前置拦截，真正的权威校验在服务端。
// 注意：只对**真正要上传**的文件生效；Electron 下非图片附件只发本机路径、
// 字节不出本机，不受此限额约束（判据见 planAttachment.needsUpload）。
const CHAT_UPLOAD_MAX_MB = 100

// 响应式数据
const fileInputRef = ref<HTMLInputElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);
let fileIdCounter = 0;
const focused = ref(false);
const isDragOver = ref(false);
// 模型选择器相关
const models = ref<Model[]>([]);
const providers = ref<ModelProvider[]>([]);
// 弹窗触发按钮引用
const modelButtonRef = ref<HTMLElement | null>(null);
// Token 上限 popover
const settingsButtonRef = ref<HTMLElement | null>(null);
const settingsPopoverVisible = ref(false);
// 知识库选择器相关
const knowledgeBases = ref<KnowledgeBase[]>([]); // 知识库列表
// 附加连接(插件注册的附件类型)相关
const attachmentTypes = ref<Array<{ id: string; label: string; icon: string; pluginId: string; _items?: Array<{ id: string; name: string; description?: string }> }>>([]);

// Tiptap 编辑器相关
const editor = ref<Editor>();
const commandPickerVisible = ref(false);
const pickerQuery = ref('');
const selectedIndex = ref(0);
const commandsCache = reactive<{ slash: SkillCommand[]; mention: SkillCommand[] }>({
  slash: [],
  mention: [],
});
const commandTrigger = ref<'slash' | 'mention'>('slash');
const editorContent = ref('');

// 命令选择弹窗 ref
const commandPickerRef = ref<InstanceType<typeof CommandPicker>>();

// 弹窗面板状态（模型和知识库使用弹窗样式）
const modelPanelVisible = ref(false)
const modelButtonExpanded = ref(false)
const modelButtonWidth = ref<string | undefined>()
const attachPopoverVisible = ref(false)
const attachButtonRef = ref<HTMLElement | null>(null)

// 常量定义
// 图片选择器的 accept 列表：只是给系统文件对话框加个过滤器，不是准入策略。
// 内容与后端 RASTER_IMAGE_EXTENSIONS 同源（见 utils/media-type.ts 的镜像契约测试）。
// 文件选择器**不设 accept**：普通文件对模型只是一个路径引用，限制可附类型没有意义。
const IMAGE_PICKER_ACCEPT = RASTER_IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(',');

const MIME_TO_EXT: Record<string, string> = {
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

// 图片预览 URL 字典（与 file 对象解耦；key = 文件 id，新选文件为 number、编辑回填为 string。
// key 理论上可为 undefined（历史回填无 id 的项），写入侧有 id === undefined 守卫）
const previewUrls = ref(new Map<number | string | undefined, string>());

/**
 * 把 props.files 中的两种附件形态统一为 ChatFile 视图对象（模板只认 ChatFile 字段）：
 * - 新选/粘贴文件：createFileObject 产出的 ChatFile，原样透传
 * - 编辑回填：消息束聚合出的 FileAttachment 投影 {id, name, url, type(MIME), ext, size, previewUrl}
 *   → 补齐 displayName/fileType/fileExtension/fileSize 视图字段
 * 仅映射元数据，不复制 file/File 引用；发送链路（toPayloadFileRefs）本就双形态兼容，不受影响。
 */
function toChatFileView(file: ChatFileView): ChatFileView {
  if (file.displayName !== undefined && file.fileType !== undefined) return file;
  const isImage = isVisionImageMediaType(file.type);
  return {
    ...file,
    displayName: file.displayName ?? file.name ?? file.fileName,
    fileType: file.fileType ?? (isImage ? 'image' : 'file'),
    fileExtension: file.fileExtension ?? file.ext,
    fileSize: file.fileSize ?? file.size ?? 0,
  };
}

/**
 * 附件列表的**真实状态源**。
 *
 * 旧实现把列表存在 uploadFiles 这个 computed 的缓存值里（getter 返回
 * props.files.map(...) 的副本，选择文件时往副本里 push）：附件是否还在，
 * 取决于 computed 有没有被重新求值——任何一次依赖变化（props.files 更新、
 * getter 内的预览图写入触发自失效）都会让已选附件凭空消失。
 * 现在列表是本组件的 ref，props.files 只在“外部真的换了列表”时同步进来。
 *
 * ⚠ 本块必须在 defineProps 之后：下面带 immediate 的 props 同步 watch 在
 * setup 期间同步求值，放前面会命中 TDZ（Cannot access 'props' before initialization）。
 */
const props = defineProps({
  value: { type: String, default: '' },
  files: { type: Array as PropType<ChatFileView[]>, default: () => [] },
  streaming: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  buttons: { type: Object as PropType<Record<string, boolean>>, default: () => ({}) },
  class: { type: String, default: '' },
  sessionId: { type: [String, Number], default: null },
  agentId: { type: String, default: null },
  // 模式：create 为创建会话模式，chat 为对话模式
  mode: { type: String, default: 'chat' },
  backdrop: { type: Boolean, default: false },
  /**
   * 附件上传器。存在时：点发送先上传待上传附件（带真实进度），成功才 emit('send')。
   * 缺省（如 create 模式尚无会话）则跳过上传，由父组件在会话就绪后统一上传。
   */
  uploader: {
    type: Object as PropType<{
      upload: (
        sessionId: string,
        file: File,
        onProgress?: (percent: number) => void,
      ) => Promise<UploadResponse>
    }>,
    default: undefined,
  },
  config: {
    type: Object as PropType<ChatConfig>,
    default: () => ({
      modelId: null,
      thinkingEffort: undefined,
      workspacePath: null,
      maxTokensLimit: null,
      knowledgeBaseIds: [],
    })
  },
});

const localFiles = ref<ChatFileView[]>([]);

/** 同引用说明是父组件把本组件 emit 出去的数组原样传回来，此时不能覆盖本地状态 */
watch(
  () => props.files,
  (incoming) => {
    if (incoming === localFiles.value) return;
    localFiles.value = (incoming ?? []).map(toChatFileView);
  },
  { immediate: true },
);

/** 提交新的附件列表：更新本地状态并同步父组件（替换旧的 push/赋值分裂写法） */
function commitFiles(next: ChatFileView[]) {
  localFiles.value = next;
  emit('update:files', next);
}

const uploadFiles = computed(() => localFiles.value);

/**
 * 图片预览 URL 的生命周期维护。
 * 从 computed getter 里搬出来：在 getter 内写响应式 Map 属于自失效副作用，
 * 会让 getter 返回新副本，是上面那类"附件消失"问题的来源之一。
 */
watch(
  localFiles,
  (files) => {
    files.forEach((file) => {
      if (file.id === undefined) return;
      if (file.fileType !== 'image' || previewUrls.value.has(file.id)) return;
      if (file.file) {
        // 本地文件（粘贴/新选择）：用 blob URL 预览
        previewUrls.value.set(file.id, URL.createObjectURL(file.file));
      } else if (file.previewUrl || file.url) {
        // 已上传文件（如编辑消息回填）：相对存储路径绝对化后预览
        // （Electron 拼动态端口绝对 URL，Web 走 /uploads 同源代理，与 TurnItem 展示同路径）
        previewUrls.value.set(file.id, toResourceUrl(file.previewUrl || file.url || ''));
      }
    });

    // 清理不再存在的文件的预览 URL
    const currentFileIds = new Set(files.map((f) => f.id));
    previewUrls.value.forEach((url, fileId) => {
      if (!currentFileIds.has(fileId)) {
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
        previewUrls.value.delete(fileId);
      }
    });
  },
  { immediate: true },
);

// 计算属性
const styleClass = computed(() => {
  // 输入区阴影弱化，聚焦不再加重（层次感交给边框）
  return 'shadow-[0_2px_10px_rgba(0,0,0,0.04)] dark:shadow-none ' + props.class;
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
 * 支持任意 key="value" 属性对（label, path, start, end, content, head, tail 等）
 */
const parseCommandTags = (text: string): string => {
  if (!text) return text;
  // 匹配 [/type:name key="val" key="val" ...] 或 [@type:name ...]
  return text.replace(
    /\[([\/@])([a-zA-Z][\w\-\/]*):([\w-]+)((?:\s+\w+="[^"]*")*)\s*\]/g,
    (_match, prefix, provider, name, attrsStr) => {
      const attrs: Record<string, string> = { label: '' };
      if (attrsStr) {
        const attrRegex = /(\w+)="([^"]*)"/g;
        let m: RegExpExecArray | null;
        while ((m = attrRegex.exec(attrsStr)) !== null) {
          attrs[m[1]] = m[2];
        }
      }
      const displayText = attrs.label || `${prefix}${name}`;
      const dataAttrs = Object.entries(attrs)
        .filter(([k]) => k !== 'label')
        .map(([k, v]) => ` data-${k}="${v}"`)
        .join('');
      return `<span data-type="command" data-provider-id="${provider}" data-name="${name}" data-label="${attrs.label || ''}" data-trigger="${prefix}"${dataAttrs} class="command-badge" contenteditable="false">${displayText}</span>`;
    }
  );
};

watch(() => props.value, (val) => {
  if (editor.value && editor.value.getText() !== val) {
    // 将纯文本中的 \n 转换为 <br>，确保 setContent 作为 HTML 解析时保留换行
    const htmlContent = parseCommandTags(val).replace(/\n/g, '<br>');
    editor.value.commands.setContent(htmlContent, { emitUpdate: false });
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

// 思考档位标签显示：能力 = 档位菜单（空 = 不能思考）
watch(() => currentModel.value?.thinkingEfforts, (efforts) => {
  showButtons.thinkingButton = (efforts?.length ?? 0) > 0;
}, { immediate: true });

// 思考强度相关
// 用户是否显式选过档位：false = 跟随菜单默认（中间档），换模型时重新取默认
const thinkingEffortChosen = ref(false);
const localThinkingEffort = ref<string>('none');

// 运行模式相关
const sandboxModeButtonRef = ref<HTMLElement | null>(null);
const sandboxModePopoverVisible = ref(false);

const currentSandboxMode = computed(() => props.config?.sandboxMode || 'workspace-write');
const sandboxModeLabel = computed(() => {
  if (currentSandboxMode.value === 'read-only') return t('chat.input.runModeReadOnly');
  if (currentSandboxMode.value === 'workspace-write') return t('chat.input.runModeWorkspaceWrite');
  return t('chat.input.runModeFullAccess');
});
const sandboxModeIcon = computed(() => {
  if (currentSandboxMode.value === 'read-only') return ClipboardTask24Regular;
  if (currentSandboxMode.value === 'workspace-write') return ShieldLock24Regular;
  return ShieldError16Regular;
});
const isUnrestrictedMode = computed(() => currentSandboxMode.value === 'danger-full-access');

const toggleSandboxModePopover = () => {
  sandboxModePopoverVisible.value = !sandboxModePopoverVisible.value;
};

const handleSandboxModeChange = (mode: string) => {
  emit('config-change', { sandboxMode: mode });
};

// 计划模式（协作状态）：单键开关，无弹层——只有一个布尔，不需要选择面板
const planModeEnabled = computed(() => props.config?.planEnabled === true);

/** 安全档位弹窗里的「计划模式」项：正交开关，取反 */
const handlePlanModeToggle = () => {
  emit('config-change', { planEnabled: !planModeEnabled.value });
};

/** 输入区的计划按钮：只在开启时存在，点击即退出 */
const exitPlanMode = () => {
  emit('config-change', { planEnabled: false });
};

const thinkingEffortOptions = computed(() => {
  if (!currentModel.value) return [];
  return getModelThinkingEfforts(currentModel.value, providers.value);
});

/**
 * 把「显式选择 + 当前菜单」收敛为合法档位：
 * - 用户未选过 → 菜单的默认中间档（后端 defaultThinkingEffort 同规则）
 * - 选过的值不在菜单里（换模型后失效）→ 按后端 clampThinkingEffort 的规则调整
 */
const syncThinkingEffort = () => {
  const options = thinkingEffortOptions.value;
  if (options.length === 0) return;
  const current = localThinkingEffort.value;
  if (!thinkingEffortChosen.value) {
    localThinkingEffort.value = getDefaultThinkingEffort(options);
    return;
  }
  if (options.includes(current)) return;
  const nonOff = options.filter((e) => e !== 'none');
  localThinkingEffort.value =
    (current === 'none' ? nonOff[0] : nonOff[Math.floor(nonOff.length / 2)]) ?? 'none';
};

watch(thinkingEffortOptions, syncThinkingEffort, { immediate: true });

// 初始化思考强度（读会话里保存的值；从未保存过 → 跟随菜单默认中间档）
const initThinkingEffort = () => {
  const saved = props.config?.thinkingEffort;
  if (saved) {
    thinkingEffortChosen.value = true;
    localThinkingEffort.value = saved;
  }
  syncThinkingEffort();
};

// 处理思考强度变更
const handleThinkingEffortChange = (effort: string) => {
  if (!effort) return;
  // 更新本地状态
  localThinkingEffort.value = effort;
  // 这是用户的显式选择：之后换模型时按"迁移"而非"跟随默认"处理
  thinkingEffortChosen.value = true;

  // 构建配置变更对象
  const configChanges = {
    thinkingEffort: effort, // 始终发送 effort 值，包括 'none'
  };

  console.log('Thinking effort changed:', configChanges);
  emit('config-change', configChanges);
};

const currentModelNameOnly = computed(() => {
  const model = currentModel.value;
  return model ? model.modelName.split("/").pop() : t('chat.input.selectModel');
});

const currentThinkingLabel = computed(() => {
  if (!showButtons.thinkingButton) return '';
  const effort = localThinkingEffort.value;
  return getThinkingEffortLabel(effort);
});

// 当前选中的知识库列表（根据 ID 从完整列表中过滤）
const selectedKnowledgeBases = computed(() => {
  const kbIds = props.config?.knowledgeBaseIds || [];
  return knowledgeBases.value.filter(kb => kbIds.includes(kb.id));
});

// 当前选中的附加连接标签（根据 ID 从附件类型列表中解析名称）
const selectedAttachmentTags = computed(() => {
  const attachments = props.config?.attachments || {};
  const tags: Array<{ typeId: string; id: string; name: string }> = [];
  for (const [typeId, itemIds] of Object.entries(attachments) as [string, string[]][]) {
    const typeInfo = attachmentTypes.value.find(t => t.id === typeId);
    if (!typeInfo) continue;
    for (const itemId of itemIds) {
      const item = typeInfo._items?.find(i => i.id === itemId);
      if (item) tags.push({ typeId, id: itemId, name: item.name });
    }
  }
  return tags;
});

// 移除单个附加连接标签
const removeAttachmentTag = (typeId: string, itemId: string) => {
  toggleAttachmentSelection(typeId, itemId);
};

// 已选知识库但列表为空时（刷新后），按需加载一次以恢复标签显示
// watch 定义移至 loadKnowledgeBases 之后，避免 immediate 时 TDZ 引用

// Token 上限标签
const maxTokensLabel = computed(() => {
  const v = props.config?.maxTokensLimit;
  if (!v) return t('chat.input.unlimited');
  if (v >= 1000000 && v % 1000000 === 0) return `${v / 1000000}M`;
  if (v >= 1000 && v % 1000 === 0) return `${v / 1000}K`;
  return t('chat.input.custom');
});

// 切换 Token 上限 popover
const toggleSettingsPopover = () => {
  settingsPopoverVisible.value = !settingsPopoverVisible.value;
};

// 处理 Token 上限变更
const handleMaxTokensChange = (val: number | null) => {
  emit('config-change', { maxTokensLimit: val });
};



const emit = defineEmits([
  'update:value',
  'update:files',
  'send', 'abort',
  'focus', 'blur',
  'update:modelId', 'config-change', 'update:knowledgeBaseIds'
]);

// 工具函数
const getFileNameWithoutExtension = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
};

const getFileExtensionFromType = (mimeType: string) => {
  return MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'file';
};

/**
 * 生成附件对象。分流与传输方式由 planAttachment 按真实类型判定（不看是从哪个入口选的）：
 * 位图走图片通道（上传 + 转码 + 内联给模型），其余走路径引用通道；
 * Electron 下后者只引用本机绝对路径，字节不出本机。
 */
const createFileObject = (file: File, plan: AttachmentPlan, localPath?: string): ChatFile => {
  const timestamp = Date.now();
  // 检测是否有通过粘贴附加的原始文本内容
  const hasOriginalContent = (file as FileWithContent)._originalContent;

  // 文件名缺失（粘贴的 Blob）时按 MIME 补一个，命名便于用户识别
  const fileName = file.name
    || `pasted-${timestamp}.${getFileExtensionFromType(file.type)}`;

  return {
    id: fileIdCounter++,
    fileName,
    fileSize: file.size,
    fileExtension: extensionFromName(file.name) || getFileExtensionFromType(file.type),
    fileType: plan.kind,
    displayName: file.name ? getFileNameWithoutExtension(file.name) : `pasted-${timestamp}`,
    file,
    // 标记是否为粘贴自动转换的文件（超长文本转成的 .txt）
    isPasted: !!hasOriginalContent,
    // 粘贴转换的原始文本内容（仅粘贴转文件时有值）
    originalContent: hasOriginalContent || undefined,
    // 本机绝对路径引用（Electron 非图片，不上传）
    localPath: plan.useLocalPath ? localPath : undefined,
    // 上传进度状态（由发送时的上传流程真实驱动）
    uploadProgress: 0,
    uploadStatus: undefined, // 'queued' | 'uploading' | 'uploaded' | 'failed'
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
  // 取整：小数宽度会让胶囊内部居中余量成小数，并把同行右侧按钮一起推到小数位置
  const width = Math.round(Math.min(MODEL_BUTTON_MAX_WIDTH, Math.max(80, clone.getBoundingClientRect().width)))
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
  // 只读模式（子代理会话）：模型仅展示不可切换
  if (props.readonly) return
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

  // 从当前自适应宽度开始，再在下一帧过渡到最大宽度（取整：避免宽度过渡的两端带小数）
  modelButtonWidth.value = `${Math.round(button.getBoundingClientRect().width)}px`
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

  if (!currentEffort) {
    // 规则0：从未显式选择 → 取新菜单的默认中间档（与后端 defaultThinkingEffort 一致）
    newThinkingEffort = getDefaultThinkingEffort(options);
  } else if (options.includes(currentEffort)) {
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
  const configChanges: { modelId: string; thinkingEffort?: string } = {
    modelId: modelId,
  };
  // 未显式选过档位时不落库：让会话保持"未设置"，由后端 defaultThinkingEffort 决定，
  // 否则会把跟随默认的中间档固化成一次"用户选择"，之后换模型不再跟随
  if (thinkingEffortChosen.value) {
    configChanges.thinkingEffort = newThinkingEffort;
  }

  emit('config-change', configChanges);
};

// 处理收藏状态变化（同步更新本地模型数据）
const handleFavoriteChanged = (modelId: string, isFavorite: boolean) => {
  const model = models.value.find(m => m.id === modelId);
  if (model) {
    model.isFavorite = isFavorite;
  }
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
    console.error('加载附件列表失败:', error);
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

// 切换附件选中状态 - 立即同步到父组件
const toggleAttachmentSelection = (typeId: string, itemId: string) => {
  const currentAttachments = { ...(props.config?.attachments || {}) };
  const ids = [...(currentAttachments[typeId] || [])];
  const index = ids.indexOf(itemId);

  if (index === -1) {
    ids.push(itemId);
  } else {
    ids.splice(index, 1);
  }

  if (ids.length === 0) {
    delete currentAttachments[typeId];
  } else {
    currentAttachments[typeId] = ids;
  }

  emit('config-change', { attachments: currentAttachments });
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
      const textModels = provider.models?.filter(model => model.modelType === "text") ?? [];
      models.value.push(...textModels);
      delete provider.models;
      // 只有当该供应商有符合条件的模型时才加入列表
      if (textModels.length > 0) {
        providers.value.push(provider);
      }
    });
    if (models.value.length > 0 && !props.config?.modelId) {
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
        // 通知父组件更新配置，清除无效的知识库ID
        emit('config-change', { knowledgeBaseIds: validKbIds });
      }
    }
  } catch (error) {
    console.error('获取知识库列表失败:', error);
  }
};

// 加载附件类型（插件 registerAttachmentType 注册，含可选项列表）
const loadAttachmentTypes = async () => {
  try {
    const types = await apiService.getAttachmentTypes();
    const results: typeof attachmentTypes.value = [];
    for (const t of types) {
      let items: Array<{ id: string; name: string; description?: string }> = [];
      try {
        const lists = await apiService.getPluginAttachments(t.pluginId);
        const found = lists.find(l => l.typeId === t.id);
        items = found?.items || [];
      } catch { }
      results.push({ ...t, _items: items });
    }
    attachmentTypes.value = results;
  } catch {
    attachmentTypes.value = [];
  }
};

// 已选知识库但列表为空时（刷新后），按需加载一次以恢复标签显示
watch(() => props.config?.knowledgeBaseIds, (kbIds) => {
  if (kbIds && kbIds.length > 0 && knowledgeBases.value.length === 0) {
    loadKnowledgeBases();
  }
}, { immediate: true });

// 已选附加连接但类型列表为空时（刷新后），按需加载一次以恢复标签显示
watch(() => props.config?.attachments, (attachments) => {
  if (attachments && Object.keys(attachments).length > 0 && attachmentTypes.value.length === 0) {
    loadAttachmentTypes();
  }
}, { immediate: true });

// 文件处理函数

/** 取该文件在 Electron 下的本机绝对路径（非 Electron 或拿不到时返回 undefined） */
const resolveLocalPath = (file: File): string | undefined => {
  if (!isElectron) return undefined;
  return window.electronAPI?.getPathForFile(file) || undefined;
};

/**
 * 处理一批文件：**不筛类型，只做分流**。
 *
 * 普通文件对模型只是一个路径引用，限制可附格式没有意义——所以这里不再有
 * 扩展名白名单。唯一按类型区分的是「是不是位图」：位图走图片通道
 * （上传到全局附件目录 + sharp 转码 + 内联字节），其余走路径引用通道。
 *
 * 图片与文件也不再互斥：后端按 mediaType 逐块落 image/file 块，两种块
 * 可以共存于同一条消息，模型侧分别投影（图片内联或占位、文件给路径）。
 *
 * 拦截只针对两种情况：
 * - **0 字节条目**：拖入文件夹时 dataTransfer.files 里就是这种（无内容、无扩展名）
 * - **超出上传限额**：仅对「字节要过网络」的文件生效（见 planAttachment.needsUpload）。
 *   Electron 下非图片附件只发本机路径、字节始终留在本机，本服务既不接收也不存储，
 *   拿上传限额去卡它是没有意义的——2GB 的本地压缩包照样可以附上。
 */
const processFiles = (files: File[]) => {
  const maxBytes = CHAT_UPLOAD_MAX_MB * 1024 * 1024;
  const added: ChatFile[] = [];
  const oversize: string[] = [];
  let emptyCount = 0;

  for (const file of files) {
    if (file.size === 0) {
      emptyCount++;
      continue;
    }
    const localPath = resolveLocalPath(file);
    const plan = planAttachment(file, { isElectron, localPath });
    if (plan.needsUpload && file.size > maxBytes) {
      oversize.push(file.name);
      continue;
    }
    added.push(createFileObject(file, plan, localPath));
  }

  if (oversize.length > 0) {
    ElMessage.error(
      t('chat.input.fileTooLarge', { names: oversize.join('、'), max: CHAT_UPLOAD_MAX_MB }),
    );
  }
  if (emptyCount > 0) {
    ElMessage.warning(t('chat.input.emptyFilesSkipped', { count: emptyCount }));
  }
  if (added.length > 0) {
    commitFiles([...localFiles.value, ...added]);
  }
};

// 事件处理函数：两个入口共用同一个处理——分流按文件真实类型判定，
// 与「从图片还是文件入口进来」无关（图片入口的 accept 只是文件对话框的过滤器）
const handleInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  processFiles(Array.from(target.files ?? []));
  target.value = '';
};

const handlePaste = async (event: ClipboardEvent) => {
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
    const file = new File([blob], `pasted_text_${Date.now()}.txt`, { type: 'text/plain' }) as FileWithContent;
    // 在 File 对象上挂载原始文本，供 createFileObject 检测并存储
    file._originalContent = pastedText;
    filesToProcess.push(file);
  } else if (pastedText) {
    // 短文本 → 插入到 Tiptap 编辑器
    if (editor.value) {
      editor.value.chain().focus().insertContent(pastedText).scrollIntoView().run();
    }
  }

  // 处理文件项：逐个按真实类型分流（图片入图片通道、其余入路径通道），不再筛格式
  if (filesToProcess.length > 0) {
    processFiles(filesToProcess);
  }
};


// ==================== 拖拽上传 ====================
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

let dragCounter = 0;

const handleDragEnter = () => {
  // 只读模式：不显示拖拽高亮态
  if (props.readonly) return;
  dragCounter++;
  isDragOver.value = true;
};

const handleDragLeave = () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragOver.value = false;
  }
};

const handleDrop = (event: DragEvent) => {
  // 只读模式（子代理会话）：不接收拖拽附件
  if (props.readonly) return;

  dragCounter = 0;
  isDragOver.value = false;

  const droppedFiles = event.dataTransfer?.files;
  if (!droppedFiles || droppedFiles.length === 0) return;

  // 逐个按真实类型分流：图片入图片通道、其余入路径通道，允许混在同一批（也允许与已有附件共存）
  processFiles(Array.from(droppedFiles));
};

// 内容预览相关（粘贴自动转换的文本文件预览）
const previewDialogVisible = ref(false);
const previewContent = ref('');
const previewFileName = ref('');

const showFilePreview = (file: ChatFileView) => {
  if (!file.isPasted || !file.originalContent) return;
  previewContent.value = file.originalContent;
  previewFileName.value = file.displayName ?? '';
  previewDialogVisible.value = true;
};

const closeFilePreview = () => {
  previewDialogVisible.value = false;
  previewContent.value = '';
  previewFileName.value = '';
};

const removeFile = (fileId: number | string | undefined) => {
  commitFiles(localFiles.value.filter(file => file.id !== fileId));
};

// UI 交互函数
const triggerFileInput = () => fileInputRef.value?.click();
const triggerImageInput = () => imageInputRef.value?.click();

/**
 * 上传待上传的附件（串行：保证服务端 createdAt 顺序与用户选择顺序一致）。
 *
 * 进度与失败状态写回对应的附件卡片（FileItem 的进度覆盖层/失败态就是为此准备的）。
 * 返回失败项；调用方在失败非空时**不发送消息、也不清空列表**，
 * 让用户可以只重试一次（失败项仍带 File，下次发送会重新上传）。
 */
async function uploadPendingFiles(pending: ChatFileView[]): Promise<ChatFileView[]> {
  const failed: ChatFileView[] = [];
  const { uploader, sessionId } = props;

  // create 模式尚无会话：服务端没有可落盘的工作目录，交给父组件在会话创建后上传
  if (!uploader || !sessionId) return failed;

  for (const item of pending) {
    if (!item.file) continue;
    patchFile(item.id, { uploadStatus: 'uploading', uploadProgress: 0, uploadError: undefined });
    try {
      const response = await uploader.upload(String(sessionId), item.file, (percent: number) => {
        patchFile(item.id, { uploadProgress: percent });
      });
      patchFile(item.id, { ...response, uploadProgress: 100, uploadStatus: 'uploaded' });
    } catch (error) {
      failed.push(item);
      patchFile(item.id, {
        uploadStatus: 'failed',
        uploadError: getErrorMessage(error),
      });
    }
  }
  return failed;
}

/** 就地更新某个附件并提交（commitFiles 会同步父组件，卡片据此显示进度/失败态） */
function patchFile(id: number | string | undefined, patch: Partial<ChatFileView>) {
  commitFiles(localFiles.value.map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

/** 仍需上传的项：既无引用锚点（未上传），也无本机路径（Electron 非图片不走上传） */
const pendingUploadFiles = computed(() =>
  localFiles.value.filter((f) => !f.url && !f.localPath && f.file),
);

const sending = ref(false);

const sendMessage = async () => {
  if (sending.value) return;

  const content = editor.value ? editor.value.getText() : inputContent.value;
  if (!content.trim() && localFiles.value.length === 0) {
    return;
  }

  sending.value = true;
  try {
    const failed = await uploadPendingFiles(pendingUploadFiles.value);
    if (failed.length > 0) {
      // 有附件没传上去就不发消息：否则用户以为附件发出去了，实际只发出半条。
      // 列表与正文都保留，用户可按发送键重试（失败项会重新上传）。
      ElMessage.error(t('chat.input.uploadFailed'));
      return;
    }

    // 用上传前捕获的正文：上传期间用户可能继续敲字，不该混进这一条消息
    emit('send', {
      content,
      files: localFiles.value,
      knowledgeBaseIds: props.config?.knowledgeBaseIds || []
    });

    // 清空编辑器和文件列表
    editor.value?.chain().clearContent().focus().run();
    commitFiles([]);
  } finally {
    sending.value = false;
  }
};


const abortResponse = () => {
  emit('abort')
}


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

const handlePickerKeydown = (e: KeyboardEvent): boolean => {
  if (!commandPickerVisible.value || !commandPickerRef.value) return false;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      commandPickerRef.value.moveDown();
      return true;
    case 'ArrowUp':
      e.preventDefault();
      commandPickerRef.value.moveUp();
      return true;
    case 'Enter':
      if (commandPickerRef.value.hasMatches()) {
        e.preventDefault();
        commandPickerRef.value.confirmSelection();
        return true;
      }
      // 无匹配项：关闭面板并放行 Enter。否则输入 `/compact`（列表尚未加载/无匹配）时
      // 回车被面板吞掉，消息发不出去。
      closeCommandPicker();
      return false;
    case 'Escape':
      e.preventDefault();
      closeCommandPicker();
      return true;
  }
  return false;
};

const selectCommand = (item: SkillCommand) => {
  if (!editor.value) return;

  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');

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

  // 本地命令：插入纯文本（供用户继续补参数），不生成标签节点。
  // 发送时由 ChatPanel/后端识别并本地执行，命令文本不会进入对话历史。
  if (item.local === true) {
    editor.value
      .chain()
      .focus()
      .insertContent(`/${name} `)
      .run();
    closeCommandPicker();
    editorContent.value = editor.value.getText();
    return;
  }

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
/**
 * 本地命令（picker 展示用）。
 * 选中后插入纯文本 `/compact `，真正执行由 ChatPanel / 后端在发送时拦截，
 * 不产生 `[/provider:name]` 标签、不写用户消息、不进 LLM 上下文。
 */
const localSlashCommandItems = (): SkillCommand[] => [
  {
    name: 'compact',
    label: 'compact',
    description: t('chat.command.compactDescription'),
    providerId: 'local',
    trigger: 'slash',
    local: true,
  },
];

const loadCommands = async (trigger: 'slash' | 'mention') => {
  const local = trigger === 'slash' ? localSlashCommandItems() : [];
  try {
    const res = await apiService.fetchCommands(trigger, props.agentId || undefined);
    commandsCache[trigger] = [...local, ...(res.items || [])];
  } catch (error) {
    console.error('获取命令列表失败:', error);
    // 命令列表接口失败时仍保留本地命令（/compact 不依赖后端注册表）
    commandsCache[trigger] = local;
  }
};


// 编辑器高度自适应
watch(editorContent, () => {
  nextTick(() => {
    const pmEl = document.querySelector('.message-editor .ProseMirror') as HTMLElement | null;
    if (pmEl) {
      pmEl.style.minHeight = '48px';
      pmEl.style.maxHeight = '240px';
    }
  });
});

// 监听思考强度配置变化，同步到本地状态（undefined = 会话从未选过 → 走菜单默认中间档）
watch(() => props.config?.thinkingEffort, (newEffort) => {
  if (newEffort === undefined) return;
  thinkingEffortChosen.value = true;
  if (newEffort !== localThinkingEffort.value) {
    localThinkingEffort.value = newEffort;
  }
  syncThinkingEffort();
}, { immediate: true });

watch(() => props.buttons, (value) => {
  // 外部传入的按钮配置只影响非模型特性控制的按钮
  Object.keys(showButtons).forEach(key => {
    const k = key as keyof typeof showButtons;
    if (value && k in value) {
      showButtons[k] = value[k];
    }
  });
}, { immediate: true });

onMounted(() => {
  loadModels();
  initThinkingEffort(); // 初始化思考强度

  // 初始化 Tiptap 编辑器
  try {
    const tiptapEditor = new Editor({
      extensions: [
        StarterKit,
        CommandNode,
        Placeholder.configure({
          // 只读模式（子代理会话）提示只读文案，不可输入；
          // showOnlyWhenEditable: false —— 默认 true 时不可编辑的编辑器不渲染占位装饰
          placeholder: props.readonly
            ? t('chat.input.readonlyPlaceholder')
            : t('chat.input.editorPlaceholder'),
          showOnlyWhenEditable: false,
        }),
      ],
      content: parseCommandTags(props.value || ''),
      editable: !props.readonly,
      editorProps: {
        handleKeyDown: (_view, event) => {
          // 弹窗打开时拦截键盘事件
          if (commandPickerVisible.value) {
            if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) {
              if (handlePickerKeydown(event)) return true;
              // Enter 且面板无匹配项：继续走下方正常发送逻辑
            }
          }
          // Shift+Enter 换行，Enter 发送消息
          if (event.key === 'Enter' && !event.shiftKey) {
            // 与发送按钮相同的禁用条件（仅有附件、没有正文时也允许发送）
            if (
              props.readonly ||
              (!inputContent.value.trim() && localFiles.value.length === 0) ||
              !props.config?.modelId ||
              sending.value
            ) {
              event.preventDefault();
              return true;
            }
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
          const pmEl = document.querySelector('.message-editor .ProseMirror') as HTMLElement | null;
          if (pmEl) {
            // 与 mount 分支同值：两处不一致会在首次输入时把输入框顶跳 6px
            pmEl.style.minHeight = '48px';
            pmEl.style.maxHeight = '240px';
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
  previewUrls.value.forEach((url, _fileId) => {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
  previewUrls.value.clear();
});

/**
 * 在光标处插入文本
 */
function insertText(text: string) {
  if (!editor.value || !text) return;
  editor.value.chain().focus().insertContent(text).scrollIntoView().run();
}

/**
 * 插入 snip 选区徽标
 */
function insertBadge(data: {
  path: string;
  fileName: string;
  startLine?: number;
  endLine?: number;
  content: string;
  label: string;
}) {
  if (!editor.value) return;
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'command',
      attrs: {
        providerId: 'snip',
        name: 'quote',
        label: data.label,
        trigger: '/',
        path: data.path,
        start: data.startLine ? String(data.startLine) : '',
        end: data.endLine ? String(data.endLine) : '',
        content: data.content,
      },
    })
    .run();
  editorContent.value = editor.value.getText();
}

defineExpose({ insertText, insertBadge });
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
  /* 工具条按输入框自身宽度自适应（容器查询），窗口/浮窗/侧栏变窄都能命中 */
  container-type: inline-size;
  container-name: composer;
}

/* 拖拽悬停高亮 */
.input-area.drag-over {
  border-color: var(--gd-color-primary) !important;
  background-color: color-mix(in srgb, var(--gd-color-primary) 8%, var(--gd-color-input-bg)) !important;
}

/* Tiptap 编辑器样式 - 模拟 textarea */
:deep(.message-editor .ProseMirror) {
  width: 100%;
  /* 2 行 / 10 行的整数行高刻度：行高 24px（与 markdown 正文 --gd-md-line-height 同源），
     48 = 2×24、240 = 10×24。原 min-height 52/58 与 line-height 22.4px 都是小数几何：
     行高小数 → 每行基线落在设备像素之间（发虚）；min-height 在首次输入时 52→58
     还会让输入框（含上方全部内容）跳 6px；240 ÷ 22.4 = 10.71 行 → 滚动时末行半行裁切。 */
  min-height: 48px;
  max-height: 240px;
  border: none;
  resize: none;
  outline: none;
  font-size: var(--gd-size-text-base, 14px);
  line-height: calc(var(--gd-size-text-base) + 10px);
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
  font-size: 12px;
  line-height: inherit;
  cursor: pointer;
  user-select: none;
  background: var(--gd-color-sidebar-bg-active);
  color: var(--gd-color-text);
  padding: 0 8px;
  border-radius: 4px;
  margin-right: 4px;
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

/* 右侧次要操作（父级插槽：上下文用量环等）——与右侧按钮组同轴对齐 */
.right-actions-before-slot {
  display: flex;
  align-items: center;
  gap: 2px;
}


/* 工具按钮 - 原生 button（12px：与模型选择器、工作目录条 chips 同字号） */
.tool-btn {
  color: var(--gd-color-text-gray);
  cursor: pointer;
  font-size: 12px;
  height: 28px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  transition: all 0.2s;
  background: transparent;
  border: none;
  border-radius: 6px;
  outline: none;
}

.tool-btn:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

.tool-btn:active {
  background: var(--gd-color-sidebar-bg-active);
}

/* 计划模式激活态 - 琥珀色文字与图标（与自由编辑的红色警示区分：一个是协作状态，一个是风险档位） */
/* 计划模式按钮：hover 时图标由灯泡换成 ×（纯 CSS 切换 display，不引入 hover 状态、不触发重渲染）。
   按钮只在计划模式开启时渲染，故无需高亮表达状态——可见性本身就是状态。 */
.plan-mode-icon-hover {
  display: none;
}

.plan-mode-btn:hover .plan-mode-icon-default {
  display: none;
}

.plan-mode-btn:hover .plan-mode-icon-hover {
  display: block;
}

/* 自由编辑（danger-full-access）按钮 - 红色警示文字与图标（不加红色背景，hover 保持默认背景） */
.run-mode-unrestricted {
  color: #ef4444 !important;
  font-weight: 500;
}

.run-mode-unrestricted:hover {
  color: #ef4444 !important;
}

/* 模型选择器按钮 - 原生 button */
.model-selector-btn {
  cursor: pointer;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 16px;
  background-color: transparent;
  color: var(--gd-color-text);
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
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

.model-selector-btn:active {
  background: var(--gd-color-sidebar-bg-active);
}

.model-selector-btn.is-open {
  width: 200px;
  max-width: 200px;
  background: var(--gd-color-sidebar-bg-active);
}

/* 发送按钮 - 原生 button */
.send-btn {
  cursor: pointer;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background-color: var(--gd-color-primary);
  color: var(--gd-color-primary-text);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  outline: none;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background-color: var(--gd-color-primary-hover);
}

.send-btn:active:not(:disabled) {
  background-color: var(--gd-color-primary-active);
  transform: scale(0.92);
}

.send-btn:disabled {
  background-color: var(--gd-color-text-disabled);
  cursor: not-allowed;
  /* 禁用态可读性：主题色系的禁用底色只是"淡化的主题色"（如涂鸦本的
     米色、蒸汽朋克的黄铜色），看不出"关"。降不透明度 + 去饱和，
     任何主题下都能一眼区分 */
  opacity: 0.45;
  filter: saturate(0.4);
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

.send-btn.queue-btn {
  background-color: var(--gd-color-primary);
  position: relative;
}

.send-btn.queue-btn:hover:not(:disabled) {
  background-color: var(--gd-color-primary-hover);
}

/* ========== 粘贴文本预览弹窗样式 ========== */

.pasted-preview-text {
  margin: 0;
  padding: 16px;
  background: var(--gd-color-sidebar-bg-hover, #f5f7fa);
  border: 1px solid var(--gd-color-border, #e4e7ed);
  border-radius: 8px;
  font-size: 13px;
  /* 整数行高：13 × 1.7 = 22.1px 会让每行基线落在设备像素之间 */
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Menlo', monospace;
  color: var(--gd-color-text, #303133);
}

/* 窄容器（窄窗口 / 悬浮窗 / 侧栏）：只保留「+、权限（图标）、发送/停止」。
   模型、Token 上限、上下文用量环整体退场；权限与计划模式收起文字，仅留图标。
   放在样式末尾：display:none 需要压过下方各按钮的 display:flex 声明。 */
@container composer (max-width: 380px) {
  .right-actions .model-selector-btn,
  .right-actions .token-limit-control,
  .right-actions .right-actions-before-slot,
  .left-tools .run-mode-label,
  .left-tools .plan-mode-label {
    display: none;
  }
}
</style>