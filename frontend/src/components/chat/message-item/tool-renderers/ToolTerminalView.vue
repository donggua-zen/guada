<template>
  <div class="tool-terminal-wrap">
    <div class="tool-terminal-view">
      <div v-if="sandboxNote" class="term-sandbox">{{ sandboxNote }}</div>
      <div class="term-line term-command">
        <span class="term-prompt">$</span>
        <span class="term-text">{{ command }}</span>
      </div>
      <pre v-if="output" class="term-output" :class="{ 'term-output--error': isError }">{{ output }}</pre>
      <div v-else-if="!executing" class="term-output term-output--empty">{{ t('chat.toolCalls.noOutput') }}</div>

      <!-- 状态行：exit pill（0 绿 / 非零红）+ 耗时 + 后台徽章 -->
      <div v-if="showStatusRow" class="term-status-row">
        <span
          v-if="exitCode !== undefined"
          class="term-pill"
          :class="pillClass"
          :title="processStatus"
        >{{ pillText }}</span>
        <span v-if="uptimeText" class="term-uptime">{{ uptimeText }}</span>
        <span
          v-if="backgrounded && processId"
          class="term-pill term-pill--bg"
          :title="processId"
        >{{ t('chat.toolCalls.terminalBackground') }}</span>
      </div>
    </div>

    <!-- 截断提示条（含完整日志路径） -->
    <div v-if="truncated" class="term-truncated">
      {{ t('chat.toolCalls.terminalTruncated', { path: logFilePath || '-' }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  command: string;
  /** 纯净 stdout（元数据标记已剥离）；未识别时为原始结果文本 */
  output?: string;
  isError?: boolean;
  /** 执行中：不显示输出占位 */
  executing?: boolean;
  /** 退出码；undefined = 未知（无标记），null = 进程异常退出（无退出码） */
  exitCode?: number | null;
  uptimeText?: string;
  processStatus?: string;
  backgrounded?: boolean;
  processId?: string;
  truncated?: boolean;
  logFilePath?: string;
  sandboxNote?: string;
}>();

const showStatusRow = computed(
  () => (props.exitCode !== undefined && !props.executing) || props.backgrounded,
);

const pillText = computed(() => {
  if (props.exitCode === null) return props.processStatus || "exit ?";
  return `exit ${props.exitCode}`;
});

const pillClass = computed(() => {
  if (props.exitCode === null) return "term-pill--error";
  return props.exitCode === 0 ? "term-pill--ok" : "term-pill--error";
});
</script>

<style scoped>
/* 亮色：白底 + 灰边框（与 diff/内容视图一致的表面色）；暗色（html.dark）翻转为深色终端 */
.tool-terminal-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 终端区块由外层展开卡片（tool-result-inline）提供边框与底色，这里只管排版；
   暗色模式下卡片本身即为深色表面。 */
.tool-terminal-view {
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 12px;
  line-height: 1.6;
}

.term-sandbox {
  color: #8a8a8a;
  font-size: 11px;
  margin-bottom: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.term-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.term-command {
  color: #383838;
}

.term-prompt {
  color: #1a7f37;
  margin-right: 6px;
  user-select: none;
}

.term-output {
  margin: 6px 0 0;
  max-height: 170px;
  overflow-y: auto;
  overflow-x: hidden;
  color: #57606a;
  white-space: pre-wrap;
  word-break: break-all;
}

.term-output--error {
  color: var(--el-color-danger);
}

.term-output--empty {
  color: #a8a8a8;
  font-style: italic;
}

.term-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.term-pill {
  display: inline-block;
  padding: 0 8px;
  border-radius: 9px;
  font-size: 11px;
  line-height: 18px;
  user-select: none;
}

.term-pill--ok {
  background: rgba(var(--el-color-success-rgb, 103, 194, 58), 0.14);
  color: var(--el-color-success);
}

.term-pill--error {
  background: rgba(var(--el-color-danger-rgb, 245, 108, 108), 0.14);
  color: var(--el-color-danger);
}

.term-pill--bg {
  background: rgba(var(--el-color-primary-rgb, 64, 158, 255), 0.12);
  color: var(--el-color-primary);
}

.term-uptime {
  color: #8a8a8a;
  font-size: 11px;
}

.term-truncated {
  font-size: 11px;
  color: var(--el-color-warning);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  word-break: break-all;
}

/* 暗色模式：文字色调亮（卡片底色由 tool-result-inline 的表面变量翻转为深色） */

html.dark .term-sandbox {
  color: #9a9a9a;
}

html.dark .term-command {
  color: #d4d4d4;
}

html.dark .term-prompt {
  color: #6a9955;
}

html.dark .term-output {
  color: #b8b8b8;
}

html.dark .term-output--error {
  color: #f48771;
}

html.dark .term-output--empty {
  color: #6a6a6a;
}

html.dark .term-pill--ok {
  background: rgba(106, 153, 85, 0.25);
  color: #8bd17c;
}

html.dark .term-pill--error {
  background: rgba(244, 135, 113, 0.18);
  color: #f48771;
}

html.dark .term-pill--bg {
  background: rgba(86, 156, 214, 0.2);
  color: #6cb2f5;
}

html.dark .term-uptime {
  color: #8a8a8a;
}
</style>
