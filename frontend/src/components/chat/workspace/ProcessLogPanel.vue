<template>
  <div class="process-log-panel h-full flex flex-col">
    <!-- 头部：命令摘要 + 状态 + 时长 + 操作 -->
    <div class="pl-header shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-[#2e3035]">
      <span class="pl-command" :title="log?.command || command">{{ log?.command || command }}</span>
      <span class="pl-status" :class="statusClass">
        <span v-if="isRunning" class="pl-spinner"></span>
        <span v-else class="pl-dot"></span>
        {{ statusText }}
      </span>
      <span class="pl-elapsed">{{ elapsedText }}</span>
      <div class="flex-1"></div>
      <GdTooltip :content="t('chat.workspace.refresh')" placement="bottom">
        <button class="pl-btn" @click="fetchLog" :disabled="loading">
          <el-icon size="14" :class="{ 'is-loading': loading }"><Refresh /></el-icon>
        </button>
      </GdTooltip>
      <GdTooltip v-if="isRunning" :content="t('chat.workspace.killProcess')" placement="bottom">
        <button class="pl-btn pl-btn-danger" @click="killProcess">
          <el-icon size="14"><CloseBold /></el-icon>
        </button>
      </GdTooltip>
    </div>

    <!-- 日志正文 -->
    <div ref="logContainer" class="flex-1 min-h-0 overflow-auto pl-body" @scroll="onScroll">
      <pre v-if="log?.content" class="pl-content">{{ log.content }}</pre>
      <div v-else-if="loading" class="pl-empty">{{ t('common.loading') }}</div>
      <div v-else-if="gone" class="pl-empty">{{ t('chat.workspace.processLogGone') }}</div>
      <div v-else class="pl-empty">{{ t('chat.workspace.processLogEmpty') }}</div>
    </div>

    <!-- 底部提示：尾部截断 -->
    <div v-if="log?.truncated" class="shrink-0 px-3 py-1 text-xs text-gray-400 dark:text-[#6b6d73] border-t border-gray-100 dark:border-[#2e3035]">
      {{ t('chat.workspace.processLogTruncated', { size: formatBytes(log.size) }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { Refresh, CloseBold } from '@element-plus/icons-vue';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import { apiService, type UiProcessLog } from '@/services/ApiService';
import { useTabStore } from '@/stores/tab';

const props = defineProps<{
    sessionId: string;
    processId: string;
    command: string;
    tabKey: string;
}>();

const { t } = useI18n();
const tabStore = useTabStore();

const log = ref<UiProcessLog | null>(null);
const loading = ref(false);
const logContainer = ref<HTMLElement | null>(null);
/** 跟随尾部：用户滚动到底部附近时新输出自动下滚，向上翻阅时不打扰 */
const followTail = ref(true);
/** 进程不存在（404 且从未拿到过日志，如刷新后恢复的旧标签） */
const gone = ref(false);

const isRunning = computed(() => log.value?.status === 'running');

const statusClass = computed(() => ({
    running: isRunning.value,
    completed: log.value?.status === 'completed',
    killed: log.value?.status === 'killed',
    error: log.value?.status === 'error',
}));

const statusText = computed(() => {
    switch (log.value?.status) {
        case 'running': return t('chat.workspace.processRunning');
        case 'completed': return t('chat.workspace.processCompleted');
        case 'killed': return t('chat.workspace.processKilled');
        case 'error': return t('chat.workspace.processError');
        default: return '';
    }
});

/** 运行时长：运行中按 startedAt 实时计算，结束后用 finishedAt - startedAt */
const now = ref(Date.now());
let nowTimer: number | null = null;

const elapsedText = computed(() => {
    if (!log.value?.startedAt) return '';
    const start = new Date(log.value.startedAt).getTime();
    const end = log.value.finishedAt ? new Date(log.value.finishedAt).getTime() : now.value;
    return formatDuration(Math.max(0, end - start));
});

function formatDuration(ms: number): string {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${String(sec % 60).padStart(2, '0')}s`;
    const hour = Math.floor(min / 60);
    return `${hour}h ${String(min % 60).padStart(2, '0')}m`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── 拉取与轮询 ──

let pollTimer: number | null = null;

function stopPolling(): void {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

async function fetchLog(): Promise<void> {
    loading.value = true;
    try {
        const res = await apiService.getSessionProcessLog(props.sessionId, props.processId);
        log.value = res;
        if (res.status !== 'running') stopPolling();
    } catch (e: any) {
        // 404 = 进程已结束且被清理（退出即从注册表消失）
        if (e?.response?.status === 404) {
            stopPolling();
            if (!log.value) gone.value = true;
        } else {
            console.error('[ProcessLogPanel] Failed to fetch log:', e);
        }
    } finally {
        loading.value = false;
    }
}

function startPolling(): void {
    void fetchLog();
    pollTimer = window.setInterval(() => { void fetchLog(); }, 2000);
}

// ── 终止进程 ──

async function killProcess(): Promise<void> {
    try {
        await apiService.killSessionProcess(props.sessionId, props.processId);
        ElMessage.success(t('chat.workspace.processKilledToast'));
        await fetchLog();
    } catch (e: any) {
        if (e?.response?.status !== 404) {
            console.error('[ProcessLogPanel] Failed to kill process:', e);
            ElMessage.error(t('chat.workspace.processKillFailed'));
        }
    }
}

// ── 滚动跟随 ──

function onScroll(): void {
    const el = logContainer.value;
    if (!el) return;
    followTail.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

watch(() => log.value?.content, async () => {
    if (!followTail.value) return;
    await nextTick();
    const el = logContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
});

// 终止后标签元数据保持原状（进程退出即从列表消失，标签由用户手动关闭）

onMounted(() => {
    startPolling();
    nowTimer = window.setInterval(() => { now.value = Date.now(); }, 1000);
});

onUnmounted(() => {
    stopPolling();
    if (nowTimer !== null) {
        clearInterval(nowTimer);
        nowTimer = null;
    }
});
</script>

<style scoped>
.pl-header {
    gap: 8px;
}
.pl-command {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    color: var(--gd-color-text);
}
.pl-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    font-size: 12px;
}
.pl-status.running { color: var(--gd-color-primary, #3b82f6); }
.pl-status.completed { color: #1a7f37; }
.pl-status.killed { color: var(--gd-color-text-gray); }
.pl-status.error { color: #cf222e; }
.pl-spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--gd-color-primary-200, #93c5fd);
    border-top-color: var(--gd-color-primary, #3b82f6);
    border-radius: 50%;
    animation: pl-spin 0.8s linear infinite;
}
.pl-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
}
@keyframes pl-spin {
    to { transform: rotate(360deg); }
}
.pl-elapsed {
    flex-shrink: 0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    color: var(--gd-color-text-gray);
}
.pl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    transition: all 0.15s;
}
.pl-btn:hover:not(:disabled) {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}
.pl-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.pl-btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
}
.pl-body {
    background: var(--gd-color-surface);
}
.pl-content {
    margin: 0;
    padding: 10px 12px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--gd-color-text);
}
.pl-empty {
    padding: 24px 12px;
    text-align: center;
    font-size: 12px;
    color: var(--gd-color-text-disabled);
}
</style>
