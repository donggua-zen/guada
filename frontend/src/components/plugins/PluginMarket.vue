<template>
    <!-- 插件市场：官网索引浏览 + 一键安装（走既有 git 协议安装任务）
         作为「插件」tab 的二级视图嵌入 LocalTools（视图条/搜索由父级持有） -->
    <div class="flex-1">
        <!-- 标签筛选 -->
        <div v-show="tags.length > 0" class="plugins-filter-row">
            <button
                type="button"
                class="plugins-chip"
                :class="{ 'is-active': selectedTag === '' }"
                @click="handleSelectTag('')"
            >
                {{ t('plugins.market.tagAll') }}
            </button>
            <button
                v-for="tag in tags"
                :key="tag.name"
                type="button"
                class="plugins-chip"
                :class="{ 'is-active': tag.name === selectedTag }"
                @click="handleSelectTag(tag.name)"
            >
                {{ tag.name }}
                <span class="market-chip-count">{{ tag.count }}</span>
            </button>
        </div>

        <!-- 加载中骨架 -->
        <div v-if="loading" class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
            <div v-for="i in 6" :key="i" class="plugins-skeleton" aria-hidden="true">
                <span class="plugins-skeleton__avatar"></span>
                <span class="plugins-skeleton__lines">
                    <span class="plugins-skeleton__line plugins-skeleton__line--name"></span>
                    <span class="plugins-skeleton__line"></span>
                </span>
            </div>
        </div>

        <!-- 错误（官网不可达等；本地插件不受影响） -->
        <div v-else-if="error"
            class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-6 text-center">
            <MailInbox24Regular class="mb-2 opacity-50 text-gray-400 w-8 h-8 mx-auto" />
            <div class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ error }}</div>
            <GdButton class="mt-3" size="small" @click="handleRefresh">{{ t('common.retry') }}</GdButton>
        </div>

        <!-- 空结果 -->
        <div v-else-if="items.length === 0"
            class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-8 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
            {{ t('plugins.market.empty') }}
        </div>

        <!-- 两列行列表 -->
        <div v-else class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
            <PluginListRow
                v-for="plugin in items"
                :key="plugin.id"
                :name="plugin.name"
                :description="plugin.description || t('plugins.localTools.noDescription')"
                :icon-src="plugin.icon || undefined"
                @click="handleShowDialog(plugin)"
            >
                <template #badges>
                    <GdTag v-if="installedIds.has(plugin.id)" type="primary" size="small" effect="plain">
                        {{ t('plugins.market.installed') }}
                    </GdTag>
                </template>
                <template #meta>
                    <div class="market-row-meta">
                        <span v-if="plugin.latest?.version" class="market-row-meta__item">v{{ plugin.latest.version }}</span>
                        <span v-if="plugin.author" class="market-row-meta__item">{{ plugin.author }}</span>
                    </div>
                    <!-- 胶囊统一排在卡片底部独立一行：标题行只保留「已安装」；
                         标签最多露 2 个，其余折成 +N，避免底部也挤成一排 -->
                    <div v-if="plugin.verified || plugin.tags.length > 0" class="market-row-tags">
                        <GdTag v-if="plugin.verified" type="success" size="small" effect="light">
                            {{ t('plugins.market.verified') }}
                        </GdTag>
                        <GdTag v-for="tag in plugin.tags.slice(0, 2)" :key="tag" size="small" effect="light">
                            {{ tag }}
                        </GdTag>
                        <GdTag v-if="plugin.tags.length > 2" size="small" effect="light">
                            +{{ plugin.tags.length - 2 }}
                        </GdTag>
                    </div>
                </template>
                <template #actions>
                    <GdButton
                        size="small"
                        plain
                        :loading="installing.has(plugin.id)"
                        @click.stop="handleInstall(plugin)"
                    >
                        {{ installedIds.has(plugin.id) ? t('plugins.market.reinstall') : t('plugins.market.install') }}
                    </GdButton>
                </template>
            </PluginListRow>
        </div>

        <!-- 分页 -->
        <div v-if="!loading && !error && pagination.totalPages > 1" class="market-pagination">
            <GdPagination
                v-model="currentPage"
                :total="pagination.total"
                :page-size="pagination.pageSize"
            />
        </div>

        <!-- 详情弹窗 -->
        <GdDialog v-model="showDetailDialog" size="md" align-center destroy-on-close>
            <template #header>
                <div class="flex items-center gap-3">
                    <CardAvatar :src="currentPlugin?.icon || undefined" :name="currentPlugin?.name" size="md" />
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed] truncate">{{ currentPlugin?.name }}</span>
                        <GdTag v-if="currentPlugin?.verified" type="success" size="small" effect="light">
                            {{ t('plugins.market.verified') }}
                        </GdTag>
                    </div>
                </div>
            </template>

            <div v-if="currentPlugin" class="space-y-4">
                <div class="market-detail-meta">
                    <span v-if="currentPlugin.latest?.version">v{{ currentPlugin.latest.version }}</span>
                    <span v-if="currentPlugin.author">{{ t('plugins.market.author') }}: {{ currentPlugin.author }}</span>
                    <span>{{ t('plugins.market.downloads') }} {{ formatCount(currentPlugin.downloads) }}</span>
                </div>

                <!-- 截图（官网静态托管） -->
                <div v-if="detail?.screenshots?.length" class="market-shots">
                    <img
                        v-for="(shot, i) in detail.screenshots"
                        :key="i"
                        :src="shot"
                        class="market-shots__img"
                        loading="lazy"
                        alt=""
                    />
                </div>

                <div>
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">{{ t('plugins.localTools.descLabel') }}</div>
                    <p class="text-sm text-gray-700 dark:text-[#d0d1d5] leading-relaxed">{{ currentPlugin.description }}</p>
                </div>

                <div v-if="detail?.latest?.changelog">
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">{{ t('plugins.market.changelog') }}</div>
                    <p class="text-sm text-gray-700 dark:text-[#d0d1d5] leading-relaxed">{{ detail.latest.changelog }}</p>
                </div>

                <div v-if="currentPlugin.tags.length > 0" class="flex flex-wrap gap-1.5">
                    <GdTag v-for="tag in currentPlugin.tags" :key="tag" size="small">{{ tag }}</GdTag>
                </div>

                <!-- 安装源（可复制，也可走一键安装） -->
                <div>
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">{{ t('plugins.market.sourceLabel') }}</div>
                    <div class="market-source-row">
                        <code class="market-source-code">{{ currentPlugin.source.install }}</code>
                        <GdButton size="small" plain @click="copySource">{{ t('common.copy') }}</GdButton>
                    </div>
                </div>
            </div>

            <template #footer>
                <!-- 同一行按钮必须同 size 档位：之前「打开仓库」给了 small(28px)、
                     「安装」用默认 medium(32px)，同一行高度不一致 -->
                <GdButton v-if="currentPlugin?.repository" plain @click="openRepo">
                    {{ t('plugins.market.openRepo') }}
                </GdButton>
                <GdButton
                    v-if="currentPlugin"
                    type="primary"
                    :loading="installing.has(currentPlugin.id)"
                    @click="handleInstall(currentPlugin)"
                >
                    {{ t('plugins.market.install') }}
                </GdButton>
            </template>
        </GdDialog>

        <!-- 安装进度弹窗（复用假终端交互，与 LocalTools 一致） -->
        <GdDialog v-model="installDialogVisible" size="md" :close-on-click-modal="false" destroy-on-close @closed="cancelInstallPoll">
            <template #header>
                <span>{{ t('plugins.market.installingTitle') }}</span>
            </template>
            <div ref="installLogBox" class="market-install-terminal">
                <pre class="market-install-log">{{ installLog || t('plugins.localTools.installWaiting') }}</pre>
                <span v-if="installDialogActive" class="terminal-cursor"></span>
            </div>
            <template #footer>
                <GdButton v-if="installDialogActive" @click="cancelInstallPoll">{{ t('common.cancel') }}</GdButton>
                <GdButton v-else @click="installDialogVisible = false">{{ t('common.close') }}</GdButton>
            </template>
        </GdDialog>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue'
import GdTag from '@/components/ui/GdTag.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import GdPagination from '@/components/ui/GdPagination.vue'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import PluginListRow from './PluginListRow.vue'
// 引入视图条组件仅为加载其全局样式块（.plugins-chip / .plugins-skeleton 为非 scoped 共享样式）
import PluginViewSwitch from './PluginViewSwitch.vue'
import { toast } from '@/components/ui/toastService'
import { apiService } from '@/services/ApiService'
import { getErrorMessage } from '@/utils/errorMessage'
import type { MarketListResponse, MarketPlugin, MarketPluginDetail, MarketTag } from '@/services/modules/plugin.api'

// PluginViewSwitch 不渲染，只为样式副作用
void PluginViewSwitch

const props = defineProps<{
    /** 父级视图条是否已切到市场（首次进入才拉数据，与 McpMarket/SkillHubMarket 同契约） */
    active: boolean
}>()

const emit = defineEmits<{
    /** 安装成功（父级刷新本地列表，同步已安装徽标） */
    installed: []
}>()

/** 搜索词由父级视图条持有（v-model:keyword） */
const keywordModel = defineModel<string>('keyword', { default: '' })

const { t } = useI18n()

// ── 列表状态 ──
const loading = ref(false)
const error = ref('')
const items = ref<MarketPlugin[]>([])
const tags = ref<MarketTag[]>([])
const pagination = ref<MarketListResponse['pagination']>({ page: 1, pageSize: 12, total: 0, totalPages: 0 })
const currentPage = ref(1)
const selectedTag = ref('')
const activated = ref(false)

// 已安装集合（与本地 /plugins/query 结果比对出徽标）
const installedIds = ref<Set<string>>(new Set())

const installing = ref<Set<string>>(new Set())

// ── 详情弹窗 ──
const showDetailDialog = ref(false)
const currentPlugin = ref<MarketPlugin | null>(null)
const detail = ref<MarketPluginDetail | null>(null)

// ── 安装假终端（与 LocalTools 同款交互） ──
const installDialogVisible = ref(false)
const installLog = ref('')
const installLogBox = ref<HTMLElement | null>(null)
// 弹窗内是否处于"安装中"：控制终端光标与 取消/关闭 按钮。
// 不能用 installing（Set）判断——Set 对象恒为真，安装结束后按钮永远是「取消」且点了不关窗
const installDialogActive = ref(false)
let installPollCancelled = false
let activeInstallJobId: string | null = null

// 父级搜索词 → 列表查询（防抖 400ms，与官网 Skills 页一致）
let keywordDebounce: ReturnType<typeof setTimeout> | null = null
watch(keywordModel, () => {
    if (!activated.value) return
    if (keywordDebounce) clearTimeout(keywordDebounce)
    keywordDebounce = setTimeout(() => {
        currentPage.value = 1
        void loadList()
    }, 400)
})

async function loadList() {
    loading.value = true
    error.value = ''
    try {
        const keyword = (keywordModel.value || '').trim()
        const res = await apiService.fetchMarketList({
            page: currentPage.value,
            pageSize: 12,
            keyword: keyword || undefined,
            tag: selectedTag.value || undefined,
        })
        items.value = res.items
        pagination.value = res.pagination
    } catch (err) {
        error.value = getErrorMessage(err) || t('plugins.market.loadFailed')
        items.value = []
        pagination.value = { page: 1, pageSize: 12, total: 0, totalPages: 0 }
    } finally {
        loading.value = false
    }
}

async function loadTags() {
    try {
        const res = await apiService.fetchMarketTags()
        tags.value = res.tags
    } catch {
        tags.value = [] // 标签失败不阻塞列表
    }
}

async function loadInstalledIds() {
    try {
        const res = await apiService.queryPlugins(undefined, undefined, { includeSystem: false })
        const list = (res?.plugins ?? []) as Array<{ pluginId?: string; id?: string }>
        installedIds.value = new Set(list.map((p) => (p.pluginId ?? p.id ?? '') as string).filter(Boolean))
    } catch {
        installedIds.value = new Set() // 本地列表失败只影响徽标
    }
}

function handleRefresh() {
    void loadTags()
    void loadInstalledIds()
    void loadList()
}

function handleSelectTag(tag: string) {
    selectedTag.value = tag
    currentPage.value = 1
    void loadList()
}

/** 首次切到市场视图才拉数据（与 McpMarket 的 activate 语义一致） */
function activate() {
    if (activated.value) return
    activated.value = true
    handleRefresh()
}

defineExpose({
    refresh: handleRefresh,
    loading,
})

// 首次进入市场视图激活；onMounted 只兜 "直接以 market 视图打开" 的场景
watch(() => props.active, (value) => {
    if (value) activate()
}, { immediate: true })

// ── 详情 ──
async function handleShowDialog(plugin: MarketPlugin) {
    currentPlugin.value = plugin
    detail.value = null
    showDetailDialog.value = true
    try {
        detail.value = await apiService.fetchMarketDetail(plugin.id)
    } catch {
        // 详情失败不阻塞弹窗（列表数据仍可展示/安装）
    }
}

function copySource() {
    const src = currentPlugin.value?.source?.install
    if (!src) return
    void navigator.clipboard.writeText(src).then(
        () => toast.success(t('plugins.market.copied')),
        () => toast.error(t('plugins.market.copyFailed')),
    )
}

function openRepo() {
    const repo = currentPlugin.value?.repository
    if (repo && /^https:\/\//.test(repo)) window.open(repo, '_blank')
}

// ── 安装 ──
async function handleInstall(plugin: MarketPlugin) {
    if (installing.value.has(plugin.id)) return
    installing.value.add(plugin.id)
    installLog.value = ''
    installPollCancelled = false
    installDialogActive.value = true
    installDialogVisible.value = true
    try {
        const { jobId } = await apiService.installFromMarket(plugin.id)
        activeInstallJobId = jobId
        while (!installPollCancelled) {
            const state = await apiService.getInstallLog(jobId)
            installLog.value = state.log.join('\n')
            if (state.done) {
                activeInstallJobId = null
                if (state.result?.success) {
                    installLog.value += `\n\n✅ ${t('plugins.localTools.installSuccessLog')}`
                    installedIds.value.add(plugin.id)
                    emit('installed')
                    void loadInstalledIds()
                } else {
                    installLog.value += `\n\n❌ ${t('plugins.localTools.installFailedLog')}`
                }
                break
            }
            await new Promise((r) => setTimeout(r, 500))
        }
    } catch (err) {
        installLog.value += '\n❌ ' + (getErrorMessage(err) || t('plugins.localTools.installFailedLog'))
    } finally {
        installing.value.delete(plugin.id)
        installDialogActive.value = false
    }
}

function cancelInstallPoll() {
    if (activeInstallJobId) {
        apiService.cancelInstall(activeInstallJobId).catch(() => {})
    }
    installPollCancelled = true
    activeInstallJobId = null
    installDialogActive.value = false
    // 取消 = 终止本次安装并关闭弹窗（此前只停轮询不关窗，点击看起来毫无反应）
    installDialogVisible.value = false
}

// 自动滚动假终端到底部
watch(installLog, () => {
    nextTick(() => {
        if (installLogBox.value) {
            installLogBox.value.scrollTop = installLogBox.value.scrollHeight
        }
    })
})

// 翻页
watch(currentPage, (page, prev) => {
    if (page === prev) return
    void loadList()
})

function formatCount(n: number): string {
    if (!Number.isFinite(n)) return '0'
    if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}
</script>

<style scoped>
.market-chip-count {
    margin-left: 4px;
    font-size: 11px;
    opacity: 0.65;
}

.market-row-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--gd-color-text-gray, #8b8d95);
}

/* 卡片底部独立一行：只放胶囊，与上方版本/作者信息分开 */
.market-row-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
}

.market-pagination {
    display: flex;
    justify-content: center;
    padding: 16px 0 4px;
}

.market-detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    color: var(--gd-color-text-gray, #8b8d95);
}

.market-shots {
    display: grid;
    gap: 8px;
}

.market-shots__img {
    width: 100%;
    border-radius: var(--gd-size-surface-radius);
    border: 1px solid var(--gd-color-border, rgba(0, 0, 0, 0.08));
}

.market-source-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.market-source-code {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--gd-color-surface-subtle, rgba(127, 127, 127, 0.1));
    font-size: 12px;
}

/* 假终端（与 LocalTools 的 install-terminal 同款） */
.market-install-terminal {
    position: relative;
    height: 220px;
    overflow-y: auto;
    padding: 10px 12px;
    border-radius: 8px;
    background: #16181d;
}

.market-install-log {
    margin: 0;
    font-family: var(--gd-font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.6;
    color: #9ecb8f;
    white-space: pre-wrap;
    word-break: break-all;
}

.terminal-cursor {
    position: absolute;
    bottom: 12px;
    left: 14px;
    width: 7px;
    height: 14px;
    background: #9ecb8f;
    animation: market-cursor-blink 1s step-end infinite;
}

@keyframes market-cursor-blink {
    50% {
        opacity: 0;
    }
}
</style>
