<template>
  <!-- 起始页：无任何标签 或 点击 + 时显示，不占用标签栏。
       三个入口（打开文件 / 新建浏览器 / Git 审阅）由父组件处理实际跳转。 -->
  <div class="workspace-start-page">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Folder16Regular, WindowConsole20Regular, Globe16Regular, Branch20Regular } from "@vicons/fluent";

const { t } = useI18n();

const emit = defineEmits<{
  "open-file": [];
  "open-terminal": [];
  "open-browser": [];
  "open-git": [];
}>();
</script>

<style scoped>
.workspace-start-page {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.start-grid {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 统一使用 surface 变量家族（--gd-color-surface / -hover / -border / --gd-size-surface-radius），
   不引入 primary 或自定义颜色，与 BotCard 等卡片 hover 风格一致 */
.start-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border: none;
  border-radius: var(--gd-size-surface-radius);
  background: transparent;
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
  width: 44px;
  height: 44px;
  border-radius: var(--gd-size-surface-radius);
  color: var(--gd-color-text-gray);
  background: var(--gd-color-surface-hover);
  transition: color 0.15s ease, background-color 0.15s ease;
}

.start-item:hover .start-item-icon {
  color: var(--gd-color-text);
  background: var(--gd-color-surface-border);
}

.start-item-label {
  font-size: 12px;
  color: var(--gd-color-text-gray);
  white-space: nowrap;
  transition: color 0.15s ease;
}

.start-item:hover .start-item-label {
  color: var(--gd-color-text);
}
</style>
