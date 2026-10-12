<template>
    <!--
      ExitPlanMode 计划正文卡（样式对齐 ZCode SwitchModeToolCallBlock）：
      头部＝记事本图标 + 「计划」+ 复制按钮（无分隔线）；正文＝限高遮罩预览
      （遮罩与限高必须落在同一个裁切节点，否则渐变按完整内容高度计算、可见区反而不渐隐）；
      底部居中胶囊按钮 → 完整计划面板。计划正文仍是流内唯一内联阅读落点
      （审批弹窗只问批准与否，不含正文）。
    -->
    <div class="tool-plan-view">
        <div class="plan-header">
            <el-icon :size="16" class="plan-header-icon">
                <Notepad20Regular />
            </el-icon>
            <span class="plan-title">{{ t('chat.plan.title') }}</span>
            <span class="flex-1"></span>
            <!-- 终态徽标（批准/拒绝/中断/失败）与流式提示互斥：status 存在即已非执行中。
                 失败态的 tooltip 给出真实原因（后端工具结果文本）。 -->
            <PlanStatusBadge v-if="status" :status="status" :title="statusDetail" />
            <span v-else-if="executing && !pendingApproval && content" class="plan-status">
                {{ t('chat.plan.streamingHint') }}
            </span>
            <GdTooltip :content="t('chat.messageActions.copy')" placement="top">
                <button class="plan-icon-btn" @click="copyPlan">
                    <el-icon :size="14">
                        <Copy16Regular />
                    </el-icon>
                </button>
            </GdTooltip>
        </div>
        <div class="plan-preview">
            <div ref="clipEl" class="plan-preview-clip" :class="{ 'is-overflowing': overflowing }">
                <div ref="contentEl" class="plan-preview-content">
                    <MarkdownContent v-if="previewContent" class="plan-markdown markdown-text"
                        :content="previewContent" />
                    <div v-else class="plan-placeholder">{{ t('chat.plan.streamingHint') }}</div>
                </div>
            </div>
            <!-- 正文一出现就给面板入口：生成期间面板会直接读消息树里这份半截 args
                 （见 utils/sessionPlan 的 findPlanDraft），所以半成品也是可看的。
                 正文还没产出时不显示——没有可看的东西，放了就是"点了没反应"。 -->
            <el-button v-if="content" type="primary" round size="large" class="plan-open-btn"
                @click="openPanel">
                {{ t('chat.plan.viewFullDoc') }}
                <el-icon :size="16" class="plan-open-icon">
                    <ArrowRight16Regular />
                </el-icon>
            </el-button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElIcon } from 'element-plus'
import { ArrowRight16Regular, Copy16Regular, Notepad20Regular } from '@vicons/fluent'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import PlanStatusBadge from '@/components/chat/PlanStatusBadge.vue'
import { usePopup } from '@/composables/usePopup'
import { useThrottledValue } from '@/composables/useThrottledValue'
import { openSessionPlanPanel } from '@/utils/sessionPlan'
import type { PlanCardStatus } from '@/utils/toolDisplay'

const props = defineProps<{
    /** 已解析的 plan 字段（流式期间为半截内容） */
    content: string
    /** 工具执行中（流式输出 / 待审批） */
    executing?: boolean
    /** 本工具调用正处于待审批（会话级交互卡的 toolCallId 命中）：正文已定稿，可开计划面板 */
    pendingApproval?: boolean
    sessionId?: string
    /** 终态徽标（批准/拒绝/中断/失败）；undefined = 执行中，走流式提示 */
    status?: PlanCardStatus
    /** 徽标 tooltip：失败态显示工具结果原文（真实原因） */
    statusDetail?: string
}>()

const { t } = useI18n()
const { toast } = usePopup()

/** 预览用节流值：正文每个 token 都变，直接喂给 MarkdownContent 会每个 token
 *  重新 parse 整篇 + 全量 DOM diff（代价随文档长度增长）。复制仍取完整的 props.content。 */
const previewContent = useThrottledValue(() => props.content)

function openPanel(): void {
    if (props.sessionId) void openSessionPlanPanel(props.sessionId)
}

async function copyPlan(): Promise<void> {
    if (!props.content) return
    try {
        await navigator.clipboard.writeText(props.content)
        toast.success(t('common.copySuccess'))
    } catch {
        toast.error(t('common.copyFailed'))
    }
}

// ── 遮罩只在内容真溢出时应用 ──
// ZCode 无条件上遮罩（短计划底部也会发虚）；这里按"是否超出预览限高"开关，
// 溢出判定随内容增长与 markdown 落地（异步渲染）重算。

const clipEl = ref<HTMLElement | null>(null)
const contentEl = ref<HTMLElement | null>(null)
const overflowing = ref(false)

const measureOverflow = (): void => {
    const el = clipEl.value
    if (!el) return
    overflowing.value = el.scrollHeight - el.clientHeight > 1
}

let contentObserver: ResizeObserver | null = null

onMounted(() => {
    measureOverflow()
    if (contentEl.value) {
        contentObserver = new ResizeObserver(measureOverflow)
        contentObserver.observe(contentEl.value)
    }
})

onBeforeUnmount(() => {
    contentObserver?.disconnect()
    contentObserver = null
})

// 溢出判定跟着**实际渲染出来的**内容重算（节流值），而不是原始 props.content
watch(previewContent, () => {
    void nextTick(measureOverflow)
})
</script>

<style scoped>
.tool-plan-view {
    border: 1px solid var(--gd-color-surface-border, rgba(0, 0, 0, 0.08));
    border-radius: 12px;
    overflow: hidden;
    background: var(--gd-color-surface);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* 头部：图标 + 「计划」+ 复制（无分隔线；高度与内边距对齐 ZCode h-10 + px-4/pt-4） */
.plan-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    height: 40px;
    padding: 16px 16px 0;
    min-width: 0;
}

.plan-header-icon {
    flex-shrink: 0;
    color: var(--gd-color-text-gray);
}

.plan-title {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 500;
    line-height: 16px;
    color: var(--gd-color-text-gray);
}

/* 终态徽标与标题同行对齐：徽标默认 18px 行盒，在头部 flex-start 下文字会比标题低 1px */
.plan-header :deep(.plan-badge) {
    line-height: 16px;
}

/* 流式生成提示：占 ZCode 头部"计划文件路径"的同槽位（我们没有路径可显） */
.plan-status {
    font-size: 12px;
    color: var(--gd-color-text-gray);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.plan-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--gd-color-text-gray);
    transition: color 0.15s ease;
}

.plan-icon-btn:hover {
    color: var(--gd-color-text);
}

/* 正文预览：胶囊按钮绝对定位其内 */
.plan-preview {
    position: relative;
}

/* 限高与遮罩必须同一裁切节点；pb 3rem 给胶囊按钮留出压边空间（ZCode pb-12） */
.plan-preview-clip {
    max-height: 16rem;
    overflow: hidden;
    padding: 8px 16px 48px;
}

/* 内容超出限高才上遮罩：ZCode 无条件上，短计划底部会发虚——刻意偏差 */
.plan-preview-clip.is-overflowing {
    -webkit-mask-image: linear-gradient(to bottom, black 0%, black 30%, transparent 100%);
    mask-image: linear-gradient(to bottom, black 0%, black 30%, transparent 100%);
}

/* 正文与列表压暗一档、标题保持正文色（对齐 ZCode 卡片内排版层级） */
.plan-markdown :deep(p),
.plan-markdown :deep(li) {
    color: var(--gd-md-text-secondary);
}

.plan-placeholder {
    font-size: 12px;
    color: var(--gd-color-text-gray);
}

/* 底部居中胶囊：h-10 / rounded-full / bottom-6（ZCode），主色沿用应用主按钮 */
.plan-open-btn {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    height: 40px;
    padding: 0 18px 0 24px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* 文字与右箭头同一行（el-button 把默认插槽包在单个 span 里） */
.plan-open-btn :deep(span) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.plan-open-icon {
    flex-shrink: 0;
}
</style>
