<template>
    <GdTooltip v-if="title" :content="title" placement="top">
        <span class="plan-badge" :class="`plan-badge-${status}`">{{ label }}</span>
    </GdTooltip>
    <span v-else class="plan-badge" :class="`plan-badge-${status}`">{{ label }}</span>
</template>

<script lang="ts">
import type { SessionPlanStatus } from '@/types/session'
import type { PlanCardStatus } from '@/utils/toolDisplay'

/**
 * 计划状态词表：工作区计划面板的三态（含待审批）+ 流内计划卡的终态。
 * 两个消费方共用本组件与 chat.plan.status.* 文案，避免词表/配色各自漂移。
 */
export type PlanBadgeStatus = SessionPlanStatus | PlanCardStatus
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import GdTooltip from '@/components/ui/GdTooltip.vue'

const props = defineProps<{
    status: PlanBadgeStatus
    /** 有值时包一层 tooltip：计划卡在失败态用它给出真实原因 */
    title?: string
}>()

const { t } = useI18n()

const label = computed(() => t(`chat.plan.status.${props.status}`))
</script>

<style scoped>
.plan-badge {
    display: inline-flex;
    align-items: center;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 18px;
    white-space: nowrap;
}

.plan-badge-approved {
    background: color-mix(in srgb, var(--el-color-success) 16%, transparent);
    color: var(--el-color-success);
}

.plan-badge-rejected {
    background: color-mix(in srgb, var(--el-color-danger) 16%, transparent);
    color: var(--el-color-danger);
}

.plan-badge-error {
    background: color-mix(in srgb, var(--el-color-danger) 16%, transparent);
    color: var(--el-color-danger);
}

.plan-badge-pending {
    background: color-mix(in srgb, var(--el-color-warning) 18%, transparent);
    color: var(--el-color-warning);
}

.plan-badge-aborted {
    background: color-mix(in srgb, var(--el-text-color-secondary) 16%, transparent);
    color: var(--el-text-color-secondary);
}
</style>
