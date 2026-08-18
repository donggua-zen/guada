<template>
  <!-- 提交弹窗（自定义 GdDialog，极简卡片风格）：分支行 + 无边框输入 + 包含未暂存
       + 统计 + 堆叠操作行（提交/提交并推送/推送）。无标题栏，点遮罩/Esc 关闭。
       数据与提交/推送逻辑全部走 GitStore，供概览面板与 Git 变更面板双入口共用。 -->
  <GdDialog :model-value="git.commitDialogVisible" width="440px" append-to-body :show-close="false"
    class="git-commit-dialog" @update:model-value="git.commitDialogVisible = $event">
    <div class="git-commit-form">
      <!-- 分支行（仅展示当前分支，暂不支持下拉，故无箭头） -->
      <div class="git-cd-branch">
        <el-icon :size="16"><Branch20Regular /></el-icon>
        <span class="git-cd-branch-name">{{ git.selectedBranch || '-' }}</span>
      </div>
      <!-- 提交信息：无边框极简输入（图片同款，只有光标提示） -->
      <textarea v-model="git.commitMessage" class="git-cd-message" rows="6"
        :placeholder="t('git.commitMessagePlaceholder')"
        @keydown.ctrl.enter="git.submitCommit(false)" @keydown.meta.enter="git.submitCommit(false)"></textarea>
      <!-- 包含未暂存（自定义 checkbox 行）+ 右侧统计（随勾选切换：勾选=全部变更，否则=仅暂存） -->
      <div class="git-cd-row">
        <button type="button" class="git-cd-check" :class="{ checked: git.commitIncludeUnstaged }"
          @click="git.commitIncludeUnstaged = !git.commitIncludeUnstaged">
          <span class="git-cd-check-box">
            <el-icon v-if="git.commitIncludeUnstaged" :size="10"><Check /></el-icon>
          </span>
          <span>{{ t('git.includeUnstaged') }}</span>
        </button>
        <span v-if="git.commitStats.add || git.commitStats.del" class="git-diff-stats git-cd-stats">
          <span v-if="git.commitStats.add" class="text-[#1a7f37] dark:text-[#3fb950]">+{{ git.commitStats.add }}</span>
          <span v-if="git.commitStats.del" class="text-[#cf222e] dark:text-[#f85149]">-{{ git.commitStats.del }}</span>
        </span>
      </div>
      <!-- 堆叠操作行：提交（高亮 + Ctrl+↵ 提示）/ 提交并推送 / 推送（无领先提交时禁用） -->
      <div class="git-cd-actions">
        <button type="button" class="git-cd-action git-cd-action--primary" :disabled="git.committing"
          @click="git.submitCommit(false)">
          <el-icon :size="16"><BranchFork16Regular /></el-icon>
          <span class="git-cd-action-label">{{ t('git.commit') }}</span>
          <span class="git-cd-action-hint">Ctrl + ↵</span>
        </button>
        <button type="button" class="git-cd-action" :disabled="git.committing" @click="git.submitCommit(true)">
          <el-icon :size="16"><ArrowUpload16Regular /></el-icon>
          <span class="git-cd-action-label">{{ t('git.commitAndPush') }}</span>
        </button>
        <button type="button" class="git-cd-action" :disabled="git.committing || (git.status?.ahead ?? 0) === 0"
          @click="git.handlePush">
          <el-icon :size="16"><ArrowUpload16Regular /></el-icon>
          <span class="git-cd-action-label">{{ t('git.push') }}</span>
        </button>
      </div>
    </div>
  </GdDialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Check } from "@element-plus/icons-vue";
import { Branch20Regular, BranchFork16Regular, ArrowUpload16Regular } from "@vicons/fluent";
import GdDialog from "../../ui/GdDialog.vue";
import { useGitStore } from "@/stores/git";

const { t } = useI18n();
const git = useGitStore();
</script>

<style scoped>
/* 与 GitChangesPanel 弹窗一致（极简卡片风格）；行样式变量用项目通用色 */
.git-commit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-commit-dialog :deep(.l-dialog__body) {
  padding: 12px 12px 10px;
  overflow: visible;
}

/* 分支行：图标 + 等宽分支名（仅展示当前分支） */
.git-cd-branch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 6px;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--gd-size-text-sm);
  color: var(--gd-color-text);
}
.git-cd-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 提交信息：无边框极简输入 */
.git-cd-message {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  padding: 2px;
  font-size: var(--gd-size-text-sm);
  line-height: 1.5;
  font-family: inherit;
  color: var(--gd-color-text);
}
.git-cd-message::placeholder {
  color: var(--gd-color-text-disabled);
}

/* 复选行 + 右侧统计 */
.git-cd-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.git-cd-check {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: none;
  background: transparent;
  font-size: var(--gd-size-text-sm);
  color: var(--gd-color-text);
  cursor: pointer;
  user-select: none;
}
.git-cd-check-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 1px solid var(--gd-color-border);
  border-radius: 3px;
  color: #fff;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.git-cd-check.checked .git-cd-check-box {
  background: var(--gd-color-primary);
  border-color: var(--gd-color-primary);
}
.git-cd-stats {
  font-size: var(--gd-size-text-sm);
}

/* 堆叠操作行 */
.git-cd-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.git-cd-action {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: var(--gd-size-text-sm);
  color: var(--gd-color-text);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.git-cd-action:hover:not(:disabled) {
  background: var(--gd-color-sidebar-bg-hover);
}
.git-cd-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.git-cd-action--primary {
  background: var(--gd-color-surface-hover);
}
.git-cd-action--primary:hover:not(:disabled) {
  background: var(--gd-color-conversation-bg-active);
}
.git-cd-action-label {
  flex: 1;
}
.git-cd-action-hint {
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}
</style>
