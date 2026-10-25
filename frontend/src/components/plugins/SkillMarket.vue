<template>
    <div class="mt-8">
        <!-- 标题行：标题 + 搜索框 -->
        <div class="mb-4 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
                <span class="text-lg font-semibold">{{ t('plugins.skills.marketTitle') }}</span>
                <el-button link size="small" :loading="loading" @click="handleRefresh">
                    <template #icon>
                        <el-icon :class="{ 'is-loading': loading }">
                            <ArrowClockwise16Regular />
                        </el-icon>
                    </template>
                    {{ loading ? t('common.loading') : t('plugins.skills.marketRefresh') }}
                </el-button>
            </div>
            <el-input
                v-model="keywordInput"
                :placeholder="t('plugins.skills.marketSearchPlaceholder')"
                clearable
                size="default"
                class="market-search"
                @input="handleKeywordInput"
                @clear="handleKeywordCleared"
            >
                <template #prefix>
                    <el-icon><Search /></el-icon>
                </template>
            </el-input>
        </div>

        <!-- 标签筛选 chips（单选） -->
        <div v-if="labels.length > 0" class="mb-4 flex flex-wrap items-center gap-2">
            <button
                v-for="chip in labelChips"
                :key="`${chip.id}-${chip.index}`"
                type="button"
                class="market-chip"
                :class="{ 'market-chip--active': chip.id === selectedLabelId }"
                @click="handleSelectLabel(chip.id)"
            >
                {{ chip.name }}
            </button>
        </div>

        <!-- 错误提示 -->
        <div v-if="error"
            class="rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) p-6 text-center">
            <el-icon size="32" class="mb-2 opacity-50 text-gray-400">
                <InboxOutlined />
            </el-icon>
            <div class="text-sm text-gray-500 dark:text-[#8b8d95]">
                {{ error }}
            </div>
        </div>

        <!-- 空结果（浏览模式） -->
        <div v-else-if="!loading && items.length === 0"
            class="rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) p-8 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
            {{ t('plugins.skills.marketEmptyResult') }}
        </div>

        <!-- 竖版卡片网格 -->
        <div v-else-if="items.length > 0" class="grid gap-4"
            style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
            <MarketSkillCard
                v-for="skill in items"
                :key="skill.id"
                :skill="skill"
                :installing="installingFromMarket.has(skill.id)"
                @click="handleShowMarketInstallDialog(skill)"
                @install="handleInstallFromMarketUrl(skill)"
            />
        </div>

        <!-- 分页（仅浏览模式且有多页时显示） -->
        <div v-if="pagination && pagination.totalPages > 1" class="mt-4 flex justify-center">
            <el-pagination
                layout="prev, pager, next"
                :total="pagination.total"
                :page-size="pagination.pageSize"
                :current-page="pagination.page"
                @current-change="handlePageChange"
            />
        </div>

        <!-- 底部提示 -->
        <div class="mt-6 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
            {{ t('plugins.skills.marketFooterPrefix') }}<span class="text-blue-500 cursor-pointer hover:underline" @click="openInExternalBrowser('https://ai.dingd.cn/skills')">{{ t('plugins.skills.marketLink') }}</span>{{ t('plugins.skills.marketFooterSuffix') }}
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
                    <el-tag v-if="selectedMarketSkill.localStatus === 'updatable'" type="warning" size="small"
                        effect="plain">{{ t('plugins.skills.marketUpdatable') }}</el-tag>
                    <el-tag v-else-if="selectedMarketSkill.localStatus === 'installed'" type="success" size="small"
                        effect="plain">{{ t('plugins.skills.marketInstalled') }}</el-tag>
                </div>

                <div v-if="selectedMarketSkill.labels?.length" class="market-install__labels">
                    <el-tag v-for="(label, index) in selectedMarketSkill.labels" :key="`${label.id}-${index}`" size="small">{{ label.name }}</el-tag>
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
                <el-alert v-if="selectedMarketSkill.localStatus === 'updatable'" class="market-install__notice"
                    type="warning" :closable="false"
                    :title="t('plugins.skills.marketUpgradeNotice', { from: selectedMarketSkill.localVersion || '?', to: selectedMarketSkill.version || '?' })" />
                <el-alert v-else-if="selectedMarketSkill.localStatus === 'installed'" class="market-install__notice"
                    type="info" :closable="false" :title="t('plugins.skills.marketReinstallNotice')" />

                <!-- 失败就地反馈（不依赖一闪而过的 toast） -->
                <el-alert v-if="marketInstallError" class="market-install__notice" type="error" :closable="false"
                    :title="t('plugins.skills.installFailed')" :description="marketInstallError" />

                <!-- 操作区：唯一实心主按钮 + 次级文字链接 -->
                <div class="market-install__actions">
                    <div class="market-install__links">
                        <el-button v-if="getInstallUrl(selectedMarketSkill, 'git')" link type="primary"
                            @click="handleViewSourceCode(selectedMarketSkill)">
                            {{ t('plugins.skills.marketViewSource') }}
                            <el-icon class="market-install__ext">
                                <TopRight />
                            </el-icon>
                        </el-button>
                        <el-button v-if="selectedMarketSkill.detailUrl" link type="primary"
                            @click="handleOpenDetailUrl(selectedMarketSkill)">
                            {{ t('plugins.skills.marketViewDetail') }}
                            <el-icon class="market-install__ext">
                                <TopRight />
                            </el-icon>
                        </el-button>
                    </div>
                    <div class="market-install__cta">
                        <el-button @click="showMarketInstallDialog = false">{{ t('common.cancel') }}</el-button>
                        <el-button v-if="getInstallUrl(selectedMarketSkill, 'zip')" type="primary"
                            :loading="installingFromMarket.has(selectedMarketSkill.id)"
                            @click="handleInstallFromMarketUrl(selectedMarketSkill)">
                            <template #icon>
                                <ArrowDownload16Regular />
                            </template>
                            {{ getMarketButtonLabel(selectedMarketSkill) }}
                        </el-button>
                    </div>
                </div>
            </div>
        </GdDialog>
    </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElTag, ElIcon, ElInput, ElButton, ElAlert, ElPagination } from 'element-plus'
import { Search, TopRight } from '@element-plus/icons-vue'
import { InboxOutlined } from '@vicons/material'
import { ArrowDownload16Regular, ArrowClockwise16Regular } from '@vicons/fluent'
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
import CardAvatar from '@/components/ui/CardAvatar.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import MarketSkillCard from './MarketSkillCard.vue'
import type { Skill } from '@/types/skills'

const props = defineProps<{
    /** 本地已安装技能，用于市场项的安装状态匹配 */
    localSkills: Skill[]
}>()

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
const keywordInput = ref('')
const keyword = ref('')
const selectedLabelId = ref<string>('')
const labels = ref<MarketLabelInfo[]>([])
const currentPage = ref(1)
const PAGE_SIZE = 12

let searchTimer: ReturnType<typeof setTimeout> | null = null

// 浏览模式：有关键词或选了标签；否则为推荐模式
const isBrowseMode = computed(() => keyword.value !== '' || selectedLabelId.value !== '')

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
        ElMessage.warning(t('plugins.skills.marketNoZip'))
        return
    }

    installingFromMarket.value.add(marketSkill.id)
    marketInstallError.value = null

    try {
        const response = await apiService.installSkillFromUrl(zipUrl)
        if (response.success) {
            ElMessage.success(response.message || t('common.createSuccess'))
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
        ElMessage.warning(t('plugins.skills.marketNoGit'))
        return
    }
    openInExternalBrowser(gitUrl)
}

/**
 * 打开技能详情页
 */
function handleOpenDetailUrl(marketSkill: MarketSkillWithStatus) {
    if (!marketSkill.detailUrl) {
        ElMessage.warning(t('plugins.skills.marketNoDetail'))
        return
    }
    openInExternalBrowser(marketSkill.detailUrl)
}

/**
 * 更新所有市场技能的状态（与本地已安装技能做名字匹配）
 */
function refreshStatus() {
    const localSkills = props.localSkills
    items.value = items.value.map(marketSkill => {
        const match = localSkills.find(
            local => local.manifest.name?.toLowerCase() === marketSkill.id?.toLowerCase()
        )
        if (!match) {
            return { ...marketSkill, localStatus: 'not_installed' as const }
        }

        // 名字匹配成功，比较版本
        const localVer = match.manifest.version
        const marketVer = marketSkill.version
        if (marketVer && localVer && marketVer !== localVer) {
            return { ...marketSkill, localStatus: 'updatable' as const, localVersion: localVer }
        }
        return { ...marketSkill, localStatus: 'installed' as const, localVersion: localVer }
    })
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

/**
 * 推荐模式：随机推荐列表（带缓存，无分页）
 */
async function loadRecommend(forceRefresh: boolean = false) {
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

    items.value = remoteSkills.map(skill => ({
        ...skill,
        localStatus: 'not_installed' as const,
    }))
    pagination.value = null
}

/**
 * 浏览模式：关键词/标签过滤的分页列表
 */
async function loadBrowse() {
    const lang = localeToMarketLang(getLocale())
    const response = await SkillMarketService.fetchMarketList({
        page: currentPage.value,
        pageSize: PAGE_SIZE,
        keyword: keyword.value || undefined,
        labelId: selectedLabelId.value || undefined,
        lang,
    })

    items.value = response.items.map(skill => ({
        ...skill,
        localStatus: 'not_installed' as const,
    }))
    pagination.value = response.pagination
}

/**
 * 按当前模式加载市场列表
 */
async function loadMarket() {
    if (loading.value) return

    loading.value = true
    error.value = null

    try {
        if (isBrowseMode.value) {
            await loadBrowse()
        } else {
            await loadRecommend()
        }
        // 与本地技能做名字匹配，更新状态
        refreshStatus()
    } catch (err) {
        console.error('加载市场技能失败:', err)
        error.value = getErrorMessage(err) || t('plugins.skills.marketError')
        items.value = []
        pagination.value = null
    } finally {
        loading.value = false
    }
}

/**
 * 加载标签筛选列表
 */
async function loadLabels() {
    try {
        labels.value = await SkillMarketService.fetchMarketLabels(localeToMarketLang(getLocale()))
    } catch (err) {
        console.error('加载市场标签失败:', err)
        // 标签加载失败不阻塞主列表，仅隐藏筛选行
        labels.value = []
    }
}

/**
 * 「换一批」：强制绕过缓存重新拉推荐列表；浏览模式下则重新请求当前页
 */
function handleRefresh() {
    if (isBrowseMode.value) {
        void loadMarket()
    } else {
        void loadMarket().then(() => {}) // 推荐模式同样走 loadMarket，loadRecommend 内部处理动画
    }
}

/**
 * 搜索输入防抖（350ms），输入即切换到浏览模式
 */
function handleKeywordInput() {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
        keyword.value = keywordInput.value.trim()
        currentPage.value = 1
        void loadMarket()
    }, 350)
}

/**
 * 清空搜索：立即回到推荐模式
 */
function handleKeywordCleared() {
    if (searchTimer) clearTimeout(searchTimer)
    keywordInput.value = ''
    keyword.value = ''
    currentPage.value = 1
    void loadMarket()
}

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
watch(getLocale, () => {
    keywordInput.value = ''
    keyword.value = ''
    selectedLabelId.value = ''
    currentPage.value = 1
    void loadLabels()
    void loadMarket()
})

onMounted(async () => {
    void loadLabels()
    await loadMarket()
})
</script>

<style scoped>
/* ── 搜索框 ── */
.market-search {
    width: 280px;
}

/* ── 标签筛选 chips（单选）──
   颜色取自 CSS 变量，暗色下变量值本身会翻转 */
.market-chip {
    padding: 4px 12px;
    font-size: 13px;
    line-height: 1.4;
    border: 1px solid var(--gd-color-surface-border);
    border-radius: 999px;
    background: var(--gd-color-surface);
    color: var(--gd-color-text);
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s;
}

.market-chip:hover {
    background: var(--gd-color-surface-subtle-hover);
}

.market-chip--active {
    background: var(--gd-color-sidebar-bg-active);
    border-color: transparent;
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

/* 按钮行各自用 gap 控制间距，取消 Element Plus 相邻按钮的默认 margin */
.market-install :deep(.el-button + .el-button) {
    margin-left: 0;
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

/* 决策信息：从哪来、装到哪 */
.market-install__facts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--gd-md-border);
    border-radius: var(--gd-md-radius);
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

/* 操作区：左侧外链文字动作，右侧取消 + 唯一主按钮 */
.market-install__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--gd-md-divider);
}

.market-install__links {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* 外链指示：提示会跳出应用 */
.market-install__ext {
    margin-left: 2px;
    font-size: 12px;
    opacity: 0.7;
}

.market-install__cta {
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
