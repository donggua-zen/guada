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
        <button class="pl-btn" @click="fetchLog()" :disabled="loading">
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
import { getApiErrorStatus } from '@/utils/errorMessage';

const props = defineProps<{
    sessionId: string;
    processId: string;
    command: string;
    tabKey: string;
    /** 本次运行的启动时间（run token）；同一 PID 被新进程复用时用于识别换了一次运行 */
    startedAt?: string;
}>();

const { t } = useI18n();

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
    ended: log.value?.status === 'ended',
}));

const statusText = computed(() => {
    switch (log.value?.status) {
        case 'running': return t('chat.workspace.processRunning');
        case 'completed': return t('chat.workspace.processCompleted');
        case 'killed': return t('chat.workspace.processKilled');
        case 'error': return t('chat.workspace.processError');
        // 进程已被清理（entry 已从后端注册表消失）：只能确定"已结束"，退出码/终止方式无从得知
        case 'ended': return t('chat.workspace.processEnded');
        default: return '';
    }
});

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── 拉取与轮询 ──

let pollTimer: number | null = null;
/** 终态后的"落定"补拉定时器（见 settleOnTerminal） */
let settleTimer: number | null = null;
/** 绑定身份代际：切换进程时 +1；切换前发出的迟到响应据此丢弃（否则旧进程的响应会覆盖新日志、甚至误停轮询） */
let reloadGeneration = 0;

function stopPolling(): void {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function clearSettleTimer(): void {
    if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
    }
}

/**
 * 收到终态（结束/被杀/出错/已结束）：停止轮询，并在 1.5s 后补拉一次。
 * 进程退出瞬间 writeStream 可能还没把最后一段刷到磁盘，这一次补拉专门兜住
 * "结束前最后一次输出"（补拉自身不再续期）。
 */
function settleOnTerminal(): void {
    stopPolling();
    if (settleTimer !== null) return;
    const generation = reloadGeneration;
    settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (generation !== reloadGeneration) return;
        void fetchLog({ settle: true });
    }, 1500);
}

async function fetchLog(options?: { settle?: boolean }): Promise<void> {
    const generation = reloadGeneration;
    const { sessionId, processId } = props;
    loading.value = true;
    try {
        const res = await apiService.getSessionProcessLog(sessionId, processId);
        if (generation !== reloadGeneration) return;
        log.value = res;
        if (res.status !== 'running') {
            if (options?.settle) stopPolling();
            else settleOnTerminal();
        }
    } catch (e) {
        if (generation !== reloadGeneration) return;
        // 404 = 后端注册表里没有该进程，且磁盘上的日志文件也不存在（已被清理/回收）
        if (getApiErrorStatus(e) === 404) {
            stopPolling();
            clearSettleTimer();
            log.value = null;
            gone.value = true;
        } else {
            console.error('[ProcessLogPanel] Failed to fetch log:', e);
        }
    } finally {
        if (generation === reloadGeneration) loading.value = false;
    }
}

function startPolling(): void {
    void fetchLog();
    pollTimer = window.setInterval(() => { void fetchLog(); }, 2000);
}

/**
 * 面板绑定的进程身份变化（切到另一个进程日志标签，或同一 PID 承载了新一次运行）：
 * 旧快照与已停止的轮询都不能保留，必须清空后重新拉取。
 */
function resetAndReload(): void {
    reloadGeneration += 1;
    stopPolling();
    clearSettleTimer();
    log.value = null;
    gone.value = false;
    loading.value = false;
    followTail.value = true;
    startPolling();
}

watch(() => [props.sessionId, props.processId, props.startedAt], resetAndReload);

// ── 终止进程 ──

async function killProcess(): Promise<void> {
    try {
        await apiService.killSessionProcess(props.sessionId, props.processId);
        ElMessage.success(t('chat.workspace.processKilledToast'));
        await fetchLog();
    } catch (e) {
        if (getApiErrorStatus(e) !== 404) {
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
});

onUnmounted(() => {
    stopPolling();
    clearSettleTimer();
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
