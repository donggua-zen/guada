<template>
    <!--
      ExitPlanMode 计划正文的流式渲染：参数经 partial-json 容错解析后按 Markdown 增量渲染，
      模型还在写计划时第一段就可见（对齐 ZCode 的 plan 半截 JSON 预览），不必等整份输出完。
    -->
    <div class="tool-plan-view">
        <div class="plan-scroll">
            <MarkdownContent v-if="content" :content="content" />
            <div v-else class="plan-placeholder">{{ t('chat.plan.streamingHint') }}</div>
        </div>
        <div class="plan-footer">
            <span v-if="executing" class="plan-hint">{{ t('chat.plan.streamingHint') }}</span>
            <span class="flex-1"></span>
            <!-- 运行中（含待审批）不提供面板入口：此刻计划尚未落库进列表 -->
            <button v-if="!executing" class="plan-open-btn" @click="openPanel">
                {{ t('chat.plan.viewFullDoc') }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import { openSessionPlanPanel } from '@/utils/sessionPlan'

const props = defineProps<{
    /** 已解析的 plan 字段（流式期间为半截内容） */
    content: string
    /** 工具执行中（流式输出 / 待审批） */
    executing?: boolean
    sessionId?: string
}>()

const { t } = useI18n()

function openPanel(): void {
    if (props.sessionId) void openSessionPlanPanel(props.sessionId)
}
</script>

<style scoped>
.tool-plan-view {
    border: 1px solid var(--gd-color-surface-border, rgba(0, 0, 0, 0.08));
    border-radius: 8px;
    overflow: hidden;
    background: var(--gd-color-surface);
}

.plan-scroll {
    max-height: 16rem;
    overflow-y: auto;
    padding: 8px 12px;
}

.plan-placeholder {
    font-size: 12px;
    color: var(--gd-color-text-gray);
}

.plan-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border-top: 1px solid var(--gd-color-surface-border, rgba(0, 0, 0, 0.08));
}

.plan-hint {
    font-size: 11px;
    color: var(--gd-color-text-gray);
}

.plan-open-btn {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font-size: 12px;
    color: var(--gd-color-text-gray);
    transition: color 0.15s ease;
}

.plan-open-btn:hover {
    color: var(--gd-color-text);
}
</style>
