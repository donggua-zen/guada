<template>
  <!-- 起始页：无任何标签 或 点击 + 时显示，不占用标签栏。
       各入口（文件 / 终端 / 新建浏览器 / Git 审阅 / 工作流 / 计划）由父组件处理实际跳转。 -->
  <div class="workspace-start-page">
    <div class="start-content">
      <h2 class="start-title">{{ t('chat.workspace.startPageTitle') }}</h2>
      <p class="start-subtitle">{{ t('chat.workspace.startPageSubtitle') }}</p>
      <div class="start-grid">
        <button class="start-item" @click="emit('open-file')">
          <span class="start-item-icon">
            <el-icon :size="20"><Folder16Regular /></el-icon>
          </span>
          <span class="start-item-label">{{ t('chat.workspace.newFile') }}</span>
        </button>
        <button class="start-item" @click="emit('open-terminal')">
          <span class="start-item-icon">
            <el-icon :size="20"><WindowConsole20Regular /></el-icon>
          </span>
          <span class="start-item-label">{{ t('chat.workspace.terminal') }}</span>
        </button>
        <button class="start-item" @click="emit('open-browser')">
          <span class="start-item-icon">
            <el-icon :size="20"><Globe16Regular /></el-icon>
          </span>
          <span class="start-item-label">{{ t('chat.workspace.newBrowser') }}</span>
        </button>
        <button class="start-item" @click="emit('open-git')">
          <span class="start-item-icon">
            <el-icon :size="20"><Branch20Regular /></el-icon>
          </span>
          <span class="start-item-label">{{ t('chat.workspace.gitTab') }}</span>
        </button>
        <button class="start-item" @click="emit('open-workflow')">
          <span class="start-item-icon">
            <el-icon :size="20"><Flowchart20Regular /></el-icon>
          </span>
          <span class="start-item-label">{{ t('chat.workspace.workflowTab') }}</span>
        </button>
        <!-- 计划：面板常驻入口（无论有无计划都可进入，面板内列出历史计划） -->
        <button class="start-item" @click="emit('open-plan')">
          <span class="start-item-icon">
            <el-icon :size="20"><Notepad20Regular /></el-icon>
          </span>
          <span class="start-item-label">{{ t('chat.workspace.planTab') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Folder16Regular, WindowConsole20Regular, Globe16Regular, Branch20Regular, Flowchart20Regular, Notepad20Regular } from "@vicons/fluent";

const { t } = useI18n();

const emit = defineEmits<{
  "open-file": [];
  "open-terminal": [];
  "open-browser": [];
  "open-git": [];
  "open-workflow": [];
  "open-plan": [];
}>();
</script>

<style scoped>
.workspace-start-page {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  /* 换行后行数变多时允许纵向滚动，而不是被裁切 */
  overflow: auto;
}

.start-content {
  /* margin:auto 在 flex 容器内双向居中；内容超出容器时 auto 归零，
     从左上开始并可滚动，避免 align-items:center 造成顶部内容被裁切 */
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 480px;
}

.start-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--gd-color-text);
}

.start-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--gd-color-text-gray);
}

.start-grid {
  display: grid;
  /* 按可用宽度自适应列数：窄面板 3 列，宽面板一行放下全部入口 */
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
  width: 100%;
  margin-top: 14px;
}

/* 卡片整块承载 icon + 文字；配色统一取 surface 系列变量
   （--gd-color-surface-hover / -border / --gd-size-surface-radius）。
   文字恒用 --gd-color-text：hover 只换背景不换字色，避免文字与背景贴近看不清 */
.start-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 72px;
  padding: 12px 8px;
  border: none;
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface-hover);
  color: var(--gd-color-text);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.start-item:hover {
  background: var(--gd-color-surface-border);
}

.start-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--gd-color-text-gray);
  transition: color 0.15s ease;
}

.start-item:hover .start-item-icon {
  color: var(--gd-color-text);
}

.start-item-label {
  font-size: 12px;
  color: var(--gd-color-text);
  white-space: nowrap;
  transition: color 0.15s ease;
}
</style>
