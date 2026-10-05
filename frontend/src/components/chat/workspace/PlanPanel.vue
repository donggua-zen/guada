<template>
    <div class="plan-panel h-full flex min-h-0">
        <!-- 左：计划列表（转录构建，最近在前） -->
        <div class="plan-list shrink-0 flex flex-col min-h-0">
            <div class="flex items-center justify-between px-2.5 py-1.5 shrink-0">
                <span class="text-xs font-medium text-(--gd-color-text-gray)">{{ t('chat.plan.title') }}</span>
                <GdTooltip :content="t('chat.plan.refresh')" placement="bottom">
                    <button class="plan-icon-btn" @click="refresh">
                        <el-icon :size="13"><ArrowClockwise16Regular /></el-icon>
                    </button>
                </GdTooltip>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
                <div v-if="plans.length === 0" class="px-2 py-6 text-center text-xs text-(--gd-color-text-gray)">
                    {{ t('chat.plan.empty') }}
                </div>
                <button v-for="item in plans" :key="item.planId" class="plan-item" :class="{ 'plan-item-active': item.planId === selected?.planId }"
                    @click="select(item)">
                    <span class="plan-item-title">{{ item.title }}</span>
                    <span class="flex items-center gap-1.5 mt-1">
                        <span class="plan-badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
                        <span class="text-[11px] text-(--gd-color-text-gray)">{{ formatTime(item.createdAt) }}</span>
                    </span>
                </button>
            </div>
        </div>

        <!-- 右：计划详情（Markdown 全文） -->
        <div class="flex-1 min-w-0 flex flex-col border-l border-(--gd-color-surface-border) dark:border-[#2e3035]">
            <template v-if="selected">
                <div class="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-(--gd-color-surface-border) dark:border-[#2e3035]">
                    <span class="text-sm font-medium truncate">{{ selected.title }}</span>
                    <span class="plan-badge shrink-0" :class="statusClass(selected.status)">{{ statusLabel(selected.status) }}</span>
                    <span class="flex-1"></span>
                    <button v-if="selected.path" class="plan-link-btn" @click="openFile">
                        {{ t('chat.plan.openFile') }}
                    </button>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3 plan-detail-body">
                    <MarkdownContent :content="selected.content" />
                </div>
            </template>
            <div v-else class="flex-1 flex items-center justify-center text-xs text-(--gd-color-text-gray)">
                {{ t('chat.plan.selectHint') }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon } from 'element-plus'
import { ArrowClockwise16Regular } from '@vicons/fluent'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import { useSessionStore } from '@/stores/session'
import { usePopup } from '@/composables/usePopup'
import { refreshSessionPlans } from '@/utils/sessionPlan'
import { previewFile } from '@/utils/workspacePreview'
import type { SessionPlanItem, SessionPlanStatus } from '@/types/session'

const props = defineProps<{
    sessionId: string
}>()

const { t } = useI18n()
const { toast } = usePopup()
const sessionStore = useSessionStore()

/** 列表来自会话 store 缓存（刷新触发见 streamProjector / 面板打开时主动拉取） */
const plans = computed<SessionPlanItem[]>(() =>
    props.sessionId ? sessionStore.sessionPlans(props.sessionId) ?? [] : [],
)

/** 手动选中（默认展示最近一份——审批卡跳进来时正是当前待审的那份） */
const selectedId = ref<string | null>(null)
const selected = computed<SessionPlanItem | null>(() => {
    if (plans.value.length === 0) return null
    return (
        plans.value.find((p) => p.planId === selectedId.value) ??
        plans.value[0]
    )
})

// 选中的计划被删除/列表刷新后不存在 → 回落到最新
watch(plans, (list) => {
    if (selectedId.value && !list.some((p) => p.planId === selectedId.value)) {
        selectedId.value = null
    }
})

// 会话切换：重置选中并重新拉取（缓存已存在也拉一次，保证最新）
watch(
    () => props.sessionId,
    (id) => {
        selectedId.value = null
        if (id) void refreshSessionPlans(id)
    },
)

onMounted(() => {
    if (props.sessionId) void refreshSessionPlans(props.sessionId)
})

function select(item: SessionPlanItem): void {
    selectedId.value = item.planId
}

async function refresh(): Promise<void> {
    const list = await refreshSessionPlans(props.sessionId)
    if (!list) toast.error(t('chat.plan.refreshFailed'))
}

/** 在文件中打开（文件已落盘时）：复用工作区文件预览 */
function openFile(): void {
    if (selected.value?.path) void previewFile(selected.value.path)
}

function statusLabel(status: SessionPlanStatus): string {
    return t(`chat.plan.status.${status}`)
}

function statusClass(status: SessionPlanStatus): string {
    if (status === 'approved') return 'plan-badge-approved'
    if (status === 'rejected') return 'plan-badge-rejected'
    return 'plan-badge-pending'
}

function formatTime(ms: number): string {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.plan-list {
    width: 220px;
}

.plan-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background-color 0.15s ease;
}

.plan-item:hover {
    background: var(--gd-color-surface-hover);
}

.plan-item-active {
    background: var(--gd-color-surface-hover);
    border-color: var(--gd-color-surface-border);
}

.plan-item-title {
    display: block;
    font-size: 12px;
    color: var(--gd-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.plan-badge {
    display: inline-flex;
    align-items: center;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 18px;
}

.plan-badge-approved {
    background: color-mix(in srgb, var(--el-color-success) 16%, transparent);
    color: var(--el-color-success);
}

.plan-badge-rejected {
    background: color-mix(in srgb, var(--el-color-danger) 16%, transparent);
    color: var(--el-color-danger);
}

.plan-badge-pending {
    background: color-mix(in srgb, var(--el-color-warning) 18%, transparent);
    color: var(--el-color-warning);
}

.plan-icon-btn,
.plan-link-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font-size: 12px;
    color: var(--gd-color-text-gray);
    transition: color 0.15s ease;
}

.plan-icon-btn:hover,
.plan-link-btn:hover {
    color: var(--gd-color-text);
}

.plan-detail-body :deep(.markdown-content) {
    font-size: 13px;
}
</style>
