<template>
    <div class="plan-panel h-full flex flex-col min-h-0">
        <!-- 常驻头部：目录开关（历史图标）+ 当前计划（无计划时退化为面板名） -->
        <div class="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-(--gd-color-surface-border)">
            <GdTooltip :content="t('chat.plan.directory')" placement="bottom">
                <button class="plan-icon-btn" :class="{ 'is-active': directoryOpen }" @click="toggleDirectory">
                    <el-icon :size="16">
                        <History16Regular />
                    </el-icon>
                </button>
            </GdTooltip>
            <template v-if="selected">
                <span class="text-sm font-medium truncate">{{ selected.title }}</span>
                <PlanStatusBadge v-if="selected.status" class="shrink-0" :status="selected.status" />
                <span v-else-if="selected.streaming" class="shrink-0 plan-streaming">{{ t('chat.plan.streamingHint') }}</span>
            </template>
            <span v-else class="text-sm font-medium text-(--gd-color-text-gray)">{{ t('chat.plan.title') }}</span>
        </div>

        <!-- 内容区：详情 + 目录抽屉的定位上下文。
             抽屉 top:0 因此 = 标题栏之下——标题栏（含目录开关）不会被展开的抽屉盖住。 -->
        <div class="relative flex-1 min-h-0 flex flex-col">
            <!-- 详情：占满整个面板宽度（默认态；目录收起时不占位、不悬浮）。
                 排版对齐工作区「Markdown 文件预览」：挂 markdown-text 排版根（字号/行高/标题阶梯/
                 代码块与语法高亮全部由 --gd-md-font-size 派生，与预览 iframe 共用同一份全局样式），
                 并沿用预览的阅读列宽上限、16px 内边距与横向滚动。 -->
            <div v-if="selected" class="flex-1 min-h-0 overflow-y-auto overflow-x-auto plan-detail-scroll">
                <MarkdownContent class="markdown-text plan-detail-doc" :content="detailContent" />
            </div>
            <div v-else class="flex-1 flex items-center justify-center text-xs text-(--gd-color-text-gray)">
                {{ t('chat.plan.empty') }}
            </div>

            <!-- 目录：透明捕获层（点抽屉以外关闭，无视觉遮罩）+ 从左侧侧入的覆盖式抽屉。
                 抽屉 absolute 定位 → 展开不挤压详情宽度（默认全宽详情）。 -->
            <div v-if="directoryOpen" class="plan-directory-outside" @click="closeDirectory"></div>
            <Transition name="plan-directory">
                <div v-if="directoryOpen" class="plan-directory">
                    <div class="flex items-center justify-between px-2.5 py-1.5 shrink-0">
                        <span class="text-xs font-medium text-(--gd-color-text-gray)">{{ t('chat.plan.title') }}</span>
                        <GdTooltip :content="t('chat.plan.refresh')" placement="bottom">
                            <button class="plan-icon-btn" @click="refresh">
                                <el-icon :size="14">
                                    <ArrowClockwise16Regular />
                                </el-icon>
                            </button>
                        </GdTooltip>
                    </div>
                    <div class="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
                        <div v-if="plans.length === 0" class="px-2 py-6 text-center text-xs text-(--gd-color-text-gray)">
                            {{ draft ? t('chat.plan.streamingHint') : t('chat.plan.empty') }}
                        </div>
                        <button v-for="item in plans" :key="item.planId" class="plan-item"
                            :class="{ 'plan-item-active': item.planId === selected?.planId }" @click="select(item)">
                            <span class="plan-item-title">{{ item.title }}</span>
                            <span class="flex items-center gap-1.5 mt-1">
                                <PlanStatusBadge :status="item.status" />
                                <span class="text-[11px] text-(--gd-color-text-gray)">{{ formatTime(item.createdAt) }}</span>
                            </span>
                        </button>
                    </div>
                </div>
            </Transition>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon } from 'element-plus'
import { ArrowClockwise16Regular, History16Regular } from '@vicons/fluent'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import PlanStatusBadge from '@/components/chat/PlanStatusBadge.vue'
import { useSessionStore } from '@/stores/session'
import { usePopup } from '@/composables/usePopup'
import { useThrottledValue } from '@/composables/useThrottledValue'
import { findPlanDraft, refreshSessionPlans } from '@/utils/sessionPlan'
import type { SessionPlanItem, SessionPlanStatus } from '@/types/session'
import type { PlanCardStatus } from '@/utils/toolDisplay'

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

/** 生成中的计划（尚未落库）：直接读消息树里那份半截 args，正文随流式增长。
 *  它是**面板的当前内容**，不是目录条目——目录是历史（对齐 ZCode：计划目录只收终态行，
 *  流式计划的入口是流内卡片，从卡片进来时展示的正是这一份）。 */
const draft = computed(() => (props.sessionId ? findPlanDraft(props.sessionId) : undefined))

interface PlanEntry {
    planId: string
    title: string
    content: string
    status?: SessionPlanStatus | PlanCardStatus
    createdAt?: number
    /** 生成中：正文仍在增长 */
    streaming?: boolean
}

const draftEntry = computed<PlanEntry | null>(() => {
    const d = draft.value
    if (!d) return null
    return {
        planId: d.planId,
        title: t('chat.plan.title'),
        content: d.content,
        status: d.status,
        streaming: d.streaming,
    }
})

/** 手动选中（默认展示最近一份——审批卡跳进来时正是当前待审的那份） */
const selectedId = ref<string | null>(null)
/** 当前展示：生成中的计划优先（从卡片进来时就是它）；显式选过则按 planId 取目录条目。
 *  落库后草稿让位、selectedId 仍为空 → 回落到目录首条，而列表按"最近在前"排，
 *  所以接替的正是刚落库的那份，交接不跳。 */
const selected = computed<PlanEntry | null>(() => {
    if (selectedId.value) {
        return plans.value.find((p) => p.planId === selectedId.value) ?? null
    }
    return draftEntry.value ?? plans.value[0] ?? null
})

/** 详情正文的节流值。只在"生成中"时启用：正文随时间增长，每个 token 都让 MarkdownContent
 *  重 parse 整篇 + 全量 DOM diff，代价随篇幅上升；而已落库的计划是静态文本，更不能节流——
 *  在目录里切换选中时用户必须立刻看到新计划，晚 300ms 会像是没点动。 */
const throttledDraftContent = useThrottledValue(() => draftEntry.value?.content ?? '')
const detailContent = computed(() =>
    selected.value?.streaming ? throttledDraftContent.value : selected.value?.content ?? '',
)

// ── 目录抽屉：可开合的覆盖层（替代原「常驻左列」，避免挤压详情宽度）──
// 选中某项后自动关闭——目录是"选一下就走"的临时入口，不常驻占位。

const directoryOpen = ref(false)

function toggleDirectory(): void {
    directoryOpen.value = !directoryOpen.value
}

function closeDirectory(): void {
    directoryOpen.value = false
}

/** Esc 关闭：不 stopPropagation，避免影响宿主其它 Esc 处理 */
function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeDirectory()
}

// 选中的计划被删除/列表刷新后不存在 → 回落到最新
// （监听目录列表：展示生成中那份时 selectedId 恒为空，无需参与）
watch(plans, (list) => {
    if (selectedId.value && !list.some((p) => p.planId === selectedId.value)) {
        selectedId.value = null
    }
})

// 会话切换：重置选中与目录，重新拉取（缓存已存在也拉一次，保证最新）
watch(
    () => props.sessionId,
    (id) => {
        selectedId.value = null
        directoryOpen.value = false
        if (id) void refreshSessionPlans(id)
    },
)

onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    if (props.sessionId) void refreshSessionPlans(props.sessionId)
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
})

function select(item: PlanEntry): void {
    selectedId.value = item.planId
    directoryOpen.value = false
}

async function refresh(): Promise<void> {
    const list = await refreshSessionPlans(props.sessionId)
    if (!list) toast.error(t('chat.plan.refreshFailed'))
}

function formatTime(ms: number): string {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
/* 目录抽屉：绝对定位浮在详情之上，宽度不参与详情布局（开合都不挤压详情）。
   定位上下文是标题栏之下的内容区，故 top:0 不覆盖标题栏——开关在展开时仍可见可点。 */
.plan-directory {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 21;
    width: min(220px, 72%);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--gd-color-surface);
    border-right: 1px solid var(--gd-color-surface-border);
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.08);
}

/* 透明捕获层：只接管"点抽屉以外关闭"，无视觉遮罩（详情不被压暗） */
.plan-directory-outside {
    position: absolute;
    inset: 0;
    z-index: 20;
}

.plan-directory-enter-active,
.plan-directory-leave-active {
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.plan-directory-enter-from,
.plan-directory-leave-to {
    transform: translateX(-100%);
}

.plan-icon-btn.is-active {
    color: var(--gd-color-text);
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

.plan-icon-btn {
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

.plan-icon-btn:hover {
    color: var(--gd-color-text);
}

/* 生成中的计划标记：与流内卡片头部的流式提示同文案、同灰阶（不新增 i18n key） */
.plan-streaming {
    font-size: 12px;
    color: var(--gd-color-text-gray);
    white-space: nowrap;
}

/* 详情滚动区：内边距对齐预览 iframe 的 body padding（16px） */
.plan-detail-scroll {
    padding: 16px;
}

/* 阅读列：与预览 iframe 的 .markdown-text 同款（面板窄时无感，工作区全屏时居中限宽）。
   注意不要再给这里或 .markdown-content 覆盖 font-size——markdown.css 的行高/标题阶梯/
   间距全部由 --gd-md-font-size 派生，覆盖字号会让正文与派生尺寸脱节。 */
.plan-detail-doc {
    max-width: var(--gd-chat-column-width);
    margin: 0 auto;
}
</style>
