<template>
    <!-- 标题行与搜索框已上移到父级视图条；组件常驻（父级用 v-show），切回来不重新请求 -->
    <div class="plugins-skill-market">
        <!-- 标签筛选 chips（单选）：市场视图自己的第一行 -->
        <div v-show="labels.length > 0" class="plugins-filter-row">
            <button
                v-for="chip in labelChips"
                :key="`${chip.id}-${chip.index}`"
                type="button"
                class="plugins-chip"
                :class="{ 'is-active': chip.id === selectedLabelId }"
                @click="handleSelectLabel(chip.id)"
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

        <!-- 错误提示 -->
        <div v-else-if="error"
            class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-6 text-center">
            
                <MailInbox24Regular class="mb-2 opacity-50 text-gray-400 w-8 h-8"  />
            
            <div class="text-sm text-gray-500 dark:text-[#8b8d95]">
                {{ error }}
            </div>
        </div>

        <!-- 空结果（浏览模式） -->
        <div v-else-if="items.length === 0"
            class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-8 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
            {{ t('plugins.skills.marketEmptyResult') }}
        </div>

        <!-- 无界两列行列表 -->
        <div v-else-if="items.length > 0" class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
            <PluginListRow
                v-for="skill in items"
                :key="skill.id"
                :name="skill.name"
                :description="skill.description || t('plugins.skills.noDescription')"
                :icon-src="skill.icon"
                @click="handleShowMarketInstallDialog(skill)"
            >
                <template #badges>
                    <GdTag v-if="skill.localStatus === 'installed'" type="success" size="small" effect="plain">{{ t('plugins.skills.marketInstalled') }}</GdTag>
                    <GdTag v-else-if="skill.localStatus === 'updatable'" type="warning" size="small" effect="plain">{{ t('plugins.skills.marketUpdatable') }}</GdTag>
                    <GdTag v-if="skill.lang !== skill.requestedLang" type="info" size="small" effect="plain">{{ t('plugins.skills.marketFallbackHint') }}</GdTag>
                    <GdTag v-for="(label, index) in (skill.labels || []).slice(0, 2)" :key="`${label.id}-${index}`" size="small" effect="light">
                        {{ label.name }}
                    </GdTag>
                </template>
                <template #actions>
                    <GdButton
                        size="small"
                        plain
                        :class="{ 'market-action': true, 'is-persistent': skill.localStatus === 'updatable' || installingFromMarket.has(skill.id) }"
                        :loading="installingFromMarket.has(skill.id)"
                        @click.stop="handleInstallFromMarketUrl(skill)"
                    >
                        {{ getMarketButtonLabel(skill) }}
                    </GdButton>
                </template>
            </PluginListRow>
        </div>

        <!-- 分页（仅浏览模式且有多页时显示）：与行列表 gap-y 对齐，上间距收到 12px -->
        <div v-if="pagination && pagination.totalPages > 1" class="mt-3 flex justify-center">
            <GdPagination :total="pagination.total" :page-size="pagination.pageSize"
                :model-value="pagination.page" @change="handlePageChange" />
        </div>

        <!-- 市场技能安装对话框：对象先行（图标+名称+版本状态），次要动作降为文字链接，
             决策信息（安装方式/位置/覆盖影响）在点安装前给全，失败就地反馈 -->
        <GdDialog v-model="showMarketInstallDialog" :title="t('plugins.skills.marketInstallTitle')" size="sm"
            align-center destroy-on-close>
            <div v-if="selectedMarketSkill" class="market-install">
                <!-- 主视觉 -->
                <div class="market-install__head">
                    <CardAvatar :src="selectedMarketSkill.icon" :name="selectedMarketSkill.name" size="lg" />
                    <div class="market-install__title">
                        <div class="market-install__name">{{ selectedMarketSkill.name }}</div>
                        <div v-if="selectedMarketSkill.version || selectedMarketSkill.localVersion"
                            class="market-install__meta">
                            <span v-if="selectedMarketSkill.version">v{{ selectedMarketSkill.version }}</span>
                            <span v-if="selectedMarketSkill.version && selectedMarketSkill.localVersion"> · </span>
                            <span v-if="selectedMarketSkill.localVersion">{{
                                t('plugins.skills.marketLocalVersion', { version: selectedMarketSkill.localVersion })
                            }}</span>
                        </div>
                    </div>
                    <GdTag v-if="selectedMarketSkill.localStatus === 'updatable'" type="warning" size="small"
                        effect="plain">{{ t('plugins.skills.marketUpdatable') }}</GdTag>
                    <GdTag v-else-if="selectedMarketSkill.localStatus === 'installed'" type="success" size="small"
                        effect="plain">{{ t('plugins.skills.marketInstalled') }}</GdTag>
                </div>

                <div v-if="selectedMarketSkill.labels?.length" class="market-install__labels">
                    <GdTag v-for="(label, index) in selectedMarketSkill.labels" :key="`${label.id}-${index}`" size="small">{{ label.name }}</GdTag>
                </div>

                <MarkdownContent v-if="selectedMarketSkill.description" class="market-install__desc"
                    :content="selectedMarketSkill.description" />
                <p v-else class="market-install__desc market-install__desc--empty">
                    {{ t('plugins.skills.noDescription') }}
                </p>

                <!-- 决策信息：从哪来、装到哪 -->
                <div class="market-install__facts">
                    <div v-if="getInstallUrl(selectedMarketSkill, 'zip')" class="market-install__fact">
                        <span class="market-install__fact-k">{{ t('plugins.skills.marketInstallMethod') }}</span>
                        <span class="market-install__fact-v">{{ t('plugins.skills.marketInstallMethodZip') }}</span>
                    </div>
                    <div class="market-install__fact">
                        <span class="market-install__fact-k">{{ t('plugins.skills.marketInstallScope') }}</span>
                        <span class="market-install__fact-v">{{ t('plugins.skills.marketInstallScopeGlobal') }}</span>
                    </div>
                </div>

                <!-- 覆盖/升级影响 -->
                <GdAlert v-if="selectedMarketSkill.localStatus === 'updatable'" class="market-install__notice"
                    type="warning" :closable="false"
                    :title="t('plugins.skills.marketUpgradeNotice', { from: selectedMarketSkill.localVersion || '?', to: selectedMarketSkill.version || '?' })" />
                <GdAlert v-else-if="selectedMarketSkill.localStatus === 'installed'" class="market-install__notice"
                    type="info" :closable="false" :title="t('plugins.skills.marketReinstallNotice')" />

                <!-- 失败就地反馈（不依赖一闪而过的 toast） -->
                <GdAlert v-if="marketInstallError" class="market-install__notice" type="error" :closable="false"
                    :title="t('plugins.skills.installFailed')" :description="marketInstallError" />

                <!-- 操作区：唯一实心主按钮 + 次级文字链接 -->
                <div class="market-install__actions">
                    <div class="market-install__links">
                        <GdButton v-if="getInstallUrl(selectedMarketSkill, 'git')" link type="primary"
                            @click="handleViewSourceCode(selectedMarketSkill)">
                            {{ t('plugins.skills.marketViewSource') }}
                            
                                <ArrowUpRight16Regular class="market-install__ext size-4"  />
                            
                        </GdButton>
                        <GdButton v-if="selectedMarketSkill.detailUrl" link type="primary"
                            @click="handleOpenDetailUrl(selectedMarketSkill)">
                            {{ t('plugins.skills.marketViewDetail') }}
                            
                                <ArrowUpRight16Regular class="market-install__ext size-4"  />
                            
                        </GdButton>
                    </div>
                    <div class="market-install__cta">
                        <GdButton @click="showMarketInstallDialog = false">{{ t('common.cancel') }}</GdButton>
                        <GdButton v-if="getInstallUrl(selectedMarketSkill, 'zip')" type="primary"
                            :loading="installingFromMarket.has(selectedMarketSkill.id)"
                            @click="handleInstallFromMarketUrl(selectedMarketSkill)">
                            <template #icon>
                                <ArrowDownload16Regular />
                            </template>
                            {{ getMarketButtonLabel(selectedMarketSkill) }}
                        </GdButton>
                    </div>
                </div>
            </div>
        </GdDialog>
    </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue';
import GdPagination from '@/components/ui/GdPagination.vue';
import GdTag from '@/components/ui/GdTag.vue';
import GdAlert from '@/components/ui/GdAlert.vue';
import { toast } from '@/components/ui/toastService';

import { ArrowDownload16Regular, ArrowUpRight16Regular, MailInbox24Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import {
    SkillMarketService,
    localeToMarketLang,
    type MarketSkillWithStatus,
    type MarketLabelInfo,
    type MarketPagination,
} from '@/services/SkillMarketService'
import { getLocale } from '@/locales'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import { openInExternalBrowser } from '@/utils/browserUtils'
import { applyMarketStatus, dedupeById } from '@/utils/marketStatus'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import PluginListRow from './PluginListRow.vue'
import type { Skill } from '@/types/skills'

const props = defineProps<{
    /** 本地已安装技能，用于市场项的安装状态匹配 */
    localSkills: Skill[]
    /** 父级当前是否停在市场视图：数据只在第一次进入时拉 */
    active: boolean
}>()

/** 搜索框在父级视图条上，关键词双向同步；内部防抖后才发请求 */
const keywordModel = defineModel<string>('keyword', { default: '' })

const emit = defineEmits<{
    /** 市场安装成功，父组件刷新本地技能列表 */
    installed: []
}>()

const { t } = useI18n()

// ── 列表状态 ──
const items = ref<MarketSkillWithStatus[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const pagination = ref<MarketPagination | null>(null)

// 搜索与筛选
const keyword = ref('')
const selectedLabelId = ref<string>('')
const labels = ref<MarketLabelInfo[]>([])
const currentPage = ref(1)
const PAGE_SIZE = 12

let searchTimer: ReturnType<typeof setTimeout> | null = null

// 浏览模式：有关键词或选了标签；否则为推荐模式
const isBrowseMode = computed(() => keyword.value !== '' || selectedLabelId.value !== '')

/** 刷新时骨架行数与当前列表接近，避免高度跳动 */
const skeletonCount = computed(() => Math.max(4, Math.min(items.value.length, 12)))

const labelChips = computed(() => [
    { id: '', name: t('plugins.skills.marketFilterAll'), index: 0 },
    ...labels.value.map((l, i) => ({ id: l.id, name: l.name, index: i + 1 })),
])

// ── 安装弹窗状态 ──
const showMarketInstallDialog = ref(false)
const selectedMarketSkill = ref<MarketSkillWithStatus | null>(null)
const installingFromMarket = ref<Set<string>>(new Set())
/** 安装失败详情（就地展示在弹窗内，避免 toast 一闪而过无法排查） */
const marketInstallError = ref<string | null>(null)

/**
 * 获取指定类型的安装 URL
 */
function getInstallUrl(skill: MarketSkillWithStatus, type: 'zip' | 'git'): string | undefined {
    return skill.installUrls?.find(u => u.type === type)?.url
}

/**
 * 显示市场技能安装弹窗
 */
function handleShowMarketInstallDialog(marketSkill: MarketSkillWithStatus) {
    selectedMarketSkill.value = marketSkill
    marketInstallError.value = null
    showMarketInstallDialog.value = true
}

/**
 * 从市场安装技能（ZIP 方式）
 */
async function handleInstallFromMarketUrl(marketSkill: MarketSkillWithStatus) {
    const zipUrl = getInstallUrl(marketSkill, 'zip')
    if (!zipUrl) {
        toast.warning(t('plugins.skills.marketNoZip'))
        return
    }

    installingFromMarket.value.add(marketSkill.id)
    marketInstallError.value = null

    try {
        // 已安装时走覆盖安装：升级/重装必须带 force，否则后端会以目录已存在拒绝
        const force = marketSkill.localStatus !== 'not_installed'
        const response = await apiService.installSkillFromUrl(zipUrl, force, {
            source: 'official',
            itemId: marketSkill.id,
            ...(marketSkill.version ? { version: marketSkill.version } : {}),
        })
        if (response.success) {
            toast.success(response.message || t('common.createSuccess'))
            showMarketInstallDialog.value = false
            selectedMarketSkill.value = null
            emit('installed')
        } else {
            marketInstallError.value = response.message || t('plugins.skills.installFailed')
        }
    } catch (err) {
        console.error('从市场安装技能失败:', err)
        marketInstallError.value = getErrorMessage(err) || t('plugins.skills.installFailed')
    } finally {
        installingFromMarket.value.delete(marketSkill.id)
    }
}

/**
 * 访问仓库（Git）
 */
function handleViewSourceCode(marketSkill: MarketSkillWithStatus) {
    const gitUrl = getInstallUrl(marketSkill, 'git')
    if (!gitUrl) {
        toast.warning(t('plugins.skills.marketNoGit'))
        return
    }
    openInExternalBrowser(gitUrl)
}

/**
 * 打开技能详情页
 */
function handleOpenDetailUrl(marketSkill: MarketSkillWithStatus) {
    if (!marketSkill.detailUrl) {
        toast.warning(t('plugins.skills.marketNoDetail'))
        return
    }
    openInExternalBrowser(marketSkill.detailUrl)
}

/**
 * 更新所有市场技能的状态（优先按安装来源匹配，回退到名称匹配）
 */
function refreshStatus() {
    items.value = applyMarketStatus(dedupeById(items.value), props.localSkills, 'official')
}

watch(() => props.localSkills, refreshStatus, { deep: true })

/**
 * 获取市场技能按钮文案
 */
function getMarketButtonLabel(skill: MarketSkillWithStatus): string {
    switch (skill.localStatus) {
        case 'updatable': return t('plugins.skills.marketUpgradeBtn')
        case 'installed': return t('plugins.skills.marketReinstallBtn')
        default: return t('plugins.skills.marketInstallBtn')
    }
}

// ── 数据加载 ──

/** 请求序号：快速切换搜索/标签时丢弃过期响应 */
let loadSeq = 0

/**
 * 推荐模式：随机推荐列表（带缓存，无分页）
 */
async function loadRecommend(forceRefresh: boolean = false): Promise<MarketSkillWithStatus[]> {
    const startTime = Date.now()
    const lang = localeToMarketLang(getLocale())
    const remoteSkills = await SkillMarketService.fetchMarketSkills(lang, !forceRefresh)

    // 仅手动刷新时确保至少显示 500ms 的加载动画
    if (forceRefresh) {
        const elapsed = Date.now() - startTime
        if (elapsed < 500) {
            await new Promise(resolve => setTimeout(resolve, 500 - elapsed))
        }
    }

    return remoteSkills.map(skill => ({
        ...skill,
        localStatus: 'not_installed' as const,
    }))
}

/**
 * 浏览模式：关键词/标签过滤的分页列表
 */
async function loadBrowse(): Promise<{ items: MarketSkillWithStatus[]; pagination: MarketPagination }> {
    const lang = localeToMarketLang(getLocale())
    const response = await SkillMarketService.fetchMarketList({
        page: currentPage.value,
        pageSize: PAGE_SIZE,
        keyword: keyword.value || undefined,
        labelId: selectedLabelId.value || undefined,
        lang,
    })

    return {
        items: response.items.map(skill => ({
            ...skill,
            localStatus: 'not_installed' as const,
        })),
        pagination: response.pagination,
    }
}

/**
 * 按当前模式加载市场列表；forceRefresh 仅作用于推荐模式（绕过缓存）
 */
async function loadMarket(forceRefresh: boolean = false) {
    // 懒加载门控集中在唯一出口：搜索、标签、分页、换一批在首次进入市场前都不会发请求
    if (!activated.value) return

    const seq = ++loadSeq
    loading.value = true
    error.value = null

    try {
        let nextItems: MarketSkillWithStatus[]
        let nextPagination: MarketPagination | null
        if (isBrowseMode.value) {
            const result = await loadBrowse()
            nextItems = result.items
            nextPagination = result.pagination
        } else {
            nextItems = await loadRecommend(forceRefresh)
            nextPagination = null
        }

        // 过期响应（用户已切换搜索/标签）直接丢弃
        if (seq !== loadSeq) return

        items.value = nextItems
        pagination.value = nextPagination
        lastLoadedAt.value = Date.now()
        // 与本地技能匹配，更新状态（内部会按 id 去重）
        refreshStatus()
    } catch (err) {
        if (seq !== loadSeq) return
        console.error('加载市场技能失败:', err)
        const message = getErrorMessage(err) || t('plugins.skills.marketError')
        if (items.value.length > 0) {
            // 刷新失败时保留已有列表，避免整页闪成错误态
            toast.error(message)
        } else {
            error.value = message
            items.value = []
            pagination.value = null
        }
    } finally {
        if (seq === loadSeq) loading.value = false
    }
}

/** 首次进入市场视图才拉数据；未激活时所有加载出口都直接返回 */
const activated = ref(false)
/** 上次成功加载时间：切回视图时只有超过 60s 才自动刷新 */
const lastLoadedAt = ref(0)

function activate() {
    if (!activated.value) {
        activated.value = true
        void loadLabels()
        void loadMarket()
        return
    }
    // 切回视图：数据已新鲜就直接展示（配合视图淡入动画）；
    // 超过 60s 才在后台刷新，用顶部进度条给出反馈，避免每次切换都换一批。
    if (!loading.value && Date.now() - lastLoadedAt.value > 60_000) {
        void loadMarket()
    }
}

/**
 * 加载标签筛选列表
 */
async function loadLabels() {
    if (!activated.value) return
    try {
        labels.value = await SkillMarketService.fetchMarketLabels(localeToMarketLang(getLocale()))
    } catch (err) {
        console.error('加载市场标签失败:', err)
        // 标签加载失败不阻塞主列表，仅隐藏筛选行
        labels.value = []
    }
}

/**
 * 「换一批」：推荐模式强制绕过缓存；浏览模式下重新请求当前页
 */
function handleRefresh() {
    void loadMarket(!isBrowseMode.value)
}

/**
 * 父级搜索框变化：防抖 350ms 后进入浏览模式；清空立即回到推荐模式
 * （清空还走防抖会让「全部」状态慢半拍，看起来像没生效）。
 */
watch(keywordModel, (raw) => {
    if (searchTimer) clearTimeout(searchTimer)
    const apply = () => {
        keyword.value = (raw || '').trim()
        currentPage.value = 1
        void loadMarket()
    }
    if (!raw) apply()
    else searchTimer = setTimeout(apply, 350)
})

/**
 * 选择标签 chip；再点一次取消回到「全部」
 */
function handleSelectLabel(labelId: string) {
    selectedLabelId.value = selectedLabelId.value === labelId ? '' : labelId
    currentPage.value = 1
    void loadMarket()
}

/**
 * 分页切换
 */
function handlePageChange(page: number) {
    currentPage.value = page
    void loadMarket()
}

// 运行时切换语言后按新语言重载标签与列表（缓存已按语言隔离）
function handleLocaleChange() {
    keywordModel.value = ''
    keyword.value = ''
    selectedLabelId.value = ''
    currentPage.value = 1
    void loadLabels()
    void loadMarket()
}

watch(getLocale, handleLocaleChange)

// 首次切到市场视图才请求；父级直接以市场视图打开地址（?view=market）时 immediate 会立刻补一次
watch(() => props.active, (value) => { if (value) activate() }, { immediate: true })

/** 搜索框与「换一批」搬到了父级视图条，这里只暴露动作与状态 */
defineExpose({
    refresh: handleRefresh,
    loading,
})
</script>

<style scoped>
/* 标签筛选 chips 的几何统一在 PluginViewSwitch.vue 的 .plugins-chip 上（与已安装来源
   chips 同一档）。这里只补选中态文字色：全局块给的是正文色，本区块保持原有 token。 */
.plugins-skill-market .plugins-chip.is-active {
    color: var(--gd-color-sidebar-text-active);
}

/* ── 市场安装弹窗 ──
   对象先行（图标+名称+版本为主视觉），次要动作降为文字链接、唯一实心主按钮；
   颜色全部取自 markdown token：暗色下变量值本身会翻转，无需再写 .dark 分支 */
.market-install {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.market-install__head {
    display: flex;
    align-items: center;
    gap: 12px;
}

.market-install__title {
    flex: 1;
    min-width: 0;
}

.market-install__name {
    font-size: calc(var(--gd-size-text-base) + 3px);
    font-weight: 600;
    line-height: 1.3;
    color: var(--gd-color-text);
    word-break: break-word;
}

.market-install__meta {
    margin-top: 2px;
    font-size: calc(var(--gd-size-text-base) - 2px);
    color: var(--gd-md-text-secondary);
}

.market-install__labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

/* 描述限高滚动：长描述不把弹窗撑成一篇文档 */
.market-install__desc {
    max-height: 7.5em;
    overflow-y: auto;
    font-size: calc(var(--gd-size-text-base) - 1px);
    color: var(--gd-color-text);
}

.market-install__desc--empty {
    margin: 0;
    color: var(--gd-md-text-secondary);
}

/* 决策信息：从哪来、装到哪（无界：浅底块，无描边） */
.market-install__facts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--gd-md-radius);
    background: var(--gd-color-surface-subtle);
}

.market-install__fact {
    display: flex;
    gap: 12px;
    font-size: calc(var(--gd-size-text-base) - 2px);
}

.market-install__fact-k {
    flex: 0 0 60px;
    color: var(--gd-md-text-secondary);
}

.market-install__fact-v {
    flex: 1;
    min-width: 0;
    color: var(--gd-color-text);
    word-break: break-word;
}

.market-install__notice {
    margin: 0;
}

/* 操作区：左侧外链文字动作，右侧取消 + 唯一主按钮（无界：仅留间距） */
.market-install__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 12px;
}

.market-install__links {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* 外链指示：提示会跳出应用 */
.market-install__ext {
    margin-left: 2px;
    width: 12px;
    height: 12px;
    opacity: 0.7;
}

.market-install__cta {
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
