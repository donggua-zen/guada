<template>
  <div class="w-full flex flex-col items-center">
    <!-- 输入框区域 -->
    <div class="input-area p-[16px_12px_10px_12px] min-h-15 w-full bg-white dark:bg-[#252525]"
      :class="styleClass">

      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
        <div v-for="file in uploadFiles" :key="file.id"
          class="file-tag flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-xs">
          <span>{{ file.displayName }}</span>
          <button @click="removeFile(file.id)" class="text-gray-500 hover:text-red-500">x</button>
        </div>
      </div>

      <!-- 已选知识库标签显示区域 -->
      <div class="kb-list flex flex-wrap gap-2 mb-1.5 mx-1.5" v-if="selectedKnowledgeBases.length > 0">
        <el-tag v-for="kb in selectedKnowledgeBases" :key="kb.id" closable type="info"
          @close="removeKnowledgeBase(kb.id)" class="text-xs">
          <span class="flex items-center gap-1">
            <el-icon size="14"><BookSearch24Regular /></el-icon>
            {{ kb.name }}
          </span>
        </el-tag>
      </div>

      <!-- Tiptap 编辑器（替换 textarea） -->
      <div class="editor-container">
        <editor-content :editor="editor" class="message-editor" />
        <!-- 技能选择弹窗 -->
        <div v-if="skillPickerVisible" class="skill-picker absolute left-0 right-0 z-[1000] p-2 rounded-xl bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#3c3c3c] shadow-[0_-4px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.4)] overflow-hidden" style="bottom: calc(100% + 20px);">
          <div class="skill-picker-list max-h-[200px] overflow-y-auto">
            <div v-for="(skill, index) in filteredSkills" :key="skill.id"
              class="skill-picker-item flex items-center px-1 py-1 cursor-pointer transition-colors duration-150 rounded-lg hover:bg-gray-100 dark:hover:bg-[#3c3c3c] active:bg-gray-100 dark:active:bg-[#3c3c3c]"
              :class="{ 'bg-gray-100 dark:bg-[#3c3c3c]': index === selectedIndex }"
              @click="selectSkill(skill)" @mouseenter="selectedIndex = index">
              <div class="skill-picker-content flex items-center gap-2 w-full">
                <span class="skill-picker-icon flex items-center justify-center w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0">
                  <el-icon size="16"><Apps20Regular /></el-icon>
                </span>
                <div class="skill-picker-info flex items-center gap-2 flex-1 min-w-0">
                  <div class="skill-picker-name text-sm text-gray-800 dark:text-gray-200" :class="{ 'text-blue-500 dark:text-[#75beff]': index === selectedIndex }">{{ skill.name }}</div>
                  <div class="skill-picker-desc text-xs text-gray-500 dark:text-gray-500">{{ skill.description }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="filteredSkills.length === 0" class="skill-picker-empty p-4 text-center text-gray-500 dark:text-gray-500 text-[13px]">
            未找到匹配的技能
          </div>
        </div>
      </div>

      <!-- 隐藏的文件输入框 -->
      <input type="file" ref="fileInputRef" style="display: none" multiple @change="handleFileSelect">
      <input type="file" ref="imageInputRef" style="display: none" multiple @change="handleImageSelect">

      <div class="input-actions w-full flex justify-between mt-2">
        <div class="tools left-tools flex gap-0.5 items-center">
          <!-- 图片按钮 -->
          <el-tooltip content="添加图片" placement="top">
            <el-button class="tool-btn" @click="triggerImageInput" text>
              <el-icon size="22"><Image24Regular /></el-icon>
            </el-button>
          </el-tooltip>
          <!-- 附件按钮 -->
          <el-tooltip content="上传文件" placement="top">
            <el-button class="tool-btn" @click="triggerFileInput" text>
              <el-icon size="22"><Attach24Regular /></el-icon>
            </el-button>
          </el-tooltip>
          <!-- 知识库按钮 -->
          <el-tooltip content="知识库" placement="top">
            <el-button class="tool-btn" @click="openKnowledgeBasePanel" text>
              <el-icon size="22"><BookSearch24Regular /></el-icon>
            </el-button>
          </el-tooltip>
          <!-- 技能按钮（新增） -->
          <el-tooltip content="选择技能 /" placement="top">
            <el-button class="tool-btn" @click="insertSkill('code-reviewer')" text>
              <el-icon size="22"><Tools /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <div class="right-actions">
          <!-- 模型选择按钮 -->
          <el-button plain class="model-selector-btn rounded-full overflow-hidden flex items-center justify-center">
            <div class="flex items-center gap-1.5" style="height:24px; max-width: 200px;">
              <span class="text-sm font-medium truncate flex-1 min-w-0"
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {{ currentModelName }}
              </span>
            </div>
          </el-button>
          <div class="tools right-tools">
            <el-tooltip content="会话设置" placement="top">
              <el-button class="tool-btn" text>
                <el-icon size="22"><Settings24Regular /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
          <div>
            <el-tooltip v-if="!streaming" content="发送" placement="top">
              <el-button class="send-btn" type="primary" @click="sendMessage" circle
                :disabled="!rawText.trim()" :icon="Send24Filled" />
            </el-tooltip>
            <el-tooltip v-else content="停止生成" placement="top">
              <el-button class="send-btn stop-btn" @click="abortResponse" circle type="danger"
                :icon="Stop24Filled" />
            </el-tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- 工作目录按钮 -->
    <div class="mt-1 w-full flex justify-start px-1">
      <el-button class="tool-btn mr-0.5" text>
        <el-icon size="22"><FolderOpen24Regular /></el-icon>
        <span class="text-xs font-medium">打开工作目录</span>
      </el-button>
    </div>

    <!-- 测试输出区域 -->
    <div class="test-output w-full mt-4 px-4">
      <el-divider />
      <h4 class="text-sm font-medium text-gray-600 mb-2">原始文本（发送给后端的内容）</h4>
      <pre class="raw-text-output">{{ rawText || '(空)' }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Node, mergeAttributes } from '@tiptap/core';
import {
  Image24Regular, Attach24Regular, Send24Filled, Stop24Filled,
  Settings24Regular, BookSearch24Regular, FolderOpen24Regular,
  Apps20Regular
} from '@vicons/fluent';
import { Tools } from '@element-plus/icons-vue';

// ==================== 自定义 Skill 节点 ====================
const SkillNode = Node.create({
  name: 'skill',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-skill-name'),
        renderHTML: (attributes) => ({
          'data-skill-name': attributes.name,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="skill"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'skill',
          class: 'skill-badge',
          contenteditable: 'false',
        },
        HTMLAttributes
      ),
      ['span', { class: 'skill-badge-slash' }, '/'],
      ['span', { class: 'skill-badge-text' }, node.attrs.name],
    ];
  },

  renderText({ node }) {
    return `<skill:${node.attrs.name}>`;
  },
});

// ==================== Props & Emits ====================
const props = defineProps({
  streaming: { type: Boolean, default: false },
  mode: { type: String, default: 'chat' },
});

const emit = defineEmits(['send', 'abort']);

// ==================== 状态 ====================
const editor = ref<Editor>();
const rawText = ref('');
const focused = ref(false);
const isInputExpanded = ref(false);
const fileInputRef = ref<HTMLInputElement>();
const imageInputRef = ref<HTMLInputElement>();

// 技能选择弹窗状态
const skillPickerVisible = ref(false);
const selectedIndex = ref(0);
const pickerQuery = ref('');
// 模拟数据
const currentModelName = ref('GPT-4o');
const uploadFiles = ref<any[]>([]);
const selectedKnowledgeBases = ref<any[]>([]);
let fileIdCounter = 0;

const allSkills = [
  { id: 'code-reviewer', name: 'code-reviewer', description: '代码审查助手' },
  { id: 'skill-creator', name: 'skill-creator', description: '技能创建工具' },
  { id: 'xiaohu-wechat-format', name: 'xiaohu-wechat-format', description: '微信格式化' },
  { id: 'humanizer-zh', name: 'Humanizer-zh', description: '中文人性化处理' },
  { id: 'skill-installer', name: 'skill-installer', description: '技能安装器' },
  { id: 'pdf-parser', name: 'PDF Parser', description: 'PDF文档解析' },
  { id: 'image-ocr', name: 'Image OCR', description: '图片文字识别' },
  { id: 'translator', name: 'Translator', description: '多语言翻译' },
  { id: 'summarizer', name: 'Summarizer', description: '文本摘要生成' },
  { id: 'sql-helper', name: 'SQL Helper', description: 'SQL语句辅助' },
  { id: 'regex-tester', name: 'Regex Tester', description: '正则表达式测试' },
  { id: 'json-formatter', name: 'JSON Formatter', description: 'JSON格式化工具' },
  { id: 'markdown-render', name: 'Markdown Render', description: 'Markdown渲染' },
  { id: 'api-tester', name: 'API Tester', description: 'API接口测试' },
  { id: 'git-helper', name: 'Git Helper', description: 'Git命令助手' },
];

// ==================== 计算属性 ====================
const styleClass = computed(() => {
  const classes: string[] = [];
  if (isInputExpanded.value) classes.push('expanded');
  classes.push('rounded-[22px]');
  if (focused.value) {
    classes.push('shadow-[0_2px_22px_rgba(0,0,0,0.16)] dark:shadow-none');
    classes.push('border border-gray-300 dark:border-transparent');
  } else {
    classes.push('shadow-[0_2px_12px_rgba(0,0,0,0.11)] dark:shadow-none');
    classes.push('border border-gray-300 dark:border-transparent');
  }
  return classes.join(' ');
});

const filteredSkills = computed(() => {
  if (!pickerQuery.value) return allSkills;
  const q = pickerQuery.value.toLowerCase();
  return allSkills.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q)
  );
});



// ==================== 编辑器初始化 ====================
onMounted(() => {
  editor.value = new Editor({
    extensions: [StarterKit, SkillNode],
    content: '',
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
        // Enter 发送消息
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendMessage();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      rawText.value = ed.getText();
      checkSkillTrigger();
    },
    onFocus: () => {
      focused.value = true;
    },
    onBlur: () => {
      focused.value = false;
      // 延迟关闭弹窗，允许点击弹窗项
      setTimeout(() => {
        if (!document.querySelector('.skill-picker:hover')) {
          closeSkillPicker();
        }
      }, 200);
    },
  });
});

onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.destroy();
  }
});

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

const selectSkill = (skill: typeof allSkills[0]) => {
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

  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'skill',
      attrs: { name: skill.name },
    })
    .run();

  closeSkillPicker();
  rawText.value = editor.value.getText();
};

const insertSkill = (skillName: string) => {
  if (!editor.value) return;
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'skill',
      attrs: { name: skillName },
    })
    .run();
  rawText.value = editor.value.getText();
};

// ==================== 文件处理 ====================
const triggerFileInput = () => fileInputRef.value?.click();
const triggerImageInput = () => imageInputRef.value?.click();

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (!target.files) return;
  for (const file of Array.from(target.files)) {
    uploadFiles.value.push({
      id: fileIdCounter++,
      displayName: file.name,
      file,
    });
  }
  target.value = '';
};

const handleImageSelect = (event: Event) => {
  handleFileSelect(event);
};

const removeFile = (fileId: number) => {
  const index = uploadFiles.value.findIndex(f => f.id === fileId);
  if (index !== -1) uploadFiles.value.splice(index, 1);
};

// ==================== 知识库 ====================
const openKnowledgeBasePanel = () => {
  // 模拟切换知识库
  if (selectedKnowledgeBases.value.length === 0) {
    selectedKnowledgeBases.value = [{ id: '1', name: '默认知识库' }];
  } else {
    selectedKnowledgeBases.value = [];
  }
};

const removeKnowledgeBase = (kbId: string) => {
  selectedKnowledgeBases.value = selectedKnowledgeBases.value.filter(kb => kb.id !== kbId);
};

// ==================== 发送消息 ====================
const sendMessage = () => {
  if (!rawText.value.trim() && uploadFiles.value.length === 0) return;

  emit('send', {
    content: rawText.value,
    files: uploadFiles.value,
  });

  // 清空
  editor.value?.chain().clearContent().focus().run();
  uploadFiles.value = [];
  rawText.value = '';
};

const abortResponse = () => {
  emit('abort');
};
</script>

<style scoped>
/* 输入框区域样式 */
.input-area {
  position: relative;
  z-index: 10;
}

/* Tiptap 编辑器样式 - 模拟 textarea */
:deep(.message-editor .ProseMirror) {
  width: 100%;
  min-height: 45px;
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

/* 编辑器容器（用于弹窗定位） */
.editor-container {
  position: relative;
}

/* 技能徽标样式 - 纯文本效果，与普通文本完全一致 */
:deep(.skill-badge) {
  display: inline;
  color: var(--el-color-primary);
  font-size: inherit;
  line-height: inherit;
  cursor: pointer;
  user-select: none;
}

:deep(.skill-badge-slash) {
  color: var(--el-color-primary);
  font-size: inherit;
  line-height: inherit;
}

:deep(.skill-badge-text) {
  color: var(--el-color-primary);
  font-size: inherit;
  line-height: inherit;
}

/* 技能选择弹窗样式 - 悬浮在输入框上方 */
.skill-picker {
  position: absolute;
  bottom: calc(100% + 20px);
  left: 0;
  right: 0;
  z-index: 1000;
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
}

.skill-picker-desc {
  font-size: 12px;
  line-height: 1.4;
}

.skill-picker-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
}

/* 工具栏 */
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

/* 模型选择器按钮 */
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

/* 测试输出 */
.test-output {
  max-width: 800px;
}

.raw-text-output {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 12px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #606266;
  white-space: pre-wrap;
  word-wrap: break-word;
  min-height: 60px;
  max-height: 200px;
  overflow-y: auto;
}

/* 文件标签 */
.file-tag {
  display: inline-flex;
  align-items: center;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .model-selector-btn {
    display: none !important;
  }
}
</style>
