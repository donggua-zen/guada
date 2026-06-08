<template>
  <div class="input-test-page">
    <h2>ChatInput 技能选择模拟测试</h2>
    <p class="subtitle">完整模拟 ChatInput 外观 + Tiptap 技能选择功能</p>

    <!-- 测试区域 1：功能说明 -->
    <div class="test-section">
      <h3>1. 已实现功能清单</h3>
      <ul class="feature-list">
        <li class="tested">ChatInput 外观模拟（工具栏、按钮、样式）</li>
        <li class="tested">Tiptap 富文本编辑器</li>
        <li class="tested">/ 触发技能选择弹窗</li>
        <li class="tested">弹窗悬浮在输入框上方</li>
        <li class="tested">上下箭头选择、回车确认、Esc 退出</li>
        <li class="tested">空格关闭弹窗</li>
        <li class="tested">技能徽标插入（atom 节点）</li>
        <li class="tested">Backspace 整删徽标</li>
        <li class="tested">左右箭头跨越徽标</li>
        <li class="tested">原始文本 &lt;skill:xxx&gt; 格式输出</li>
        <li class="tested">Enter 发送消息</li>
        <li class="tested">Shift+Enter 换行</li>
      </ul>
    </div>

    <!-- 占位区域，模拟聊天内容 -->
    <div class="test-section chat-mock-area">
      <h3>2. 聊天内容区域（占位）</h3>
      <div class="mock-messages">
        <div class="mock-message assistant">
          <div class="mock-avatar">AI</div>
          <div class="mock-content">你好！有什么我可以帮助你的吗？</div>
        </div>
        <div class="mock-message user">
          <div class="mock-avatar">我</div>
          <div class="mock-content">帮我写一段代码</div>
        </div>
        <div class="mock-message assistant">
          <div class="mock-avatar">AI</div>
          <div class="mock-content">当然可以！请告诉我你需要什么语言的代码，以及具体的功能需求。</div>
        </div>
      </div>
    </div>

    <!-- 测试区域 3：ChatInput 模拟（固定在底部） -->
    <div class="test-section chat-input-section">
      <h3>3. ChatInput 模拟组件</h3>
      <ChatInputMock @send="handleSend" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Node, mergeAttributes } from '@tiptap/core';
import { Tools, Delete } from '@element-plus/icons-vue';

// 自定义 Skill 节点
const SkillNode = Node.create({
  name: 'skill',
  group: 'inline',
  inline: true,
  selectable: false, // 不可选中，光标自动跳过
  atom: true, // 原子节点：整体删除

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
    return [
      {
        tag: 'span[data-type="skill"]',
      },
    ];
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
      node.attrs.name,
    ];
  },

  renderText({ node }) {
    return `<skill:${node.attrs.name}>`;
  },
});

// 编辑器实例
const editor = ref<Editor>();

// 状态
const rawText = ref('');
const htmlStructure = ref('');
const jsonStructure = ref('');
const logs = ref<Array<{ time: string; type: string; msg: string }>>([]);

// 技能选择弹窗状态
const skillPickerVisible = ref(false);
const selectedIndex = ref(0);
const pickerQuery = ref('');
const pickerPosition = ref({ top: 0, left: 0 });

// 模拟技能列表
const allSkills = [
  { id: 'code-reviewer', name: 'code-reviewer', description: '代码审查助手' },
  { id: 'skill-creator', name: 'skill-creator', description: '技能创建工具' },
  { id: 'xiaohu-wechat-format', name: 'xiaohu-wechat-format', description: '微信格式化' },
  { id: 'humanizer-zh', name: 'Humanizer-zh', description: '中文人性化处理' },
  { id: 'skill-installer', name: 'skill-installer', description: '技能安装器' },
];

const filteredSkills = computed(() => {
  if (!pickerQuery.value) return allSkills;
  const q = pickerQuery.value.toLowerCase();
  return allSkills.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q)
  );
});

const pickerStyle = computed(() => ({
  top: `${pickerPosition.value.top}px`,
  left: `${pickerPosition.value.left}px`,
}));

// 功能测试标记
const testedFeatures = ref({
  insert: false,
  deleteWhole: false,
  arrowSkip: false,
  paste: false,
  enter: false,
  clickBadge: false,
  rawSync: false,
});

// 添加日志
const addLog = (type: string, msg: string) => {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  logs.value.unshift({ time, type, msg });
  if (logs.value.length > 50) logs.value.pop();
};

// 同步输出
const syncOutput = () => {
  if (!editor.value) return;
  rawText.value = editor.value.getText();
  htmlStructure.value = editor.value.getHTML();
  jsonStructure.value = JSON.stringify(editor.value.getJSON(), null, 2);
  testedFeatures.value.rawSync = true;
};

// 插入技能徽标
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

  testedFeatures.value.insert = true;
  addLog('insert', `插入技能徽标: ${skillName}`);
  syncOutput();
};

// 从弹窗选择技能后插入
const selectSkill = (skill: typeof allSkills[0]) => {
  if (!editor.value) return;

  // 获取当前光标位置，删除 /query 文本
  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  // 找到 / 的位置（从光标位置向前搜索）
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
  const slashIndex = textBefore.lastIndexOf('/');

  if (slashIndex >= 0) {
    // 删除从 / 到光标位置的内容
    const from = $from.start() + slashIndex;
    const to = $from.pos;
    editor.value.chain().focus().deleteRange({ from, to }).run();
  }

  // 插入技能徽标
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'skill',
      attrs: { name: skill.name },
    })
    .run();

  closeSkillPicker();
  testedFeatures.value.insert = true;
  addLog('insert', `通过弹窗插入技能: ${skill.name}`);
  syncOutput();
};

// 关闭技能选择弹窗
const closeSkillPicker = () => {
  skillPickerVisible.value = false;
  pickerQuery.value = '';
  selectedIndex.value = 0;
};

// 打开技能选择弹窗
const openSkillPicker = (query: string = '') => {
  pickerQuery.value = query;
  selectedIndex.value = 0;
  skillPickerVisible.value = true;

  // 计算弹窗位置（跟随光标）
  nextTick(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const editorEl = document.querySelector('.editor-wrapper');
      if (editorEl) {
        const editorRect = editorEl.getBoundingClientRect();
        pickerPosition.value = {
          top: rect.bottom - editorRect.top + 4,
          left: rect.left - editorRect.left,
        };
      }
    }
  });
};

// 处理弹窗键盘事件
const handlePickerKeydown = (e: KeyboardEvent) => {
  if (!skillPickerVisible.value) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selectedIndex.value = (selectedIndex.value + 1) % filteredSkills.value.length;
      break;
    case 'ArrowUp':
      e.preventDefault();
      selectedIndex.value = (selectedIndex.value - 1 + filteredSkills.value.length) % filteredSkills.value.length;
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

// 处理发送事件
const handleSend = (data: { content: string; files: any[] }) => {
  addLog('send', `发送消息: ${data.content.slice(0, 50)}${data.content.length > 50 ? '...' : ''}`);
};

// 检查是否需要触发技能选择
const checkSkillTrigger = () => {
  if (!editor.value) return;

  const { state } = editor.value;
  const { selection } = state;
  const { $from } = selection;

  // 获取光标前的文本
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');

  // 检查是否是开头输入 / 或 / 前面是空格
  const lastSlashIndex = textBefore.lastIndexOf('/');
  if (lastSlashIndex < 0) {
    closeSkillPicker();
    return;
  }

  // 检查 / 前面是否是开头或空格
  const charBeforeSlash = textBefore[lastSlashIndex - 1];
  if (lastSlashIndex > 0 && charBeforeSlash !== ' ' && charBeforeSlash !== '\n') {
    closeSkillPicker();
    return;
  }

  // 检查 / 后面到光标位置的内容（作为查询条件）
  const query = textBefore.slice(lastSlashIndex + 1);

  // 如果包含空格则关闭弹窗
  if (query.includes(' ')) {
    closeSkillPicker();
    return;
  }

  // 打开弹窗
  openSkillPicker(query);
};

// 清空编辑器
const clearEditor = () => {
  if (!editor.value) return;
  editor.value.chain().clearContent().focus().run();
  addLog('clear', '清空编辑器');
  syncOutput();
};

onMounted(() => {
  editor.value = new Editor({
    extensions: [StarterKit, SkillNode],
    content: '',
    editable: true,
    onUpdate: ({ editor: ed }) => {
      syncOutput();
      checkSkillTrigger();
      addLog('input', '内容变化');
    },
    onCreate: () => {
      syncOutput();
      addLog('init', 'Tiptap 编辑器已创建');
    },
  });

  // 全局监听键盘事件（用于弹窗导航）
  document.addEventListener('keydown', handlePickerKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handlePickerKeydown);
  if (editor.value) {
    editor.value.destroy();
  }
});
</script>

<style scoped>
.input-test-page {
  height: 100vh;
  padding: 20px;
  overflow-y: auto;
  background: #f5f5f5;
}

h2 {
  margin: 0 0 8px 0;
  color: #333;
}

.subtitle {
  color: #666;
  margin-bottom: 20px;
}

.test-section {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.test-section h3 {
  margin: 0 0 12px 0;
  color: #409eff;
  font-size: 16px;
}

/* Tiptap 编辑器样式 */
:deep(.tiptap-editor .ProseMirror) {
  min-height: 120px;
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  border: 2px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.8;
  color: #303133;
  background: #fff;
  outline: none;
  transition: border-color 0.2s;
  white-space: pre-wrap;
  word-wrap: break-word;
}

:deep(.tiptap-editor .ProseMirror:focus) {
  border-color: #409eff;
}

:deep(.tiptap-editor .ProseMirror p) {
  margin: 0;
}

/* 技能徽标样式 - 简化：仅图标+文字，无背景无边框 */
:deep(.skill-badge) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 2px;
  margin: 0 2px;
  color: var(--el-text-color-regular);
  font-size: var(--size-text-base, 14px);
  line-height: 1.8;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
}

:deep(.skill-badge-icon) {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  line-height: 1;
}

:deep(.skill-badge-text) {
  font-size: inherit;
  line-height: inherit;
}

:deep(.skill-badge:hover) {
  color: var(--el-text-color-primary);
}

/* 工具栏 */
.toolbar {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 原始文本输出 */
.raw-output {
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

/* HTML 结构输出 */
.html-output {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 12px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
  word-wrap: break-word;
  min-height: 60px;
  max-height: 200px;
  overflow-y: auto;
}

/* JSON 输出 */
.json-output {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 12px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: #606266;
  white-space: pre-wrap;
  word-wrap: break-word;
  min-height: 60px;
  max-height: 300px;
  overflow-y: auto;
}

/* 日志面板 */
.log-panel {
  background: #1e1e1e;
  border-radius: 4px;
  padding: 8px;
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  margin-bottom: 8px;
}

.log-item {
  padding: 2px 0;
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.log-time {
  color: #6a9955;
  flex-shrink: 0;
}

.log-type {
  padding: 0 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: bold;
  flex-shrink: 0;
  min-width: 50px;
  text-align: center;
}

.log-type.insert { background: #4caf50; color: white; }
.log-type.delete { background: #f44336; color: white; }
.log-type.input { background: #2196f3; color: white; }
.log-type.paste { background: #ff9800; color: white; }
.log-type.navigate { background: #9c27b0; color: white; }
.log-type.click { background: #00bcd4; color: white; }
.log-type.focus { background: #607d8b; color: white; }
.log-type.blur { background: #795548; color: white; }
.log-type.block { background: #ff5722; color: white; }
.log-type.clear { background: #e91e63; color: white; }
.log-type.init { background: #3f51b5; color: white; }

.log-msg {
  color: #d4d4d4;
}

/* 功能列表 */
.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.feature-list li {
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 4px;
  background: #f5f7fa;
  color: #606266;
  transition: all 0.2s;
}

.feature-list li::before {
  content: '○ ';
  color: #c0c4cc;
}

.feature-list li.tested {
  background: #e8f5e9;
  color: #2e7d32;
}

.feature-list li.tested::before {
  content: '✓ ';
  color: #4caf50;
}

/* 技能选择弹窗样式 - VS Code 命令面板风格 */
.skill-picker {
  position: absolute;
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  min-width: 260px;
  max-width: 340px;
  overflow: hidden;
}

.skill-picker-list {
  max-height: 220px;
  overflow-y: auto;
}

.skill-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background 0.1s;
}

.skill-picker-item:hover,
.skill-picker-item.active {
  background: #04395e;
}

.skill-picker-item.active .skill-picker-name {
  color: #ffffff;
}

.skill-picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: #252526;
  color: #75beff;
  flex-shrink: 0;
}

.skill-picker-info {
  flex: 1;
  min-width: 0;
}

.skill-picker-name {
  font-size: 13px;
  font-weight: 500;
  color: #cccccc;
  line-height: 1.4;
}

.skill-picker-desc {
  font-size: 11px;
  color: #808080;
  line-height: 1.3;
  margin-top: 1px;
}

.skill-picker-empty {
  padding: 16px;
  text-align: center;
  color: #808080;
  font-size: 13px;
}

.skill-picker-footer {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
  padding: 5px 10px;
  border-top: 1px solid #3c3c3c;
  background: #252526;
  font-size: 11px;
  color: #808080;
}

.skill-picker-footer kbd {
  display: inline-block;
  padding: 1px 4px;
  border: 1px solid #5a5a5a;
  border-radius: 3px;
  background: #3c3c3c;
  color: #cccccc;
  font-family: inherit;
  font-size: 10px;
  line-height: 1.4;
}

/* 编辑器容器 */
.editor-wrapper {
  position: relative;
}

/* 聊天内容占位区域 */
.chat-mock-area {
  min-height: 300px;
}

.mock-messages {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mock-message {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.mock-message.user {
  flex-direction: row-reverse;
}

.mock-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #409eff;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.mock-message.user .mock-avatar {
  background: #67c23a;
}

.mock-content {
  background: #f5f7fa;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  color: #303133;
  max-width: 70%;
  line-height: 1.6;
}

.mock-message.user .mock-content {
  background: #ecf5ff;
  color: #409eff;
}

/* ChatInput 固定在底部 */
.chat-input-section {
  position: sticky;
  bottom: 0;
  margin-bottom: 0;
  z-index: 100;
}
</style>
