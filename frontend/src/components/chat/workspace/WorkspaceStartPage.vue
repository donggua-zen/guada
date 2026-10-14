<template>
  <!-- 起始页：无任何标签 或 点击 + 时显示，不占用标签栏。
       各入口（文件 / 终端 / 新建浏览器 / Git 审阅 / 工作流 / 计划）由父组件处理实际跳转。 -->
  <div class="workspace-start-page">
    <div class="start-content">
      <div class="start-list">
        <button class="start-item" @click="emit('open-file')">
          <span class="start-item-icon">
            <el-icon :size="18"><Folder16Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.newFile') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPageFileDesc') }}</span>
          </span>
        </button>
        <button class="start-item" @click="emit('open-terminal')">
          <span class="start-item-icon">
            <el-icon :size="18"><WindowConsole20Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.terminal') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPageTerminalDesc') }}</span>
          </span>
        </button>
        <button class="start-item" @click="emit('open-browser')">
          <span class="start-item-icon">
            <el-icon :size="18"><Globe16Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.newBrowser') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPageBrowserDesc') }}</span>
          </span>
        </button>
        <button class="start-item" @click="emit('open-git')">
          <span class="start-item-icon">
            <el-icon :size="18"><Branch20Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.gitTab') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPageGitDesc') }}</span>
          </span>
        </button>
        <!-- 子代理：面板常驻入口（无论有无子代理都可进入，面板内列出活跃 + 已结束回放） -->
        <button class="start-item" @click="emit('open-subagents')">
          <span class="start-item-icon">
            <el-icon :size="18"><Bot20Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.subagents') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPageSubagentDesc') }}</span>
          </span>
        </button>
        <!-- 工作流：面板常驻入口（无论有无运行都可进入，面板内列出历史 run） -->
        <button class="start-item" @click="emit('open-workflow')">
          <span class="start-item-icon">
            <el-icon :size="18"><Flowchart20Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.workflowTab') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPageWorkflowDesc') }}</span>
          </span>
        </button>
        <!-- 计划：面板常驻入口（无论有无计划都可进入，面板内列出历史计划） -->
        <button class="start-item" @click="emit('open-plan')">
          <span class="start-item-icon">
            <el-icon :size="18"><Notepad20Regular /></el-icon>
          </span>
          <span class="start-item-text">
            <span class="start-item-title">{{ t('chat.workspace.planTab') }}</span>
            <span class="start-item-desc">{{ t('chat.workspace.startPagePlanDesc') }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Folder16Regular, WindowConsole20Regular, Globe16Regular, Branch20Regular, Bot20Regular, Flowchart20Regular, Notepad20Regular } from "@vicons/fluent";

const { t } = useI18n();

const emit = defineEmits<{
  "open-file": [];
  "open-terminal": [];
  "open-browser": [];
  "open-git": [];
  "open-subagents": [];
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
  width: 100%;
  max-width: 340px;
}

.start-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

/* 卡片：左侧图标块 + 右侧「标题 / 描述」两行。
   配色统一取 surface 系列变量（--gd-color-surface / -border / -hover / --gd-size-surface-radius）。 */
.start-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid var(--gd-color-surface-border);
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  color: var(--gd-color-text);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.start-item:hover {
  background: var(--gd-color-surface-hover);
}

.start-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--gd-color-surface-hover);
  color: var(--gd-color-text-gray);
  transition: color 0.15s ease;
}

.start-item:hover .start-item-icon {
  color: var(--gd-color-text);
}

.start-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* min-width:0 让描述可以正常截断，而不是把卡片撑宽 */
  min-width: 0;
}

.start-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--gd-color-text);
  line-height: 1.3;
}

.start-item-desc {
  font-size: 12px;
  color: var(--gd-color-text-gray);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
