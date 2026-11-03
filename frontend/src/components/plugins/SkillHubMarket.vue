<template>
    <!-- 分类筛选 chips（单选）：与官网市场的标签行同构 -->
    <div v-show="categories.length > 0" class="plugins-filter-row">
        <button
            v-for="chip in categoryChips"
            :key="`${chip.id}-${chip.index}`"
            type="button"
            class="plugins-chip"
            :class="{ 'is-active': chip.id === selectedCategory }"
            @click="handleSelectCategory(chip.id)"
        >
            {{ chip.name }}
        </button>
    </div>

    <!-- 加载中：统一用骨架动画（首次进入与刷新共用），骨架数量贴近当前列表高度 -->
    <div v-if="loading" class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
        <div v-for="i in skeletonCount" :key="i" class="plugins-skeleton" aria-hidden="true">
            <span class="plugins-skeleton__avatar"></span>
            <span class="plugins-skeleton__lines">
                <span class="plugins-skeleton__line plugins-skeleton__line--name"></span>
                <span class="plugins-skeleton__line"></span>
            </span>
        </div>
    </div>

    <!-- 错误 -->
    <div v-else-if="error"
        class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-6 text-center">
        <MailInbox24Regular class="mb-2 opacity-50 text-gray-400 w-8 h-8 mx-auto" />
        <div class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ error }}</div>
        <GdButton class="mt-3" size="small" @click="handleRefresh">{{ t('common.retry') }}</GdButton>
    </div>

    <!-- 空结果 -->
    <div v-else-if="items.length === 0"
        class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-8 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
        {{ t('plugins.skills.skillhubEmptyResult') }}
    </div>

    <!-- 两列行列表 -->
    <div v-else-if="items.length > 0" class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
        <PluginListRow
            v-for="skill in items"
            :key="skill.id"
            :name="skill.name"
            :description="skill.description || t('plugins.skills.noDescription')"
            :icon-src="skill.icon"
            @click="handleShowDialog(skill)"
        >
            <template #badges>
                <GdTag v-if="skill.localStatus === 'installed'" type="success" size="small" effect="plain">
                    {{ t('plugins.skills.marketInstalled') }}
                </GdTag>
                <GdTag v-else-if="skill.localStatus === 'updatable'" type="warning" size="small" effect="plain">
                    {{ t('plugins.skills.marketUpdatable') }}
                </GdTag>
                <GdTag v-if="skill.category" size="small" effect="light">
                    {{ categoryName(skill.category.key) }}
                </GdTag>
                <GdTag v-if="skill.verified" type="success" size="small" effect="light">
                    {{ t('plugins.skills.skillhubVerified') }}
                </GdTag>
            </template>
            <!-- 第三行：收藏 / 下载（图标 + 数字，不带文字标签） -->
            <template #meta>
                <div
                    v-if="skill.stats.downloads > 0 || skill.stats.stars > 0"
                    class="skillhub-row-meta"
                >
                    <span
                        v-if="skill.stats.stars > 0"
                        class="skillhub-row-meta__item"
                        :title="`${t('plugins.skills.skillhubStars')} ${skill.stats.stars}`"
                        :aria-label="`${t('plugins.skills.skillhubStars')} ${skill.stats.stars}`"
                    >
                        <Star16Regular class="skillhub-row-meta__icon" />
                        {{ formatCount(skill.stats.stars) }}
                    </span>
                    <span
                        v-if="skill.stats.downloads > 0"
                        class="skillhub-row-meta__item"
                        :title="`${t('plugins.skills.skillhubDownloads')} ${skill.stats.downloads}`"
                        :aria-label="`${t('plugins.skills.skillhubDownloads')} ${skill.stats.downloads}`"
                    >
                        <ArrowDownload16Regular class="skillhub-row-meta__icon" />
                        {{ formatCount(skill.stats.downloads) }}
                    </span>
                </div>
            </template>
            <template #actions>
                <GdButton
                    size="small"
                    plain
                    :loading="installing.has(skill.id)"
                    @click.stop="handleInstall(skill)"
                >
                    {{ getButtonLabel(skill) }}
                </GdButton>
            </template>
        </PluginListRow>
    </div>

    <!-- 滚动到底加载更多：自动触发 + 可点击兜底；加载态复用骨架 -->
    <div v-show="items.length > 0" ref="loadMoreSentinel" class="skillhub-load-more">
        <div v-if="loadingMore" class="-mx-2 grid w-full grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
            <div v-for="i in 4" :key="i" class="plugins-skeleton" aria-hidden="true">
                <span class="plugins-skeleton__avatar"></span>
                <span class="plugins-skeleton__lines">
                    <span class="plugins-skeleton__line plugins-skeleton__line--name"></span>
                    <span class="plugins-skeleton__line"></span>
                </span>
            </div>
        </div>
        <GdButton v-else-if="moreError" size="small" @click="handleLoadMore">
            {{ t('common.retry') }}
        </GdButton>
        <button
            v-else-if="hasMore && items.length > 0"
            type="button"
            class="skillhub-load-more__hint"
            @click="handleLoadMore"
        >
            {{ t('plugins.skills.skillhubLoadMore') }}
        </button>
        <span v-else-if="!hasMore && items.length > 0" class="skillhub-load-more__end">
            {{ t('plugins.skills.skillhubNoMore') }}
        </span>
    </div>

    <!-- 安装/详情弹窗 -->
    <GdDialog v-model="showInstallDialog" :title="t('plugins.skills.skillhubInstallTitle')" size="md"
        align-center destroy-on-close>
        <div v-if="selectedSkill" class="skillhub-install">
            <!-- 主视觉 -->
            <div class="skillhub-install__head">
                <CardAvatar :src="selectedSkill.icon" :name="selectedSkill.name" size="lg" />
                <div class="skillhub-install__title">
                    <div class="skillhub-install__name">{{ selectedSkill.name }}</div>
                    <div class="skillhub-install__meta">
                        <span v-if="selectedSkill.version">v{{ selectedSkill.version }}</span>
                        <span v-if="selectedSkill.version && detail?.owner"> · </span>
                        <span v-if="detail?.owner">{{ t('plugins.skills.skillhubAuthor') }}：{{ detail.owner.displayName }}</span>
                        <span v-if="selectedSkill.localVersion"> · {{ t('plugins.skills.marketLocalVersion', { version: selectedSkill.localVersion }) }}</span>
                    </div>
                </div>
                <GdTag v-if="selectedSkill.localStatus === 'updatable'" type="warning" size="small" effect="plain">
                    {{ t('plugins.skills.marketUpdatable') }}
                </GdTag>
                <GdTag v-else-if="selectedSkill.localStatus === 'installed'" type="success" size="small" effect="plain">
                    {{ t('plugins.skills.marketInstalled') }}
                </GdTag>
            </div>

            <!-- 统计 -->
            <div v-if="stats" class="skillhub-stats">
                <div class="skillhub-stat">
                    <span class="skillhub-stat__value">{{ formatCount(stats.downloads) }}</span>
                    <span class="skillhub-stat__label">{{ t('plugins.skills.skillhubDownloads') }}</span>
                </div>
                <div class="skillhub-stat">
                    <span class="skillhub-stat__value">{{ formatCount(stats.stars) }}</span>
                    <span class="skillhub-stat__label">{{ t('plugins.skills.skillhubStars') }}</span>
                </div>
                <div class="skillhub-stat">
                    <span class="skillhub-stat__value">{{ formatCount(stats.installs) }}</span>
                    <span class="skillhub-stat__label">{{ t('plugins.skills.skillhubInstalls') }}</span>
                </div>
            </div>

            <!-- 分类 / 标签 -->
            <div v-if="tagChips.length > 0" class="skillhub-install__labels">
                <GdTag v-for="tag in tagChips" :key="tag" size="small">{{ tag }}</GdTag>
            </div>

            <!-- 描述 -->
            <MarkdownContent v-if="description" class="skillhub-install__desc" :content="description" />
            <p v-else class="skillhub-install__desc skillhub-install__desc--empty">
                {{ t('plugins.skills.noDescription') }}
            </p>

            <div v-if="detailLoading" class="skillhub-section__muted">
                {{ t('plugins.skills.skillhubDetailLoading') }}
            </div>

            <!-- 安全报告 -->
            <div v-if="securityReports.length > 0" class="skillhub-section">
                <div class="skillhub-section__title">{{ t('plugins.skills.skillhubSecurity') }}</div>
                <div class="skillhub-install__labels">
                    <GdTag
                        v-for="report in securityReports"
                        :key="report.provider"
                        :type="securityTagType(report.status)"
                        size="small"
                        effect="plain"
                    >
                        {{ report.statusText }}
                    </GdTag>
                </div>
                <GdButton v-if="securityReportUrl" link type="primary" @click="openExternal(securityReportUrl)">
                    {{ t('plugins.skills.skillhubViewSecurityReport') }}
                    <ArrowUpRight16Regular class="skillhub-install__ext" />
                </GdButton>
            </div>

            <!-- 质量评测 -->
            <div v-if="evaluation" class="skillhub-section">
                <div class="skillhub-section__title">
                    <span>{{ t('plugins.skills.skillhubQuality') }}</span>
                    <span v-if="evaluation.totalScore !== null" class="skillhub-quality__total">
                        {{ evaluation.totalScore }} / 5
                    </span>
                </div>
                <p v-if="evaluation.userSummary" class="skillhub-section__summary">
                    {{ evaluation.userSummary }}
                </p>
                <div v-for="dimension in evaluation.dimensions" :key="dimension.key" class="skillhub-dim">
                    <span class="skillhub-dim__name" :title="dimension.userReason || ''">
                        {{ dimensionName(dimension.key) }}
                    </span>
                    <span class="skillhub-dim__bar">
                        <span
                            class="skillhub-dim__fill"
                            :style="{ width: `${dimensionWidth(dimension.score)}%` }"
                        ></span>
                    </span>
                    <span class="skillhub-dim__score">{{ dimension.score ?? '—' }}</span>
                </div>
            </div>
            <div v-else-if="detail && !detailLoading" class="skillhub-section__muted">
                {{ t('plugins.skills.skillhubQualityNone') }}
            </div>

            <!-- 最新版本变更说明 -->
            <div v-if="detail?.latestVersion?.changelog" class="skillhub-section">
                <div class="skillhub-section__title">{{ t('plugins.skills.skillhubChangelog') }}</div>
                <p class="skillhub-section__summary">{{ detail.latestVersion.changelog }}</p>
            </div>

            <!-- 详情失败：不阻塞安装 -->
            <GdAlert v-if="detailError" class="skillhub-install__notice" type="warning" :closable="false"
                :title="t('plugins.skills.skillhubDetailFailed')" :description="detailError" />

            <!-- 决策信息 -->
            <div class="skillhub-install__facts">
                <div class="skillhub-install__fact">
                    <span class="skillhub-install__fact-k">{{ t('plugins.skills.marketInstallMethod') }}</span>
                    <span class="skillhub-install__fact-v">{{ t('plugins.skills.skillhubInstallMethod') }}</span>
                </div>
                <div class="skillhub-install__fact">
                    <span class="skillhub-install__fact-k">{{ t('plugins.skills.marketInstallScope') }}</span>
                    <span class="skillhub-install__fact-v">{{ t('plugins.skills.marketInstallScopeGlobal') }}</span>
                </div>
            </div>

            <!-- 覆盖/升级影响 -->
            <GdAlert v-if="selectedSkill.localStatus === 'updatable'" class="skillhub-install__notice"
                type="warning" :closable="false"
                :title="t('plugins.skills.marketUpgradeNotice', { from: selectedSkill.localVersion || '?', to: selectedSkill.version || '?' })" />
            <GdAlert v-else-if="selectedSkill.localStatus === 'installed'" class="skillhub-install__notice"
                type="info" :closable="false" :title="t('plugins.skills.marketReinstallNotice')" />

            <!-- 安装失败就地反馈 -->
            <GdAlert v-if="installError" class="skillhub-install__notice" type="error" :closable="false"
                :title="t('plugins.skills.installFailed')" :description="installError" />

            <!-- 操作区 -->
            <div class="skillhub-install__actions">
                <div class="skillhub-install__links">
                    <GdButton link type="primary" @click="openExternal(selectedSkill.detailUrl)">
                        {{ t('plugins.skills.skillhubViewDetail') }}
                        <ArrowUpRight16Regular class="skillhub-install__ext" />
                    </GdButton>
                </div>
                <div class="skillhub-install__cta">
                    <GdButton @click="showInstallDialog = false">{{ t('common.cancel') }}</GdButton>
                    <GdButton type="primary" :loading="installing.has(selectedSkill.id)"
                        @click="handleInstall(selectedSkill)">
                        <template #icon>
                            <ArrowDownload16Regular />
                        </template>
                        {{ getButtonLabel(selectedSkill) }}
                    </GdButton>
                </div>
            </div>
        </div>
    </GdDialog>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import GdTag from '@/components/ui/GdTag.vue'
import GdAlert from '@/components/ui/GdAlert.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import PluginListRow from './PluginListRow.vue'
import { toast } from '@/components/ui/toastService'
import { ArrowDownload16Regular, ArrowUpRight16Regular, MailInbox24Regular, Star16Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import {
    type SkillHubCategory,
    type SkillHubDetail,
    type SkillHubEvaluation,
    type SkillHubMarketItem,
    type SkillHubSecurityReport,
} from '@/services/modules/skillHubMarket.api'
import { localeToMarketLang } from '@/services/SkillMarketService'
import { getLocale } from '@/locales'
import { openInExternalBrowser } from '@/utils/browserUtils'
import {
    applyMarketStatus,
    dedupeById,
    mergeUniqueById,
    type MarketStatus,
} from '@/utils/marketStatus'
import type { Skill } from '@/types/skills'

const props = defineProps<{
    /** 本地已安装技能，用于市场项的安装状态匹配 */
    localSkills: Skill[]
    /** 父级当前是否停在 SkillHub 视图：数据只在第一次进入时拉 */
    active: boolean
}>()

/** 搜索框在父级视图条上，关键词双向同步；内部防抖后才发请求 */
const keywordModel = defineModel<string>('keyword', { default: '' })

const emit = defineEmits<{
    /** 安装成功，父组件刷新本地技能列表 */
    installed: []
}>()

const { t, locale } = useI18n()

type ItemWithStatus = SkillHubMarketItem & MarketStatus

// ── 列表状态 ──
const items = ref<ItemWithStatus[]>([])
/** 首屏/重置加载：整页骨架 */
const loading = ref(false)
/** 滚动加载下一页：底部局部骨架 */
const loadingMore = ref(false)
const error = ref<string | null>(null)
const moreError = ref<string | null>(null)
const hasMore = ref(true)

const keyword = ref('')
const selectedCategory = ref('')
const categories = ref<SkillHubCategory[]>([])
const currentPage = ref(1)
/** 首屏 24 条（上游去重后通常 18~22 条），滚动继续追加 */
const PAGE_SIZE = 24
/** 上次加载后的列表长度：重置加载时骨架行数贴近它，避免高度跳动 */
const lastLoadedCount = ref(0)

let searchTimer: ReturnType<typeof setTimeout> | null = null

const skeletonCount = computed(() =>
    Math.max(6, Math.min(lastLoadedCount.value || 12, PAGE_SIZE)),
)

// ── 滚动加载更多 ──
const loadMoreSentinel = ref<HTMLElement | null>(null)

const categoryChips = computed(() => [
    { id: '', name: t('plugins.skills.skillhubFilterAll'), index: 0 },
    ...categories.value.map((category, index) => ({
        id: category.id,
        name: category.name,
        index: index + 1,
    })),
])

// ── 详情/安装弹窗 ──
const showInstallDialog = ref(false)
const selectedSkill = ref<ItemWithStatus | null>(null)
const detail = ref<SkillHubDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const installing = ref<Set<string>>(new Set())
const installError = ref<string | null>(null)

/** 详情按 slug 缓存（同一语言内有效；切语言时清空） */
const detailCache = new Map<string, SkillHubDetail>()
let detailSeq = 0

const stats = computed(() => detail.value?.item.stats ?? selectedSkill.value?.stats ?? null)
/**
 * 安全报告按「状态 + 文案」去重。
 * SkillHub 会返回多家安全厂商的报告（如 keen / sanbu），结论相同时没必要重复展示。
 */
const securityReports = computed<SkillHubSecurityReport[]>(() => {
    const seen = new Set<string>()
    return (detail.value?.securityReports ?? []).filter((report) => {
        const key = `${report.status}:${report.statusText}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
})
const evaluation = computed<SkillHubEvaluation | null>(() => detail.value?.evaluation ?? null)
const securityReportUrl = computed(
    () => securityReports.value.find((report) => report.reportUrl)?.reportUrl,
)

const description = computed(
    () => detail.value?.item.description || selectedSkill.value?.description || '',
)

/** 分类 + 二级类目 + 属性标签，去重后最多展示 6 个 */
const tagChips = computed(() => {
    const item = detail.value?.item ?? selectedSkill.value
    if (!item) return []

    const chips: string[] = []
    if (item.category?.key) chips.push(categoryName(item.category.key))
    for (const sub of item.subCategories ?? []) {
        if (sub.name) chips.push(sub.name)
    }
    for (const [key, value] of Object.entries(item.labels ?? {})) {
        chips.push(labelText(key, value))
    }
    return Array.from(new Set(chips.filter(Boolean))).slice(0, 6)
})

function lang() {
    return localeToMarketLang(getLocale())
}

function formatCount(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0'
    try {
        return new Intl.NumberFormat(locale.value, {
            notation: 'compact',
            maximumFractionDigits: 1,
        }).format(value)
    } catch {
        return String(value)
    }
}

function categoryName(key?: string): string {
    if (!key) return ''
    return categories.value.find((category) => category.id === key)?.name ?? key
}

function labelText(key: string, value: string): string {
    if (key === 'requires_api_key') {
        return value === 'true'
            ? t('plugins.skills.skillhubRequiresApiKey')
            : t('plugins.skills.skillhubNoApiKey')
    }
    if (key === 'pricing_type') {
        return value === 'paid'
            ? t('plugins.skills.skillhubPaid')
            : t('plugins.skills.skillhubFree')
    }
    return `${key}: ${value}`
}

function dimensionName(key: string): string {
    const known = ['trust', 'reliability', 'adaptability', 'convention', 'effectiveness']
    return known.includes(key)
        ? t(`plugins.skills.skillhubQualityDimensions.${key}`)
        : key
}

function dimensionWidth(score: number | null): number {
    if (typeof score !== 'number' || !Number.isFinite(score)) return 0
    return Math.max(0, Math.min(100, (score / 5) * 100))
}

function securityTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
    const normalized = status.toLowerCase()
    if (normalized === 'benign' || normalized === 'safe' || normalized === 'pass') return 'success'
    if (normalized.includes('malicious') || normalized.includes('risk') || normalized.includes('danger')) {
        return 'danger'
    }
    if (normalized.includes('warn')) return 'warning'
    return 'info'
}

function openExternal(url?: string | null) {
    if (!url) return
    openInExternalBrowser(url)
}

/**
 * 更新所有市场技能的状态（优先按安装来源匹配，回退到名称匹配）
 */
function refreshStatus() {
    items.value = applyMarketStatus(dedupeById(items.value), props.localSkills, 'skillhub')
}

watch(() => props.localSkills, refreshStatus, { deep: true })

function getButtonLabel(skill: ItemWithStatus): string {
    switch (skill.localStatus) {
        case 'updatable': return t('plugins.skills.marketUpgradeBtn')
        case 'installed': return t('plugins.skills.marketReinstallBtn')
        default: return t('plugins.skills.marketInstallBtn')
    }
}

// ── 数据加载 ──

let loadSeq = 0

/**
 * 加载一页。
 * reset=true：首屏/筛选变化/刷新，整页骨架，成功后替换列表；
 * reset=false：滚动加载下一页，保留列表并在底部追加骨架。
 */
async function loadPage(reset: boolean) {
    if (!activated.value) return

    if (!reset) {
        if (loading.value || loadingMore.value || !hasMore.value) return
        loadingMore.value = true
        moreError.value = null
    } else {
        loadSeq += 1
        loading.value = true
        loadingMore.value = false
        error.value = null
        moreError.value = null
        hasMore.value = true
        currentPage.value = 1
    }

    const seq = loadSeq
    const page = reset ? 1 : currentPage.value + 1

    try {
        const response = await apiService.fetchSkillHubList({
            page,
            pageSize: PAGE_SIZE,
            ...(keyword.value ? { keyword: keyword.value } : {}),
            ...(selectedCategory.value ? { category: selectedCategory.value } : {}),
            lang: lang(),
        })

        // 过期响应（已切换筛选/重新加载）直接丢弃
        if (seq !== loadSeq) return

        // 上游会重复返回同一 slug，先去重再套状态，避免重复行/重复 key
        const incoming = applyMarketStatus(
            dedupeById(response.items),
            props.localSkills,
            'skillhub',
        )

        const before = items.value.length
        items.value = reset ? incoming : mergeUniqueById(items.value, incoming)
        const added = items.value.length - before

        currentPage.value = response.pagination.page
        lastLoadedCount.value = items.value.length
        lastLoadedAt.value = Date.now()

        // 追加页没有带来任何新条目时停止，避免重复页导致无限滚动
        hasMore.value =
            response.items.length > 0 &&
            response.pagination.page < response.pagination.totalPages &&
            (reset || added > 0)
    } catch (err) {
        if (seq !== loadSeq) return
        console.error('加载 SkillHub 技能失败:', err)
        const message = getErrorMessage(err) || t('plugins.skills.skillhubError')
        if (reset) {
            // 首屏失败：整页错误态；已有列表的刷新失败则保留列表并 toast
            if (items.value.length > 0) {
                toast.error(message)
            } else {
                error.value = message
                hasMore.value = false
            }
        } else {
            // 加载更多失败：保留列表，底部给重试按钮
            moreError.value = message
        }
    } finally {
        if (seq === loadSeq) {
            loading.value = false
            loadingMore.value = false
        }
    }
}

const activated = ref(false)
/** 上次成功加载时间：切回视图时只有超过 60s 才自动刷新 */
const lastLoadedAt = ref(0)

function activate() {
    if (!activated.value) {
        activated.value = true
        void loadCategories()
        void loadPage(true)
        return
    }
    // 切回视图：数据已新鲜就直接展示（配合视图淡入动画）；
    // 超过 60s 才重新加载，加载态复用骨架。
    if (!loading.value && !loadingMore.value && Date.now() - lastLoadedAt.value > 60_000) {
        void loadPage(true)
        return
    }
    // 数据新鲜但当前列表可能不足一屏：补一次滚动检查
    void nextTick(maybeLoadMore)
}

async function loadCategories() {
    if (!activated.value) return
    try {
        const response = await apiService.fetchSkillHubCategories(lang())
        categories.value = response.items
    } catch (err) {
        console.error('加载 SkillHub 分类失败:', err)
        // 分类加载失败不阻塞主列表，仅隐藏筛选行
        categories.value = []
    }
}

function handleRefresh() {
    void loadPage(true)
}

function handleLoadMore() {
    void loadPage(false)
}

/**
 * 哨兵接近视口底部即加载下一页。
 *
 * 用 getBoundingClientRect 而不是固定滚动容器：插件页是嵌套 overflow-auto，
 * 直接判断哨兵相对视口的位置更稳，也不会因为初始内容不足一屏而误判。
 */
function isNearBottom(): boolean {
    const el = loadMoreSentinel.value
    if (!el || el.offsetParent === null) return false
    return el.getBoundingClientRect().top <= window.innerHeight + 240
}

function maybeLoadMore() {
    if (!hasMore.value || loading.value || loadingMore.value || moreError.value) return
    if (items.value.length === 0) return
    if (!isNearBottom()) return
    void loadPage(false)
}

function handleScroll() {
    maybeLoadMore()
}

onMounted(async () => {
    await nextTick()
    // scroll 事件不冒泡，但捕获阶段能在 document 上收到任意滚动容器的滚动
    document.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll, { passive: true })
    maybeLoadMore()
})

onBeforeUnmount(() => {
    document.removeEventListener('scroll', handleScroll, true)
    window.removeEventListener('resize', handleScroll)
})

// 列表追加后如果仍接近底部（例如首屏不足一屏），继续加载下一页
watch(items, () => {
    void nextTick(maybeLoadMore)
})

watch(keywordModel, (raw) => {
    if (searchTimer) clearTimeout(searchTimer)
    const apply = () => {
        keyword.value = (raw || '').trim()
        void loadPage(true)
    }
    if (!raw) apply()
    else searchTimer = setTimeout(apply, 350)
})

function handleSelectCategory(categoryId: string) {
    selectedCategory.value = selectedCategory.value === categoryId ? '' : categoryId
    void loadPage(true)
}

// ── 详情 ──

async function fetchDetail(slug: string) {
    const cached = detailCache.get(slug)
    if (cached) {
        detail.value = cached
        detailError.value = null
        detailLoading.value = false
        return
    }

    const seq = ++detailSeq
    detailLoading.value = true
    detailError.value = null
    detail.value = null

    try {
        const response = await apiService.fetchSkillHubDetail(slug, lang())
        detailCache.set(slug, response)
        if (seq === detailSeq && selectedSkill.value?.id === slug) {
            detail.value = response
        }
    } catch (err) {
        if (seq === detailSeq && selectedSkill.value?.id === slug) {
            detailError.value = getErrorMessage(err) || t('plugins.skills.skillhubDetailFailed')
        }
    } finally {
        if (seq === detailSeq) detailLoading.value = false
    }
}

function handleShowDialog(skill: ItemWithStatus) {
    selectedSkill.value = skill
    installError.value = null
    detailError.value = null
    detail.value = detailCache.get(skill.id) ?? null
    showInstallDialog.value = true

    if (detail.value) {
        // 让上一轮未完成的详情请求失效
        detailSeq += 1
        detailLoading.value = false
    } else {
        void fetchDetail(skill.id)
    }
}

// ── 安装 ──

async function handleInstall(skill: ItemWithStatus) {
    installing.value.add(skill.id)
    installError.value = null

    try {
        // 已安装时走覆盖安装：升级/重装必须带 force，否则后端会以目录已存在拒绝
        const force = skill.localStatus !== 'not_installed'
        const response = await apiService.installSkillHubSkill({
            slug: skill.id,
            ...(skill.version ? { version: skill.version } : {}),
            force,
        })

        if (response.success) {
            toast.success(response.message || t('common.createSuccess'))
            showInstallDialog.value = false
            selectedSkill.value = null
            detail.value = null
            emit('installed')
        } else {
            const message = response.message || t('plugins.skills.installFailed')
            installError.value = message
            if (!showInstallDialog.value) toast.error(message)
        }
    } catch (err) {
        console.error('从 SkillHub 安装技能失败:', err)
        const message = getErrorMessage(err) || t('plugins.skills.installFailed')
        installError.value = message
        if (!showInstallDialog.value) toast.error(message)
    } finally {
        installing.value.delete(skill.id)
    }
}

// 运行时切换语言：重置筛选与详情缓存，按新语言重载
function handleLocaleChange() {
    keywordModel.value = ''
    keyword.value = ''
    selectedCategory.value = ''
    currentPage.value = 1
    detailCache.clear()
    detail.value = null
    detailError.value = null
    selectedSkill.value = null
    showInstallDialog.value = false
    void loadCategories()
    void loadPage(true)
}

watch(getLocale, handleLocaleChange)

watch(() => props.active, (value) => { if (value) activate() }, { immediate: true })

defineExpose({
    refresh: handleRefresh,
    loading,
})
</script>

<style scoped>
/* 分类 chips 的几何统一在 PluginViewSwitch.vue 的 .plugins-chip 上；
   这里只补选中态文字色（与官网市场一致）。 */
.plugins-chip.is-active {
    color: var(--gd-color-sidebar-text-active);
}

.skillhub-install {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.skillhub-install__head {
    display: flex;
    align-items: center;
    gap: 12px;
}

.skillhub-install__title {
    flex: 1;
    min-width: 0;
}

.skillhub-install__name {
    font-size: calc(var(--gd-size-text-base) + 3px);
    font-weight: 600;
    line-height: 1.3;
    color: var(--gd-color-text);
    word-break: break-word;
}

.skillhub-install__meta {
    margin-top: 2px;
    font-size: calc(var(--gd-size-text-base) - 2px);
    color: var(--gd-md-text-secondary);
}

.skillhub-install__labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.skillhub-install__desc {
    max-height: 7.5em;
    overflow-y: auto;
    font-size: calc(var(--gd-size-text-base) - 1px);
    color: var(--gd-color-text);
}

.skillhub-install__desc--empty {
    margin: 0;
    color: var(--gd-md-text-secondary);
}

/* 统计：三等分、无界浅底 */
.skillhub-stats {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-radius: var(--gd-md-radius);
    background: var(--gd-color-surface-subtle);
}

.skillhub-stat {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
}

.skillhub-stat__value {
    font-size: calc(var(--gd-size-text-base) + 2px);
    font-weight: 600;
    color: var(--gd-color-text);
}

.skillhub-stat__label {
    font-size: calc(var(--gd-size-text-base) - 3px);
    color: var(--gd-md-text-secondary);
}

/* 安全 / 质量区块 */
.skillhub-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.skillhub-section__title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: calc(var(--gd-size-text-base) - 2px);
    font-weight: 600;
    color: var(--gd-color-text);
}

.skillhub-section__summary {
    margin: 0;
    font-size: calc(var(--gd-size-text-base) - 2px);
    line-height: 1.5;
    color: var(--gd-md-text-secondary);
}

.skillhub-section__muted {
    font-size: calc(var(--gd-size-text-base) - 2px);
    color: var(--gd-md-text-secondary);
}

.skillhub-quality__total {
    font-weight: 600;
    color: var(--gd-color-primary);
}

.skillhub-dim {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: calc(var(--gd-size-text-base) - 3px);
    color: var(--gd-md-text-secondary);
}

.skillhub-dim__name {
    flex: 0 0 52px;
    white-space: nowrap;
}

.skillhub-dim__bar {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--gd-color-text) 10%, transparent);
    overflow: hidden;
}

.skillhub-dim__fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--gd-color-primary);
    transition: width 0.2s ease;
}

.skillhub-dim__score {
    flex: 0 0 24px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* 决策信息（与官网市场弹窗口径一致） */
.skillhub-install__facts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--gd-md-radius);
    background: var(--gd-color-surface-subtle);
}

.skillhub-install__fact {
    display: flex;
    gap: 12px;
    font-size: calc(var(--gd-size-text-base) - 2px);
}

.skillhub-install__fact-k {
    flex: 0 0 60px;
    color: var(--gd-md-text-secondary);
}

.skillhub-install__fact-v {
    flex: 1;
    min-width: 0;
    color: var(--gd-color-text);
    word-break: break-word;
}

.skillhub-install__notice {
    margin: 0;
}

.skillhub-install__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 12px;
}

.skillhub-install__links {
    display: flex;
    align-items: center;
    gap: 4px;
}

.skillhub-install__ext {
    margin-left: 2px;
    width: 12px;
    height: 12px;
    opacity: 0.7;
}

.skillhub-install__cta {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* 卡片第三行：收藏/下载（图标 + 数字，次级信息） */
.skillhub-row-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 8px;
    font-size: var(--gd-size-text-xs);
    line-height: 16px;
    color: var(--gd-color-text-gray);
    white-space: nowrap;
}

.skillhub-row-meta__item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

.skillhub-row-meta__icon {
    width: 13px;
    height: 13px;
    opacity: 0.8;
}

/* ── 滚动加载更多 ── */
.skillhub-load-more {    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    margin-top: 12px;
}

.skillhub-load-more__hint {
    border: 0;
    background: transparent;
    font-size: calc(var(--gd-size-text-base) - 2px);
    color: var(--gd-md-text-secondary);
    cursor: pointer;
    transition: color 0.15s;
}

.skillhub-load-more__hint:hover {
    color: var(--gd-color-primary);
}

.skillhub-load-more__end {
    font-size: calc(var(--gd-size-text-base) - 3px);
    color: var(--gd-md-text-secondary);
}
</style>
