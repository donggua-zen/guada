<template>
    <div class="space-y-6">
        <!-- 范围切换 + 刷新 -->
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-1">
                <button v-for="item in rangeOptions" :key="item.value" type="button"
                    class="px-3 py-1.5 rounded-lg text-sm transition-colors"
                    :class="range === item.value
                        ? 'bg-gray-900 text-white dark:bg-[#e8e9ed] dark:text-[#1a1b1e]'
                        : 'text-gray-600 dark:text-[#a8aab2] hover:bg-gray-100 dark:hover:bg-[#2a2b30]'"
                    @click="setRange(item.value)">
                    {{ t(item.labelKey) }}
                </button>
            </div>
            <div class="flex items-center gap-2">
                <button type="button"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) text-gray-600 dark:text-[#a8aab2] hover:bg-gray-50 dark:hover:bg-[#2a2b30] disabled:opacity-50"
                    :disabled="loading" @click="refresh">
                    <ArrowClockwise20Regular class="w-4 h-4" :class="{ 'animate-spin': loading }" />
                    {{ t('settings.usage.refresh') }}
                </button>
                <button type="button"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-red-200 dark:border-red-900/60 bg-(--gd-color-surface) text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                    :disabled="loading || clearing" @click="clearUsage">
                    <Delete20Regular class="w-4 h-4" />
                    {{ t('settings.usage.clear') }}
                </button>
            </div>
        </div>

        <!-- 错误 -->
        <div v-if="error"
            class="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <div class="font-medium">{{ t('settings.usage.error.title') }}</div>
            <div class="mt-1 text-xs break-all">{{ error }}</div>
            <button type="button" class="mt-2 text-xs underline" @click="refresh">
                {{ t('settings.usage.retry') }}
            </button>
        </div>

        <!-- 空态 / 加载 -->
        <div v-else-if="!snapshot"
            class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) px-6 py-12 text-center">
            <ChartMultiple24Regular class="w-8 h-8 mx-auto text-gray-300 dark:text-[#4a4c55]" />
            <div class="mt-3 text-sm font-medium text-gray-700 dark:text-[#d4d5da]">
                {{ loading ? t('settings.usage.loading') : t('settings.usage.empty.title') }}
            </div>
            <div v-if="!loading" class="mt-1 text-xs text-gray-500 dark:text-[#8b8d95]">
                {{ t('settings.usage.empty.desc') }}
            </div>
        </div>

        <template v-else>
            <!-- 摘要卡片 -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div v-for="item in summaryItems" :key="item.label"
                    class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) px-4 py-3">
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ item.label }}</div>
                    <div class="mt-1 text-xl font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ item.value }}</div>
                    <div v-if="item.hint" class="mt-1 text-[11px] text-gray-400 dark:text-[#777982] truncate">{{ item.hint }}</div>
                </div>
            </div>

            <!-- 热力图 -->
            <section class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.usage.heatmap.title') }}</h3>
                    <span class="text-xs text-gray-400 dark:text-[#777982]">
                        {{ snapshot.heatmap.startDate }} ~ {{ snapshot.heatmap.endDate }}
                    </span>
                </div>
                <div class="mt-3 overflow-x-auto pb-1">
                    <div class="min-w-max">
                        <div class="flex gap-[3px]">
                            <div v-for="week in snapshot.heatmap.weeks" :key="week.weekIndex"
                                class="flex flex-col gap-[3px]">
                                <div v-for="(day, index) in week.days" :key="index" class="w-3 h-3 rounded-sm"
                                    :class="day ? heatmapClass(day.level) : 'bg-transparent'"
                                    :title="day && !day.future ? `${day.date} · ${formatCompactTokens(day.totalTokens)} tokens · ${day.requestCount}` : ''" />
                            </div>
                        </div>
                        <!-- 月份标签：与周列左对齐 -->
                        <div class="relative mt-1 h-4" :style="{ width: heatmapGridWidth + 'px' }">
                            <span v-for="label in monthLabels" :key="label.weekIndex"
                                class="absolute top-0 text-[10px] leading-4 text-gray-400 dark:text-[#777982] whitespace-nowrap"
                                :style="{ left: label.left + 'px' }">
                                {{ label.text }}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-gray-400 dark:text-[#777982]">
                    <span>{{ t('settings.usage.heatmap.less') }}</span>
                    <span v-for="level in [0, 1, 2, 3, 4]" :key="level" class="w-3 h-3 rounded-sm" :class="heatmapClass(level)" />
                    <span>{{ t('settings.usage.heatmap.more') }}</span>
                </div>
            </section>

            <!-- 每日模型堆叠 -->
            <section class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">
                        {{ isMonthly ? t('settings.usage.trend.titleMonthly') : t('settings.usage.trend.title') }}
                    </h3>
                    <span class="text-xs text-gray-400 dark:text-[#777982]">
                        {{ t('settings.usage.trend.desc') }} · {{ t('settings.usage.trend.peak', { tokens: formatCompactTokens(maxTrendTokens) }) }}
                    </span>
                </div>
                <div v-if="hasTrendUsage" class="mt-4 overflow-x-auto pb-1">
                    <div class="flex items-end justify-around gap-2 h-36 w-full border-b border-gray-100 dark:border-[#2e3035]">
                        <div v-for="point in trendPoints" :key="point.date"
                            class="flex flex-col justify-end h-full min-w-[6px] flex-1 max-w-[48px]"
                            :title="pointTitle(point)">
                            <div class="flex flex-col-reverse w-full h-full rounded-sm overflow-hidden"
                                :class="point.totalTokens > 0 ? 'bg-gray-100 dark:bg-[#25262b]' : ''">
                                <div v-for="segment in point.models"
                                    :key="segment.providerId + ':' + segment.modelId"
                                    :style="{ height: segmentHeight(segment.totalTokens), backgroundColor: colorFor(segment.providerId, segment.modelId) }"
                                    class="w-full shrink-0" />
                            </div>
                        </div>
                    </div>
                    <!-- 月度模式：柱子下方标出月份 -->
                    <div v-if="isMonthly" class="mt-1 flex justify-around gap-2">
                        <span v-for="point in trendPoints" :key="point.date"
                            class="flex-1 max-w-[48px] text-center text-[10px] text-gray-400 dark:text-[#777982]">
                            {{ formatMonthLabel(`${point.date}-01`, locale) }}
                        </span>
                    </div>
                </div>
                <div v-else class="mt-4 text-xs text-gray-500 dark:text-[#8b8d95]">
                    {{ t('settings.usage.trend.empty') }}
                </div>
                <div v-if="topModels.length" class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                    <div v-for="model in topModels" :key="model.providerId + ':' + model.modelId"
                        class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#a8aab2]">
                        <span class="w-2.5 h-2.5 rounded-sm" :style="{ backgroundColor: colorFor(model.providerId, model.modelId) }" />
                        <span class="truncate max-w-[160px]">{{ model.modelName }}</span>
                    </div>
                </div>
            </section>

            <!-- 模型 / 来源 -->
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <section class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4">
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.usage.models.title') }}</h3>
                    <div v-if="!snapshot.models.length" class="mt-3 text-xs text-gray-500 dark:text-[#8b8d95]">
                        {{ t('settings.usage.models.empty') }}
                    </div>
                    <div v-else class="mt-3 space-y-3">
                        <div v-for="model in snapshot.models" :key="model.providerId + ':' + model.modelId">
                            <div class="flex items-center justify-between gap-3 text-sm">
                                <span class="truncate text-gray-800 dark:text-[#d4d5da]">{{ model.modelName }}</span>
                                <span class="shrink-0 text-gray-500 dark:text-[#8b8d95]">{{ formatCompactTokens(model.totalTokens) }}</span>
                            </div>
                            <div class="mt-0.5 text-[11px] text-gray-400 dark:text-[#777982]">
                                {{ model.providerName || model.providerId }} ·
                                {{ formatCompactTokens(model.inputTokens) }} in /
                                {{ formatCompactTokens(model.outputTokens) }} out ·
                                {{ model.requestCount }}
                            </div>
                            <div class="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-[#25262b] overflow-hidden">
                                <div class="h-full rounded-full" :style="{ width: percentWidth(model.share), backgroundColor: colorFor(model.providerId, model.modelId) }" />
                            </div>
                        </div>
                    </div>
                </section>

                <section class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4">
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.usage.sources.title') }}</h3>
                    <div v-if="!snapshot.sources.length" class="mt-3 text-xs text-gray-500 dark:text-[#8b8d95]">
                        {{ t('settings.usage.sources.empty') }}
                    </div>
                    <div v-else class="mt-3 space-y-3">
                        <div v-for="source in snapshot.sources" :key="source.source">
                            <div class="flex items-center justify-between gap-3 text-sm">
                                <span class="text-gray-800 dark:text-[#d4d5da]">{{ sourceLabel(source.source) }}</span>
                                <span class="shrink-0 text-gray-500 dark:text-[#8b8d95]">{{ formatCompactTokens(source.totalTokens) }}</span>
                            </div>
                            <div class="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-[#25262b] overflow-hidden">
                                <div class="h-full rounded-full bg-sky-500" :style="{ width: percentWidth(source.share) }" />
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <!-- 会话排行 -->
            <section class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
                <h3 class="px-4 pt-4 text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.usage.sessions.title') }}</h3>
                <div v-if="!snapshot.sessions.length" class="px-4 py-6 text-xs text-gray-500 dark:text-[#8b8d95]">
                    {{ t('settings.usage.sessions.empty') }}
                </div>
                <div v-else class="mt-3 divide-y divide-gray-100 dark:divide-[#2e3035]">
                    <div v-for="session in snapshot.sessions" :key="session.sessionId"
                        class="px-4 py-2.5 flex items-center gap-3 text-sm">
                        <span class="flex-1 min-w-0 truncate text-gray-800 dark:text-[#d4d5da]">
                            {{ session.title || t('settings.usage.sessions.untitled') }}
                        </span>
                        <span class="shrink-0 text-[11px] text-gray-400 dark:text-[#777982]">{{ session.sessionType || '-' }}</span>
                        <span class="shrink-0 w-20 text-right text-gray-500 dark:text-[#8b8d95]">{{ formatCompactTokens(session.totalTokens) }}</span>
                        <span class="shrink-0 w-14 text-right text-[11px] text-gray-400 dark:text-[#777982]">{{ session.requestCount }}</span>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    ArrowClockwise20Regular,
    ChartMultiple24Regular,
    Delete20Regular,
} from '@vicons/fluent'

import { useUsageStats } from '@/composables/useUsageStats'
import { usePopup } from '@/composables/usePopup'
import { apiService } from '@/services/ApiService'
import type {
    UsageDailyPoint,
    UsageMonthlyPoint,
    UsageRange,
} from '@/services/modules/usage.api'
import {
    formatCompactTokens,
    formatDurationMs,
    formatMonthDay,
    formatMonthLabel,
    formatPercent,
} from '@/utils/usageFormat'

type TrendPoint = UsageDailyPoint | UsageMonthlyPoint

const { t, locale } = useI18n()
const { confirm, toast } = usePopup()
const clearing = ref(false)
const {
    range,
    snapshot,
    loading,
    error,
    load,
    setRange,
    refresh,
} = useUsageStats('7d')

const rangeOptions: Array<{ value: UsageRange; labelKey: string }> = [
    { value: '7d', labelKey: 'settings.usage.range.7d' },
    { value: '30d', labelKey: 'settings.usage.range.30d' },
    { value: 'all', labelKey: 'settings.usage.range.all' },
]

const PALETTE = [
    '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
    '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
]

const HEATMAP_CELL_PX = 12
const HEATMAP_GAP_PX = 3

/** 热力图宽度：周列数 × (格子 + 间距)，用于月份标签定位 */
const heatmapGridWidth = computed(
    () =>
        (snapshot.value?.heatmap.weeks.length ?? 0) *
        (HEATMAP_CELL_PX + HEATMAP_GAP_PX),
)

/**
 * 月份标签：在每个月第一周的位置放一个标签。
 * 一年 12 个标签，周间距足够，不需要做重叠裁剪。
 */
const monthLabels = computed(() => {
    const weeks = snapshot.value?.heatmap.weeks ?? []
    const labels: Array<{ weekIndex: number; left: number; text: string }> = []
    let lastMonth = ''
    for (const [index, week] of weeks.entries()) {
        const firstDay = week.days.find((day) => day != null)
        if (!firstDay) continue
        const month = firstDay.date.slice(0, 7)
        if (month === lastMonth) continue
        lastMonth = month
        labels.push({
            weekIndex: index,
            left: index * (HEATMAP_CELL_PX + HEATMAP_GAP_PX),
            text: formatMonthLabel(firstDay.date, locale.value),
        })
    }
    return labels
})

const modelColorIndex = computed(() => {
    const map = new Map<string, number>()
    snapshot.value?.models.forEach((model, index) => {
        map.set(modelKey(model.providerId, model.modelId), index)
    })
    return map
})

const topModels = computed(() => (snapshot.value?.models ?? []).slice(0, 6))

/** all 范围按月度展示；7d/30d 按日 */
const isMonthly = computed(() => snapshot.value?.range === 'all')

const trendPoints = computed<TrendPoint[]>(() => {
    if (!snapshot.value) return []
    return isMonthly.value ? snapshot.value.monthly : snapshot.value.daily
})

const hasTrendUsage = computed(() =>
    trendPoints.value.some((point) => point.totalTokens > 0),
)

const maxTrendTokens = computed(() =>
    Math.max(1, ...trendPoints.value.map((point) => point.totalTokens)),
)

const summaryItems = computed(() => {
    const summary = snapshot.value?.summary
    if (!summary) return []
    const favorite = summary.favoriteModel
    return [
        {
            label: t('settings.usage.summary.totalTokens'),
            value: formatCompactTokens(summary.totalTokens),
            hint: favorite
                ? t('settings.usage.summary.favoriteModel', { model: favorite.modelId })
                : '',
        },
        {
            label: t('settings.usage.summary.inputTokens'),
            value: formatCompactTokens(summary.inputTokens),
            hint: '',
        },
        {
            label: t('settings.usage.summary.outputTokens'),
            value: formatCompactTokens(summary.outputTokens),
            hint: '',
        },
        {
            label: t('settings.usage.summary.cacheHitRate'),
            value: formatPercent(summary.cacheHitRate),
            hint: t('settings.usage.summary.cacheRead', {
                tokens: formatCompactTokens(summary.cacheReadTokens),
            }),
        },
        {
            label: t('settings.usage.summary.requests'),
            value: String(summary.requestCount),
            hint: summary.errorCount > 0
                ? t('settings.usage.summary.errors', { count: summary.errorCount })
                : '',
        },
        {
            label: t('settings.usage.summary.activeDays'),
            value: String(summary.activeDays),
            hint: t('settings.usage.summary.currentStreak', {
                days: summary.currentStreakDays,
            }),
        },
        {
            label: t('settings.usage.summary.peakDay'),
            value: formatCompactTokens(summary.peakDayTokens),
            hint: '',
        },
        {
            label: t('settings.usage.summary.avgTtft'),
            value: formatDurationMs(summary.avgTimeToFirstTokenMs),
            hint: summary.turnCount > 0
                ? t('settings.usage.summary.turns', { count: summary.turnCount })
                : '',
        },
    ]
})

onMounted(() => {
    void load('7d')
})

function modelKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`
}

function colorFor(providerId: string, modelId: string): string {
    const index = modelColorIndex.value.get(modelKey(providerId, modelId))
    if (index != null) return PALETTE[index % PALETTE.length]
    // 热力图窗口内出现但模型排行之外（极端情况）：稳定哈希取色
    const text = modelKey(providerId, modelId)
    let hash = 0
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
    return PALETTE[hash % PALETTE.length]
}

function segmentHeight(tokens: number): string {
    return `${Math.max(0, (tokens / maxTrendTokens.value) * 100)}%`
}

function percentWidth(share: number): string {
    return `${Math.max(0, Math.min(100, share * 100))}%`
}

function heatmapClass(level: number): string {
    switch (level) {
        case 4: return 'bg-emerald-500 dark:bg-emerald-400'
        case 3: return 'bg-emerald-400 dark:bg-emerald-600'
        case 2: return 'bg-emerald-300 dark:bg-emerald-800'
        case 1: return 'bg-emerald-200/70 dark:bg-emerald-900/60'
        default: return 'bg-gray-100 dark:bg-[#25262b]'
    }
}

function pointTitle(point: TrendPoint): string {
    const label = isMonthly.value ? point.date : formatMonthDay(point.date)
    const models = point.models
        .slice(0, 4)
        .map((item) => `${item.modelId} ${formatCompactTokens(item.totalTokens)}`)
        .join(' · ')
    return `${label} · ${formatCompactTokens(point.totalTokens)} tokens · ${point.requestCount}` +
        (models ? `\n${models}` : '')
}

async function clearUsage(): Promise<void> {
    const ok = await confirm(
        t('settings.usage.clearConfirmTitle'),
        t('settings.usage.clearConfirmMessage'),
        {
            type: 'error',
            danger: true,
            confirmText: t('settings.usage.clearConfirm'),
            cancelText: t('common.cancel'),
        },
    )
    if (!ok) return

    clearing.value = true
    try {
        await apiService.clearUsageStats()
        toast.success(t('settings.usage.clearSuccess'))
        await refresh()
    } catch {
        toast.error(t('settings.usage.clearFailed'))
    } finally {
        clearing.value = false
    }
}

function sourceLabel(source: string): string {
    const key = `settings.usage.sources.${source}`
    const label = t(key)
    return label === key ? source : label
}
</script>
