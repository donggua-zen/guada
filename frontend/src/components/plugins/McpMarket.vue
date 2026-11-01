<template>
    <!-- 标题行与搜索框已上移到父级视图条；组件常驻（父级用 v-show），切回来不重新请求 -->
    <div class="plugins-mcp-market">
        <!-- 来源筛选 chips（单选）：市场视图自己的第一行 -->
        <div class="plugins-filter-row">
            <button
                v-for="chip in sourceChips"
                :key="chip.id"
                type="button"
                class="plugins-chip"
                :class="{ 'is-active': chip.id === selectedSource }"
                @click="handleSelectSource(chip.id)"
            >
                {{ chip.label }}
            </button>
            <div class="plugins-filter-row__spacer"></div>
            <span v-if="total > 0" class="plugins-chip__count">{{ t('plugins.mcpMarket.showing', { shown: pageVisible.length, total }) }}</span>
        </div>

        <!-- 部分来源不可用（不阻塞其余条目展示） -->
        <el-alert
            v-if="partialErrors.length > 0"
            class="mb-3"
            type="warning"
            :closable="false"
            :title="t('plugins.mcpMarket.partialUnavailable')"
            :description="partialErrors.join('；')"
        />

        <!-- 首次进入市场：按行 geometry 占位 -->
        <div
            v-if="loading && items.length === 0"
            class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2"
        >
            <div v-for="i in 4" :key="i" class="plugins-skeleton" aria-hidden="true">
                <span class="plugins-skeleton__avatar"></span>
                <span class="plugins-skeleton__lines">
                    <span class="plugins-skeleton__line plugins-skeleton__line--name"></span>
                    <span class="plugins-skeleton__line"></span>
                </span>
            </div>
        </div>

        <!-- 错误 -->
        <div
            v-else-if="error"
            class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-6 text-center"
        >
            <el-icon size="32" class="mb-2 opacity-50 text-gray-400">
                <MailInbox24Regular />
            </el-icon>
            <div class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ error }}</div>
        </div>

        <!-- 空结果 -->
        <div
            v-else-if="!loading && filteredItems.length === 0"
            class="rounded-[var(--gd-size-surface-radius)] bg-(--gd-color-surface-subtle) p-8 text-center text-sm text-gray-500 dark:text-[#8b8d95]"
        >
            {{ t('plugins.mcpMarket.empty') }}
        </div>

        <!-- 两列行列表 -->
        <div
            v-else-if="pageVisible.length > 0"
            class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2"
        >
            <PluginListRow
                v-for="item in pageVisible"
                :key="item.id"
                :name="item.name"
                :description="item.description || t('plugins.mcpMarket.noDescription')"
                @click="handleShowAddDialog(item)"
            >
                <template #badges>
                    <el-tag v-if="isInstalled(item)" type="success" size="small" effect="plain">
                        {{ t('plugins.mcpMarket.installed') }}
                    </el-tag>
                    <el-tag v-if="item.stats" type="info" size="small" effect="plain">
                        {{ item.stats }}
                    </el-tag>
                    <el-tag
                        v-for="(tag, index) in (item.tags || []).slice(0, 2)"
                        :key="`${tag}-${index}`"
                        size="small"
                        effect="light"
                    >
                        {{ tag }}
                    </el-tag>
                </template>
                <template #actions>
                    <GdButton
                        size="small"
                        plain
                        :class="{ 'market-action': true, 'is-persistent': isInstalled(item) || addingItems.has(item.id) }"
                        :loading="addingItems.has(item.id)"
                        @click.stop="handleShowAddDialog(item)"
                    >
                        {{ isInstalled(item) ? t('plugins.mcpMarket.updateBtn') : t('plugins.mcpMarket.addBtn') }}
                    </GdButton>
                </template>
            </PluginListRow>
        </div>

        <!-- 分页改为「加载更多」：来源榜一次给 100+ 条，全量渲染首帧要建同样多的行 -->
        <div v-if="filteredItems.length > pageVisible.length" class="plugins-market-more">
            <GdButton link size="small" :disabled="loading" @click="handleLoadMore">
                {{ t('plugins.mcpMarket.loadMore', { count: PAGE_STEP }) }}
            </GdButton>
        </div>

        <!-- 添加确认弹窗 -->
        <GdDialog
            v-model="showAddDialog"
            :title="t('plugins.mcpMarket.addTitle')"
            size="md"
            align-center
            destroy-on-close
        >
            <div v-if="selectedItem" class="mcp-market__dialog">
                <!-- 对象先行：名称 + 来源 -->
                <div class="mcp-market__head">
                    <CardAvatar :name="selectedItem.name" size="lg" />
                    <div class="mcp-market__head-text">
                        <div class="mcp-market__name">{{ selectedItem.name }}</div>
                        <div class="mcp-market__meta">
                            {{ selectedItem.source }}
                            <template v-if="selectedItem.stats"> · {{ selectedItem.stats }}</template>
                        </div>
                    </div>
                </div>

                <!-- 描述 -->
                <div v-if="selectedItem.description" class="mcp-market__desc">
                    {{ selectedItem.description }}
                </div>

                <!-- 解析中 -->
                <div v-if="resolving" class="mcp-market__loading">
                    {{ t('plugins.mcpMarket.resolving') }}
                </div>

                <!-- 解析失败就地反馈 -->
                <el-alert
                    v-if="resolveError"
                    class="mt-3"
                    type="error"
                    :closable="false"
                    :title="t('plugins.mcpMarket.resolveFailed')"
                    :description="resolveError"
                />

                <!-- 解析结果：逐服务器展示真实传输明细 -->
                <template v-else-if="resolvedServers.length > 0">
                    <el-alert
                        class="mt-3"
                        type="warning"
                        :closable="false"
                        :title="t('plugins.mcpMarket.importWarning')"
                    />

                    <div class="mcp-market__servers">
                        <div
                            v-for="server in resolvedServers"
                            :key="server.name"
                            class="mcp-market__server"
                        >
                            <div class="mcp-market__server-head">
                                <span class="mcp-market__server-name">{{ server.name }}</span>
                                <el-tag size="small" effect="plain">{{ server.type }}</el-tag>
                                <el-tag
                                    v-if="server.needsConfiguration"
                                    size="small"
                                    type="warning"
                                    effect="plain"
                                >
                                    {{ t('plugins.mcpMarket.needsConfig') }}
                                </el-tag>
                            </div>

                            <div class="mcp-market__transport">
                                <template v-if="server.type === 'stdio'">
                                    <div class="mcp-market__kv">
                                        <span class="mcp-market__k">{{ t('plugins.mcpMarket.fieldCommand') }}</span>
                                        <code class="mcp-market__v">{{ server.command }}</code>
                                    </div>
                                    <div v-if="server.args && server.args.length" class="mcp-market__kv">
                                        <span class="mcp-market__k">{{ t('plugins.mcpMarket.fieldArgs') }}</span>
                                        <code class="mcp-market__v">{{ server.args.join(' ') }}</code>
                                    </div>
                                    <div v-if="server.env && Object.keys(server.env).length" class="mcp-market__kv">
                                        <span class="mcp-market__k">{{ t('plugins.mcpMarket.fieldEnv') }}</span>
                                        <code class="mcp-market__v">{{ Object.keys(server.env).join(', ') }}</code>
                                    </div>
                                </template>
                                <template v-else>
                                    <div class="mcp-market__kv">
                                        <span class="mcp-market__k">{{ t('plugins.mcpMarket.fieldUrl') }}</span>
                                        <code class="mcp-market__v">{{ server.url }}</code>
                                    </div>
                                    <div v-if="server.headers && Object.keys(server.headers).length" class="mcp-market__kv">
                                        <span class="mcp-market__k">{{ t('plugins.mcpMarket.fieldHeaders') }}</span>
                                        <code class="mcp-market__v">{{ Object.keys(server.headers).join(', ') }}</code>
                                    </div>
                                </template>
                            </div>

                            <div v-if="server.needsConfiguration" class="mcp-market__fields">
                                {{
                                    t('plugins.mcpMarket.needsConfigHint', {
                                        fields: server.configurationFields.join(', '),
                                    })
                                }}
                            </div>
                        </div>
                    </div>

                    <!-- 导入失败就地反馈 -->
                    <el-alert
                        v-if="importError"
                        class="mt-3"
                        type="error"
                        :closable="false"
                        :title="t('plugins.mcpMarket.importFailed')"
                        :description="importError"
                    />
                </template>
            </div>

            <template #footer>
                <div class="flex w-full items-center justify-between gap-3">
                    <GdButton
                        v-if="selectedItem"
                        link
                        type="primary"
                        @click="handleOpenDetail(selectedItem)"
                    >
                        {{ t('plugins.mcpMarket.viewDetail') }}
                    </GdButton>
                    <div class="ml-auto flex items-center gap-2">
                        <GdButton @click="showAddDialog = false">{{ t('common.cancel') }}</GdButton>
                        <GdButton
                            type="primary"
                            :disabled="resolvedServers.length === 0"
                            :loading="importing"
                            @click="handleImport"
                        >
                            {{ t('plugins.mcpMarket.confirmImport') }}
                        </GdButton>
                    </div>
                </div>
            </template>
        </GdDialog>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElIcon, ElTag } from 'element-plus';
import { MailInbox24Regular } from '@vicons/fluent'
import GdButton from '@/components/ui/GdButton.vue'
import { toast } from '@/components/ui/toastService';
import GdDialog from '@/components/ui/GdDialog.vue'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import PluginListRow from './PluginListRow.vue'
import { apiService } from '@/services/ApiService'
import { getErrorMessage } from '@/utils/errorMessage'
import { openInExternalBrowser } from '@/utils/browserUtils'
import type { ImportableMcpServer, McpMarketItem } from '@/services/modules/mcpMarket.api'
import type { McpServer } from '@/types/api'

const props = defineProps<{
    /** 本地已有 MCP 服务器，用于「是否已添加」判定 */
    localServers: McpServer[]
    /** 父级当前是否停在市场视图：榜单只在第一次进入时拉 */
    active: boolean
}>()

/** 搜索框在父级视图条上，关键词双向同步；过滤仍是前端的，只是不再常驻一个输入框 */
const keywordModel = defineModel<string>('keyword', { default: '' })

const emit = defineEmits<{
    imported: []
}>()

const { t } = useI18n()

const items = ref<McpMarketItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const partialErrors = ref<string[]>([])

const keyword = ref('')
const selectedSource = ref<string>('all')
/** 来源榜一次给 127 条，分批渲染而不是一次铺完 */
const PAGE_SIZE = 8
const PAGE_STEP = 20
const visibleCount = ref(PAGE_SIZE)

const addingItems = ref<Set<string>>(new Set())

const showAddDialog = ref(false)
const selectedItem = ref<McpMarketItem | null>(null)
const resolving = ref(false)
const resolvedServers = ref<ImportableMcpServer[]>([])
const resolveError = ref<string | null>(null)
const importing = ref(false)
const importError = ref<string | null>(null)

/** 来源 chips：全部 + 两个源 */
const sourceChips = computed(() => [
    { id: 'all', label: t('plugins.mcpMarket.sourceAll') },
    { id: 'mcpworld', label: 'MCP World' },
    { id: 'skillhub_mcp', label: 'SkillHub MCP' },
])

/** 本地已添加的市场条目 id 集合（靠 origin.itemId 精确匹配） */
const installedItemIds = computed(() => {
    const set = new Set<string>()
    for (const server of props.localServers) {
        const itemId = server.origin?.itemId
        if (itemId) set.add(itemId)
    }
    return set
})

/** 名字归一化（仅用于「无 origin 的旧数据」兜底提示，不用于写回） */
function normalizeName(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

function isInstalled(item: McpMarketItem): boolean {
    if (installedItemIds.value.has(item.id)) return true
    // 兜底：历史上手工导入过同名服务器（无 origin 记录）
    return props.localServers.some((s) => !s.origin && normalizeName(s.name) === normalizeName(item.name))
}

/** 前端本地过滤（后端已归一，这里只做搜索/来源筛选） */
const filteredItems = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    return items.value.filter((item) => {
        if (selectedSource.value !== 'all' && item.source !== selectedSource.value) return false
        if (!kw) return true
        return (
            item.name.toLowerCase().includes(kw) ||
            item.description.toLowerCase().includes(kw) ||
            item.tags.some((tag) => tag.toLowerCase().includes(kw))
        )
    })
})

/** 当前筛选命中的条数，用于「已显示 n / N」 */
const total = computed(() => filteredItems.value.length)

const pageVisible = computed(() => filteredItems.value.slice(0, visibleCount.value))

/** 请求序号：丢弃过期响应，避免快速切换来源时列表错乱 */
let loadSeq = 0

/** 首次进入市场视图才拉榜单；未激活时加载出口直接返回 */
const activated = ref(false)

function activate(forceRefresh = false) {
    activated.value = true
    void loadRankings(forceRefresh)
}

async function loadRankings(forceRefresh = false) {
    if (!activated.value) return

    const seq = ++loadSeq
    loading.value = true
    error.value = null
    partialErrors.value = []
    try {
        const data = await apiService.fetchMcpMarketRankings(selectedSource.value, forceRefresh)
        if (seq !== loadSeq) return
        items.value = data.items
        partialErrors.value = data.errors || []
        visibleCount.value = PAGE_SIZE
    } catch (err) {
        if (seq !== loadSeq) return
        items.value = []
        error.value = getErrorMessage(err) || t('plugins.mcpMarket.loadFailed')
    } finally {
        if (seq === loadSeq) loading.value = false
    }
}

/**
 * 换一批 / 加载更多都只动 visibleCount：数据已在本地，再发一次请求只是重来一遍
 */
function handleLoadMore() {
    visibleCount.value = Math.min(visibleCount.value + PAGE_STEP, total.value)
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 父级搜索框变化：过滤是本地的，仍防抖 350ms，避免每敲一个字符重排一次列表；
 * 清空立即回到全量首批。
 */
watch(keywordModel, (raw) => {
    if (searchTimer) clearTimeout(searchTimer)
    const apply = () => {
        keyword.value = (raw || '').trim()
        visibleCount.value = PAGE_SIZE
    }
    if (!raw) apply()
    else searchTimer = setTimeout(apply, 350)
})

function handleSelectSource(id: string) {
    selectedSource.value = selectedSource.value === id ? 'all' : id
    visibleCount.value = PAGE_SIZE
    void loadRankings()
}

async function handleRefresh() {
    activated.value = true
    await loadRankings(true)
}

async function handleShowAddDialog(item: McpMarketItem) {
    selectedItem.value = item
    resolvedServers.value = []
    resolveError.value = null
    importError.value = null
    showAddDialog.value = true

    resolving.value = true
    addingItems.value.add(item.id)
    try {
        const resolved = await apiService.resolveMcpMarketItem(item.source, item.id)
        resolvedServers.value = resolved.servers
    } catch (err) {
        resolveError.value = getErrorMessage(err) || t('plugins.mcpMarket.resolveFailed')
    } finally {
        resolving.value = false
        addingItems.value.delete(item.id)
    }
}

async function handleImport() {
    const item = selectedItem.value
    if (!item || resolvedServers.value.length === 0 || importing.value) return

    importing.value = true
    importError.value = null
    try {
        const result = await apiService.importMcpMarketItem(
            item.source,
            item.id,
            resolvedServers.value,
        )
        const changed = result.imported.length + result.updated.length
        if (changed > 0) {
            toast.success(t('plugins.mcpMarket.importSuccess', { count: changed }))
            showAddDialog.value = false
            emit('imported')
        }
        if (result.errors.length > 0) {
            importError.value = result.errors.map((e) => `${e.name}: ${e.message}`).join('\n')
        }
    } catch (err) {
        importError.value = getErrorMessage(err) || t('plugins.mcpMarket.importFailed')
    } finally {
        importing.value = false
    }
}

function handleOpenDetail(item: McpMarketItem) {
    if (item.url) void openInExternalBrowser(item.url)
}

// 首次切到市场视图才请求；父级直接以市场视图打开地址（?view=market）时 immediate 会立刻补一次
watch(() => props.active, (value) => { if (value && !activated.value) void activate() }, { immediate: true })

/** 搜索框与刷新钮搬到了父级视图条，条数也要给视图条用，这里只暴露动作与状态 */
defineExpose({
    refresh: handleRefresh,
    loading,
    total,
})
</script>

<style scoped>
/* 来源 chips 的几何统一在 PluginViewSwitch.vue 的 .plugins-chip 上（与技能市场同款），
   这里只留「加载更多」的容器 */
.plugins-market-more {
    display: flex;
    justify-content: center;
    margin-top: 12px;
}

.mcp-market__dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.mcp-market__head {
    display: flex;
    align-items: center;
    gap: 12px;
}

.mcp-market__name {
    font-size: var(--gd-size-text-lg);
    font-weight: 600;
    color: var(--gd-color-text);
}

.mcp-market__meta {
    margin-top: 2px;
    font-size: calc(var(--gd-size-text-base) - 2px);
    color: var(--gd-md-text-secondary);
}

.mcp-market__desc {
    max-height: 7.5em;
    overflow-y: auto;
    font-size: calc(var(--gd-size-text-base) - 1px);
    color: var(--gd-color-text);
}

.mcp-market__loading {
    padding: 16px 0;
    font-size: calc(var(--gd-size-text-base) - 1px);
    color: var(--gd-md-text-secondary);
    text-align: center;
}

.mcp-market__servers {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
}

.mcp-market__server {
    padding: 10px 12px;
    border-radius: var(--gd-md-radius);
    background: var(--gd-color-surface-subtle);
}

.mcp-market__server-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.mcp-market__server-name {
    font-weight: 600;
    color: var(--gd-color-text);
}

.mcp-market__transport {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mcp-market__kv {
    display: flex;
    gap: 8px;
    font-size: calc(var(--gd-size-text-base) - 2px);
}

.mcp-market__k {
    flex-shrink: 0;
    min-width: 56px;
    color: var(--gd-md-text-secondary);
}

.mcp-market__v {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--gd-color-text);
}

.mcp-market__fields {
    margin-top: 6px;
    font-size: calc(var(--gd-size-text-base) - 2px);
    color: var(--gd-color-warning, #d97706);
}
</style>
