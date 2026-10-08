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
                <PlanStatusBadge class="shrink-0" :status="selected.status" />
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
                <MarkdownContent class="markdown-text plan-detail-doc" :content="selected.content" />
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
                            {{ t('chat.plan.empty') }}
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
import { refreshSessionPlans } from '@/utils/sessionPlan'
import type { SessionPlanItem } from '@/types/session'

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

function select(item: SessionPlanItem): void {
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
