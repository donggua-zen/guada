<template>
  <div class="process-log-panel h-full flex flex-col">
    <!-- 头部：命令摘要 + 状态 + 操作 -->
    <div class="pl-header shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-[#2e3035]">
      <span class="pl-command" :title="log?.command || command">{{ log?.command || command }}</span>
      <span class="pl-status" :class="statusClass">
        <span v-if="isRunning" class="pl-spinner"></span>
        <span v-else class="pl-dot"></span>
        {{ statusText }}
      </span>
      <div class="flex-1"></div>
      <GdTooltip :content="t('chat.workspace.refresh')" placement="bottom">
        <button class="pl-btn" @click="fetchLog('initial')" :disabled="loading">
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
      <!-- 原始命令：sticky 常驻正文顶部，滚动翻日志时也知道这条日志是哪条命令产生的。
           头部那条会被宽限与省略号截断，这里给一份随时可读的（超长命令默认折两行，点击展开） -->
      <div v-if="commandLine" class="pl-cmdline sticky top-0 z-10 px-3 py-1.5 border-b border-gray-100 dark:border-[#2e3035]"
        :class="{ 'pl-cmdline--expanded': commandExpanded }" :title="commandLine"
        @click="commandExpanded = !commandExpanded">{{ commandLine }}</div>
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
import { apiService, type UiJobOutput } from '@/services/ApiService';
import { useJobsStore } from '@/stores/jobs';
import { getApiErrorStatus } from '@/utils/errorMessage';

const props = defineProps<{
    sessionId: string;
    jobId: string;
    command: string;
    tabKey: string;
}>();

const { t } = useI18n();
const jobsStore = useJobsStore();

interface JobLogView {
    jobId: string;
    command: string;
    status: string;
    exitCode: number | null;
    size: number;
    truncated: boolean;
    content: string;
    logFilePath?: string;
}

const log = ref<JobLogView | null>(null);
const loading = ref(false);
const logContainer = ref<HTMLElement | null>(null);
const followTail = ref(true);
const gone = ref(false);
/** 下一次增量读取的起点（后端 output 接口返回的 nextOffset） */
const nextOffset = ref<number | null>(null);
/** 仅 remote-shell 使用的低频兜底（远端 logSize 不是实时推送） */
let remotePollTimer: number | null = null;
/** 终态后的"落定"补拉定时器 */
let settleTimer: number | null = null;
/** 切换 job 时丢弃迟到响应 */
let reloadGeneration = 0;
const commandExpanded = ref(false);

const job = computed(() => jobsStore.getJob(props.sessionId, props.jobId));
const effectiveStatus = computed(() => job.value?.status ?? log.value?.status ?? '');
const isRunning = computed(
    () => effectiveStatus.value === 'running' || effectiveStatus.value === 'stopping',
);

const commandLine = computed(() => {
    const cmd = job.value?.label || log.value?.command || props.command;
    return cmd ? `$ ${cmd}` : '';
});

const statusClass = computed(() => ({
    running: isRunning.value,
    completed: effectiveStatus.value === 'completed',
    killed: effectiveStatus.value === 'killed',
    error: effectiveStatus.value === 'failed',
    ended: effectiveStatus.value === 'lost' || effectiveStatus.value === 'ended',
}));

const statusText = computed(() => {
    switch (effectiveStatus.value) {
        case 'running':
        case 'stopping': return t('chat.workspace.processRunning');
        case 'completed': return t('chat.workspace.processCompleted');
        case 'killed': return t('chat.workspace.processKilled');
        case 'failed': return t('chat.workspace.processError');
        case 'lost':
        case 'ended': return t('chat.workspace.processEnded');
        default: return '';
    }
});

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clearSettleTimer(): void {
    if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
    }
}

function stopRemoteFallback(): void {
    if (remotePollTimer !== null) {
        clearInterval(remotePollTimer);
        remotePollTimer = null;
    }
}

function syncRemoteFallback(): void {
    stopRemoteFallback();
    if (job.value?.kind !== 'remote-shell' || !isRunning.value) return;
    remotePollTimer = window.setInterval(() => {
        void fetchLog('incremental');
    }, 2000);
}

function settleOnTerminal(): void {
    stopRemoteFallback();
    if (settleTimer !== null) return;
    const generation = reloadGeneration;
    settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (generation !== reloadGeneration) return;
        void fetchLog('settle');
    }, 1500);
}

function applyOutput(res: UiJobOutput, mode: 'initial' | 'incremental' | 'settle'): void {
    if (mode === 'initial' || log.value === null) {
        log.value = {
            jobId: res.jobId,
            command: job.value?.label || props.command,
            status: res.status,
            exitCode: res.exitCode,
            size: res.size,
            truncated: res.truncated,
            content: res.text,
            logFilePath: res.logFilePath,
        };
    } else {
        log.value = {
            ...log.value,
            status: res.status,
            exitCode: res.exitCode,
            size: res.size,
            truncated: res.truncated,
            content: log.value.content + res.text,
            logFilePath: res.logFilePath ?? log.value.logFilePath,
        };
    }
    nextOffset.value = res.nextOffset;
    gone.value = false;
    if (res.status !== 'running' && res.status !== 'stopping') {
        if (mode !== 'settle') settleOnTerminal();
        else stopRemoteFallback();
    }
}

async function fetchLog(mode: 'initial' | 'incremental' | 'settle' = 'incremental'): Promise<void> {
    const generation = reloadGeneration;
    const { sessionId, jobId } = props;
    if (!sessionId || !jobId) return;
    if (mode === 'initial') loading.value = true;
    try {
        const res = mode === 'initial' || nextOffset.value === null
            ? await apiService.getSessionJobOutput(sessionId, jobId)
            : await apiService.getSessionJobOutput(sessionId, jobId, { offset: nextOffset.value });
        if (generation !== reloadGeneration) return;
        applyOutput(res, mode);
    } catch (e) {
        if (generation !== reloadGeneration) return;
        if (getApiErrorStatus(e) === 404) {
            stopRemoteFallback();
            clearSettleTimer();
            log.value = null;
            gone.value = true;
        } else {
            console.error('[ProcessLogPanel] Failed to fetch job output:', e);
        }
    } finally {
        if (mode === 'initial' && generation === reloadGeneration) loading.value = false;
    }
}

function resetAndReload(): void {
    reloadGeneration += 1;
    stopRemoteFallback();
    clearSettleTimer();
    log.value = null;
    nextOffset.value = null;
    gone.value = false;
    loading.value = false;
    followTail.value = true;
    commandExpanded.value = false;
    void jobsStore.ensureLoaded(props.sessionId, true);
    void fetchLog('initial');
    syncRemoteFallback();
}

watch(() => [props.sessionId, props.jobId], resetAndReload);

// jobs 快照驱动：logSize 增长才拉增量；状态变化驱动终态补拉。
watch(
    () => job.value?.logSize,
    (size, old) => {
        if (size === undefined || size === old) return;
        if (isRunning.value) void fetchLog('incremental');
    },
);
watch(
    () => job.value?.status,
    (status) => {
        if (status === 'completed' || status === 'killed' || status === 'failed' || status === 'lost') {
            settleOnTerminal();
        }
        syncRemoteFallback();
    },
);

async function killProcess(): Promise<void> {
    try {
        await apiService.killSessionJob(props.sessionId, props.jobId);
        ElMessage.success(t('chat.workspace.processKilledToast'));
        await fetchLog('incremental');
    } catch (e) {
        if (getApiErrorStatus(e) !== 404) {
            console.error('[ProcessLogPanel] Failed to kill job:', e);
            ElMessage.error(t('chat.workspace.processKillFailed'));
        }
    }
}

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

let offSnapshot: (() => void) | null = null;
let offConnected: (() => void) | null = null;

onMounted(() => {
    offSnapshot = apiService.onSessionEvent('jobs_snapshot', (event) => {
        if (event.sessionId === props.sessionId) jobsStore.applySnapshot(event);
    });
    offConnected = apiService.onConnected(() => {
        void jobsStore.ensureLoaded(props.sessionId, true);
    });
    void jobsStore.ensureLoaded(props.sessionId);
    void fetchLog('initial');
    syncRemoteFallback();
});

onUnmounted(() => {
    stopRemoteFallback();
    clearSettleTimer();
    offSnapshot?.();
    offConnected?.();
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
.pl-status.ended { color: var(--gd-color-text-gray); }
.pl-spinner {
    width: 9px;
    height: 9px;
    border: 1px solid var(--gd-color-primary-200, #93c5fd);
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
/* 正文顶部常驻命令行：sticky 跟随滚动（背景与正文同色，滚过的日志不会透出来）；
   超长命令默认只显示两行，点击展开全文；全文另有 title 兜底 */
.pl-cmdline {
    background: var(--gd-color-surface);
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--gd-color-text-gray);
    white-space: pre-wrap;
    word-break: break-all;
    cursor: pointer;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
}
.pl-cmdline--expanded {
    display: block;
    -webkit-line-clamp: unset;
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
