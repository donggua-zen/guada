<template>
    <div class="ci">
        <!-- ── 工具栏：来源 + 说明 tooltip + 搜索 + 扫描 ── -->
        <div class="ci-bar">
            <div class="ci-bar__left">
                <div class="ci-sources" role="tablist" :aria-label="t('settings.claudeImport.sourceLabel')"
                    @keydown.left.prevent="moveSource(-1)" @keydown.right.prevent="moveSource(1)">
                    <button v-for="item in sourceItems" :key="item.value" type="button" role="tab"
                        class="ci-source" :class="{ 'is-active': source === item.value }"
                        :aria-selected="source === item.value" :tabindex="source === item.value ? 0 : -1"
                        :ref="el => setSourceTab(item.value, el)" @click="switchSource(item.value)">
                        {{ item.label }}
                    </button>
                </div>
                <GdTooltip :content="infoText" placement="top">
                    <button type="button" class="ci-info" :aria-label="t('settings.claudeImport.infoAria')">
                        <Info24Regular />
                    </button>
                </GdTooltip>
            </div>
            <div class="ci-bar__right">
                <GdInput v-model="keyword" clearable size="small" class="ci-search"
                    :placeholder="t('settings.claudeImport.searchPlaceholder')">
                    <template #prefix>
                        <Search16Regular class="size-4" />
                    </template>
                </GdInput>
                <GdButton size="small" :loading="isScanningUi" @click="scan(source)">
                    {{ t('settings.claudeImport.scan') }}
                </GdButton>
            </div>
        </div>

        <!-- ── 筛选：时间 + 工作区两个下拉，右侧「显示已导入」开关（都在前端，改完即生效） ── -->
        <div v-if="candidates.length > 0" class="ci-filters">
            <div class="ci-select ci-select--range">
                <GdSelect v-model="range" size="small">
                    <GdOption v-for="item in rangeItems" :key="item.value" :value="item.value"
                        :label="`${item.label} (${item.count})`" />
                </GdSelect>
            </div>
            <div v-if="workspaceItems.length" class="ci-select ci-select--workspace">
                <GdSelect v-model="workspace" size="small" filterable>
                    <GdOption v-for="item in workspaceItems" :key="item.value" :value="item.value"
                        :label="`${item.label} (${item.count})`" />
                </GdSelect>
            </div>
            <div class="ci-filters__spacer"></div>
            <GdCheckbox v-model="showImported"
                :label="`${t('settings.claudeImport.showImported')} (${importedCount})`" />
        </div>

        <!-- ── 扫描中：骨架屏晚于响应出现，150ms 内回来就根本不亮 ── -->
        <template v-if="awaitingFirstResult">
            <div v-if="isScanningUi" class="ci-rows">
                <div v-for="n in 5" :key="n" class="ci-skel">
                    <span class="ci-skel__box"></span>
                    <span class="ci-skel__lines">
                        <i class="ci-skel__line ci-skel__line--title"></i>
                        <i class="ci-skel__line"></i>
                    </span>
                </div>
            </div>
        </template>

        <!-- ── 扫描失败 ── -->
        <div v-else-if="active.status === 'error'" class="ci-error">
            <div class="ci-error__body">
                <div class="ci-error__title">{{ t('settings.claudeImport.scanErrorTitle') }}</div>
                <div class="ci-error__desc">{{ active.error || t('settings.claudeImport.scanFailed') }}</div>
            </div>
            <GdButton size="small" @click="scan(source)">{{ t('settings.claudeImport.retry') }}</GdButton>
        </div>

        <!-- ── 还没扫描这个来源 ── -->
        <GdEmpty v-else-if="active.status === 'idle'" :image-size="56" class="ci-empty">
            <div class="ci-empty__title">{{ t('settings.claudeImport.idleTitle') }}</div>
            <div class="ci-empty__desc">{{ t('settings.claudeImport.idleDesc', { path: scannedPath() }) }}</div>
            <div class="ci-empty__actions">
                <GdButton size="small" @click="scan(source)">{{ t('settings.claudeImport.scan') }}</GdButton>
            </div>
        </GdEmpty>

        <!-- ── 这个来源在本机没有候选 ── -->
        <GdEmpty v-else-if="candidates.length === 0" :image-size="56" class="ci-empty">
            <div class="ci-empty__title">{{ emptyTitle }}</div>
            <div class="ci-empty__desc">{{ emptyDesc }}</div>
            <div class="ci-empty__actions">
                <GdButton size="small" @click="scan(source)">{{ t('settings.claudeImport.rescan') }}</GdButton>
            </div>
        </GdEmpty>

        <!-- ── 筛选无结果 ── -->
        <GdEmpty v-else-if="groups.length === 0" :image-size="56" class="ci-empty">
            <div class="ci-empty__title">{{ t('settings.claudeImport.filteredEmptyTitle') }}</div>
            <div class="ci-empty__desc">
                {{ t('settings.claudeImport.filteredEmptyDesc', { count: candidates.length }) }}
            </div>
            <div class="ci-empty__actions">
                <GdButton size="small" @click="clearFilters">{{ t('settings.claudeImport.clearFilters') }}</GdButton>
            </div>
        </GdEmpty>

        <!-- ── 候选列表：按工作区分组 ── -->
        <div v-else class="ci-groups">
            <div v-for="group in groups" :key="group.key" class="ci-group">
                <div class="ci-group__head" @click="toggleGroup(group.key)">
                    <ChevronDown24Regular v-if="isGroupOpen(group.key)" class="ci-group__caret size-4" />
                    <ChevronRight24Regular v-else class="ci-group__caret size-4" />
                    <span class="ci-group__title" :title="group.path">{{ group.label }}</span>
                    <span class="ci-group__count">
                        {{ t('settings.claudeImport.groupCount', { n: group.items.length }) }}
                        <template v-if="group.total !== group.items.length">
                            {{ t('settings.claudeImport.groupFiltered', { n: group.total }) }}
                        </template>
                    </span>
                    <GdButton size="tiny" link class="ci-group__action" @click.stop="toggleGroupSelection(group)">
                        {{ group.allSelected ? t('settings.claudeImport.clearGroup') : t('settings.claudeImport.selectGroup') }}
                    </GdButton>
                </div>
                <div v-show="isGroupOpen(group.key)" class="ci-rows">
                    <div v-for="candidate in group.items" :key="candidate.sessionId" class="ci-row"
                        :class="{ 'is-selected': isSelected(candidate.sessionId) }"
                        @click="toggleSelect(candidate.sessionId)">
                        <!-- @click.stop：复选框点击只交给 change 处理。否则 label 的点击会冒泡到整行
                             再切一次，加上 change 本身，两次切换互相抵消 → 点复选框看起来没反应 -->
                        <GdCheckbox class="ci-row__box" :model-value="isSelected(candidate.sessionId)"
                            @click.stop
                            @change="(val: boolean) => setSelect(candidate.sessionId, val)" />
                        <div class="ci-row__main">
                            <div class="ci-row__title" :title="candidate.previewTitle || candidate.sessionId">
                                {{ candidate.previewTitle || shortId(candidate.sessionId) }}
                            </div>
                            <div class="ci-row__meta">
                                <span>{{ relTime(candidate.updatedAt) }}</span>
                                <template v-if="metaSize(candidate)">
                                    <span class="ci-row__sep">·</span>
                                    <span>{{ metaSize(candidate) }}</span>
                                </template>
                                <template v-if="candidate.createdAt">
                                    <span class="ci-row__sep">·</span>
                                    <span>{{ t('settings.claudeImport.builtAt', { time: relTime(candidate.createdAt) }) }}</span>
                                </template>
                                <span class="ci-row__sep">·</span>
                                <span class="ci-row__id">{{ shortId(candidate.sessionId) }}</span>
                                <GdTag v-if="candidate.imported" type="success" size="small">
                                    {{ t('settings.claudeImport.importedTag') }}
                                </GdTag>
                            </div>
                        </div>
                        <div class="ci-row__side" @click.stop>
                            <GdButton v-if="candidate.importedSessionId" size="small" plain class="ci-row__btn"
                                @click="openSession(candidate.importedSessionId)">
                                {{ t('settings.claudeImport.open') }}
                            </GdButton>
                            <GdButton v-else size="small" plain class="ci-row__btn"
                                :loading="isImporting(candidate.sessionId)" @click="startImport([candidate.sessionId])">
                                {{ t('settings.claudeImport.importOne') }}
                            </GdButton>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ── 粘性操作条：只在有选择 / 导入中 / 刚导入完时出现 ── -->
        <div v-if="showBar" class="ci-bar-bottom">
            <template v-if="importing">
                <div class="ci-bar-bottom__info">
                    <span class="ci-bar__text">
                        {{ t('settings.claudeImport.importing', { done: progress.done, total: progress.total }) }}
                    </span>
                </div>
                <span class="ci-progress"><i :style="{ width: progressPercent + '%' }"></i></span>
                <span class="ci-bar__num">{{ progressPercent }}%</span>
                <div class="ci-filters__spacer"></div>
                <GdButton size="small" @click="cancelImport">{{ t('settings.claudeImport.cancel') }}</GdButton>
            </template>
            <template v-else-if="summary">
                <div class="ci-bar-bottom__info">
                    <GdTag v-if="summary.imported.length" type="success" size="small">
                        {{ t('settings.claudeImport.summaryImported', { n: summary.imported.length }) }}
                    </GdTag>
                    <GdTag v-if="summary.skipped.length" type="warning" size="small">
                        {{ t('settings.claudeImport.summarySkipped', { n: summary.skipped.length }) }}
                    </GdTag>
                    <GdTag v-if="summary.failed.length" type="danger" size="small">
                        {{ t('settings.claudeImport.summaryFailed', { n: summary.failed.length }) }}
                    </GdTag>
                    <span v-if="summaryReason" class="ci-bar__text ci-bar__reason">{{ summaryReason }}</span>
                </div>
                <div class="ci-filters__spacer"></div>
                <div class="ci-bar-bottom__actions">
                    <GdButton v-if="summary.failed.length" size="small" @click="startImport(failedIds)">
                        {{ t('settings.claudeImport.retryFailed') }}
                    </GdButton>
                    <GdButton size="small" @click="dismissSummary">{{ t('settings.claudeImport.backToList') }}</GdButton>
                    <GdButton v-if="summary.imported.length" size="small" type="primary" @click="gotoSessionList">
                        {{ t('settings.claudeImport.gotoSessions') }}
                    </GdButton>
                </div>
            </template>
            <template v-else>
                <div class="ci-bar-bottom__info">
                    <span class="ci-bar__text">
                        {{ t('settings.claudeImport.selectedCount', { n: selectedCount }) }}
                    </span>
                    <GdButton size="tiny" link @click="clearSelection">{{ t('settings.claudeImport.clear') }}</GdButton>
                </div>
                <div class="ci-filters__spacer"></div>
                <div class="ci-bar-bottom__actions">
                    <span class="ci-bar__label">{{ t('settings.claudeImport.importTo') }}</span>
                    <!-- GdSelect 是 fragment 根且 inheritAttrs:false，外部 class 落不进它的
                         scoped 选择器，宽度由这层壳负责 -->
                    <div class="ci-group-select">
                        <GdSelect v-model="groupId" size="small" :placeholder="t('settings.claudeImport.groupNone')">
                            <GdOption value="" :label="t('settings.claudeImport.groupNone')" />
                            <GdOption v-for="g in sessionGroups" :key="g.id" :value="g.id" :label="g.name" />
                        </GdSelect>
                    </div>
                    <GdButton size="small" type="primary" @click="confirmAndImport">
                        {{ t('settings.claudeImport.importSelected', { n: selectedCount }) }}
                    </GdButton>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NEW_SESSION_ID } from '@/constants'
import GdButton from '@/components/ui/GdButton.vue'
import GdCheckbox from '@/components/ui/GdCheckbox.vue'
import GdEmpty from '@/components/ui/GdEmpty.vue'
import GdInput from '@/components/ui/GdInput.vue'
import GdSelect from '@/components/ui/GdSelect.vue'
import GdOption from '@/components/ui/GdSelectOption'
import GdTag from '@/components/ui/GdTag.vue'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import { toast } from '@/components/ui/toastService'
import usePopup from '@/composables/usePopup'
import { apiService } from '@/services/ApiService'
import type { SessionGroup } from '@/types/session'
import { formatBytes } from '@/utils/formatBytes'
import { getErrorMessage } from '@/utils/errorMessage'
import type {
    ClaudeImportCandidate,
    ClaudeImportResult,
    ImportSource,
} from '@/services/modules/claude-import.api'
import {
    ChevronDown24Regular,
    ChevronRight24Regular,
    Info24Regular,
    Search16Regular,
} from '@vicons/fluent'

const { t } = useI18n()
const router = useRouter()
const { confirm } = usePopup()

/** 单次请求只投这么多会话：分片才有真实进度，也不会让一个请求挂几十秒 */
const IMPORT_CHUNK = 5
/** 超过这个数量先确认一次，避免误按全选后直接开跑 */
const CONFIRM_THRESHOLD = 50
const DAY_MS = 24 * 60 * 60 * 1000

type RangeValue = 'all' | '1d' | '3d' | '7d' | '30d'
type SourceStatus = 'idle' | 'scanning' | 'ready' | 'error'

interface SourceState {
    status: SourceStatus
    candidates: ClaudeImportCandidate[]
    roots: string[]
    error?: string
}

const SOURCES: ImportSource[] = ['claudeCode', 'zcode', 'dsh', 'codex']

const source = ref<ImportSource>('claudeCode')
const sources = reactive<Record<ImportSource, SourceState>>({
    claudeCode: { status: 'idle', candidates: [], roots: [] },
    zcode: { status: 'idle', candidates: [], roots: [] },
    dsh: { status: 'idle', candidates: [], roots: [] },
    codex: { status: 'idle', candidates: [], roots: [] },
})
/** 勾选按来源隔离：各来源的 sessionId 空间与幂等锚点都不同 */
const selection = reactive<Record<ImportSource, Set<string>>>({
    claudeCode: new Set(),
    zcode: new Set(),
    dsh: new Set(),
    codex: new Set(),
})

const keyword = ref('')
const range = ref<RangeValue>('all')
const workspace = ref('all')
const showImported = ref(true)
/** 展开的分组：默认全部闭合，241 条平铺太长，先看工作区分布再点开需要的 */
const expanded = ref<Set<string>>(new Set())

const sessionGroups = ref<SessionGroup[]>([])
const groupId = ref('')
const summary = ref<ClaudeImportResult | null>(null)
const importing = ref(false)
const cancelled = ref(false)
const inFlight = ref<string[]>([])
const progress = reactive({ done: 0, total: 0 })
const sourceTabRefs = reactive<Record<string, HTMLElement | null>>({})
/** 当前亮着骨架屏的来源（null = 没亮） */
const scanUiSource = ref<ImportSource | null>(null)

const active = computed(() => sources[source.value])
const candidates = computed(() => active.value.candidates)
/** 扫描中且还没有旧结果可留：这段窗口里才可能需要骨架屏 */
const awaitingFirstResult = computed(() => active.value.status === 'scanning' && candidates.value.length === 0)
/** 骨架屏与按钮 loading 共用的延迟闸门，见 withScanUi */
const isScanningUi = computed(() => scanUiSource.value === source.value)
const selected = computed(() => selection[source.value])
const selectedCount = computed(() => selected.value.size)
const importedCount = computed(() => candidates.value.filter((c) => c.imported).length)
const showBar = computed(() => importing.value || summary.value !== null || selectedCount.value > 0)

const RANGE_DAYS: Record<Exclude<RangeValue, 'all'>, number> = { '1d': 0, '3d': 2, '7d': 6, '30d': 29 }
const RANGE_KEYS: Record<RangeValue, string> = {
    all: 'rangeAll',
    '1d': 'rangeToday',
    '3d': 'range3d',
    '7d': 'range7d',
    '30d': 'range30d',
}

function sourceLabel(value: ImportSource): string {
    if (value === 'zcode') return t('settings.claudeImport.sourceZcode')
    if (value === 'dsh') return t('settings.claudeImport.sourceDsh')
    if (value === 'codex') return t('settings.claudeImport.sourceCodex')
    return t('settings.claudeImport.sourceClaude')
}

const sourceItems = computed(() => SOURCES.map((value) => ({ value, label: sourceLabel(value) })))

/** 距今天的天数（按自然日，不是滚动 24 小时——「今天」就该是今天） */
function daysAgo(ms: number): number {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return Math.floor((todayStart - ms) / DAY_MS)
}

const rangeItems = computed(() => {
    const values: RangeValue[] = ['all', '1d', '3d', '7d', '30d']
    return values.map((value) => ({
        value,
        label: t(`settings.claudeImport.${RANGE_KEYS[value]}`),
        count:
            value === 'all'
                ? candidates.value.length
                : candidates.value.filter((c) => daysAgo(c.updatedAt) <= RANGE_DAYS[value]).length,
    }))
})

/** 工作区下拉：全部列出（可输入筛选），同名目录才退回完整路径 */
const workspaceItems = computed(() => {
    const counts = new Map<string, number>()
    for (const c of candidates.value) {
        const key = c.workspacePath || ''
        counts.set(key, (counts.get(key) || 0) + 1)
    }
    if (counts.size < 2) return []
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const nameOf = (key: string) => (key ? baseName(key) : t('settings.claudeImport.noWorkspace'))
    const dupes = new Set<string>()
    const names = entries.map(([key]) => nameOf(key))
    names.forEach((name, index) => {
        if (names.indexOf(name) !== index) dupes.add(name)
    })
    return [
        {
            value: 'all',
            label: t('settings.claudeImport.workspaceAll'),
            count: candidates.value.length,
        },
        ...entries.map(([key, count], index) => ({
            value: key,
            label: dupes.has(names[index]) ? key : names[index],
            count,
        })),
    ]
})

const groups = computed(() => {
    const q = keyword.value.trim().toLowerCase()
    const visible = candidates.value.filter((c) => {
        if (!showImported.value && c.imported) return false
        if (range.value !== 'all' && daysAgo(c.updatedAt) > RANGE_DAYS[range.value]) return false
        if (workspace.value !== 'all' && (c.workspacePath || '') !== workspace.value) return false
        if (!q) return true
        return (
            (c.previewTitle || '').toLowerCase().includes(q) ||
            c.sessionId.toLowerCase().includes(q) ||
            (c.workspacePath || '').toLowerCase().includes(q)
        )
    })

    const totals = new Map<string, number>()
    for (const c of candidates.value) {
        const key = c.workspacePath || ''
        totals.set(key, (totals.get(key) || 0) + 1)
    }
    const map = new Map<string, ClaudeImportCandidate[]>()
    for (const c of visible) {
        const key = c.workspacePath || ''
        const list = map.get(key)
        if (list) list.push(c)
        else map.set(key, [c])
    }
    return [...map.entries()]
        .sort((a, b) => b[1].length - a[1].length || b[1][0].updatedAt - a[1][0].updatedAt)
        .map(([key, items]) => ({
            key,
            path: key,
            label: key ? baseName(key) : t('settings.claudeImport.noWorkspace'),
            items,
            total: totals.get(key) || items.length,
            allSelected: items.every((c) => selected.value.has(c.sessionId)),
        }))
})

const emptyTitle = computed(() =>
    active.value.roots.length === 0
        ? t('settings.claudeImport.sourceMissingTitle', { source: sourceLabel(source.value) })
        : t('settings.claudeImport.noCandidateTitle'),
)

const emptyDesc = computed(() =>
    active.value.roots.length === 0
        ? t('settings.claudeImport.sourceMissingDesc', { path: scannedPath() })
        : t('settings.claudeImport.noCandidateDesc', { path: scannedPath() }),
)

const infoText = computed(() => t('settings.claudeImport.info', { path: scannedPath() }))

/** 扫不到根时退回约定路径，至少让用户知道该把文件放哪儿 */
function scannedPath(): string {
    if (active.value.roots.length) return active.value.roots.join('、')
    if (source.value === 'zcode') return '~/.zcode/cli/db/db.sqlite'
    if (source.value === 'dsh') return '~/.dsh/sessions'
    if (source.value === 'codex') return '~/.codex/sessions'
    return '~/.claude/projects'
}

const summaryReason = computed(() => {
    const first = summary.value?.skipped[0]
    return first ? reasonText(first.reason) : ''
})

const failedIds = computed(() => (summary.value?.failed || []).map((item) => item.sessionId))

const progressPercent = computed(() =>
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0,
)

// ─── 扫描 ───

/** 慢请求才给反馈：这么久就回来了就别亮骨架屏，闪一下比不亮更扰 */
const SCAN_UI_SHOW_DELAY = 150
/** 一旦亮过就播满这个时长再换内容，避免骨架屏闪一半消失 */
const SCAN_UI_MIN_VISIBLE = 200

interface ScanUiGate {
    show: ReturnType<typeof setTimeout> | null
    shownAt: number
}
const scanUiGates = new Map<ImportSource, ScanUiGate>()

function scanUiGate(target: ImportSource): ScanUiGate {
    let gate = scanUiGates.get(target)
    if (!gate) {
        gate = { show: null, shownAt: 0 }
        scanUiGates.set(target, gate)
    }
    return gate
}

async function withScanUi<T>(target: ImportSource, run: () => Promise<T>): Promise<T> {
    const gate = scanUiGate(target)
    gate.shownAt = 0
    gate.show = setTimeout(() => {
        gate.show = null
        gate.shownAt = Date.now()
        scanUiSource.value = target
    }, SCAN_UI_SHOW_DELAY)
    try {
        const result = await run()
        if (gate.shownAt) {
            await new Promise<void>((resolve) => setTimeout(resolve, Math.max(SCAN_UI_MIN_VISIBLE - (Date.now() - gate.shownAt), 0)))
        }
        return result
    } finally {
        if (gate.show) {
            clearTimeout(gate.show)
            gate.show = null
        }
        if (scanUiSource.value === target) scanUiSource.value = null
    }
}

onBeforeUnmount(() => {
    for (const gate of scanUiGates.values()) {
        if (gate.show) clearTimeout(gate.show)
    }
})

async function scan(target: ImportSource, opts: { silent?: boolean } = {}) {
    const state = sources[target]
    // 延迟窗口内按钮还没进 loading 态，靠这里挡住连点重复请求
    if (state.status === 'scanning') return
    if (!opts.silent) {
        state.status = 'scanning'
        // 分组随扫描一起报：粘性条一出现，「导入到」就得是有内容的下拉而不是空选项
        void ensureGroupsLoaded()
    }
    try {
        const result = opts.silent
            ? await apiService.scanClaudeSessions({ source: target })
            : await withScanUi(target, () => apiService.scanClaudeSessions({ source: target }))
        state.candidates = result.candidates
        state.roots = result.roots
        state.error = undefined
        state.status = 'ready'
        // 重扫后勾选与新候选求交，防止已被移走的源文件混进导入请求
        const valid = new Set(result.candidates.map((c) => c.sessionId))
        for (const id of [...selection[target]]) {
            if (!valid.has(id)) selection[target].delete(id)
        }
    } catch (error) {
        state.error = getErrorMessage(error)
        state.status = 'error'
    }
}

/** 不自动扫描：进页面是空着的 idle 态，由用户点「扫描候选会话」拉取 */
function switchSource(value: ImportSource) {
    if (source.value === value) return
    source.value = value
    summary.value = null
    // 各来源的 sessionId 空间不同，展开状态也不跨来源沿用
    expanded.value = new Set()
}

/** 方向键切换后要把焦点交给新的 tab，所以两个按钮都得存着（未选中项也在 DOM 里） */
function setSourceTab(value: ImportSource, el: Element | ComponentPublicInstance | null) {
    sourceTabRefs[value] = el as HTMLElement | null
}

function moveSource(step: number) {
    const index = SOURCES.indexOf(source.value)
    const next = SOURCES[(index + step + SOURCES.length) % SOURCES.length]
    switchSource(next)
    sourceTabRefs[next]?.focus()
}

// ─── 筛选 / 分组 ───

function clearFilters() {
    keyword.value = ''
    range.value = 'all'
    workspace.value = 'all'
    showImported.value = true
}

function toggleGroup(key: string) {
    const next = new Set(expanded.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expanded.value = next
}

/** 搜索时把分组摊开：默认闭合会让「搜到了却看不见」 */
const searchActive = computed(() => keyword.value.trim() !== '')

function isGroupOpen(key: string): boolean {
    return searchActive.value || expanded.value.has(key)
}

function toggleGroupSelection(group: { items: ClaudeImportCandidate[] }) {
    const ids = group.items.map((c) => c.sessionId)
    const allSelected = ids.every((id) => selected.value.has(id))
    for (const id of ids) {
        if (allSelected) selected.value.delete(id)
        else selected.value.add(id)
    }
}

// ─── 勾选 ───

function isSelected(sessionId: string): boolean {
    return selected.value.has(sessionId)
}

function setSelect(sessionId: string, value: boolean) {
    if (value) selected.value.add(sessionId)
    else selected.value.delete(sessionId)
    summary.value = null
}

function toggleSelect(sessionId: string) {
    setSelect(sessionId, !selected.value.has(sessionId))
}

function clearSelection() {
    selected.value.clear()
    summary.value = null
}

// ─── 行内展示 ───

function baseName(p: string): string {
    const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
    return parts[parts.length - 1] || p
}

function shortId(sessionId: string): string {
    return sessionId.replace(/^sess_/, '').slice(0, 8)
}

function metaSize(candidate: ClaudeImportCandidate): string {
    if (typeof candidate.messageCount === 'number') {
        return t('settings.claudeImport.messageCount', { n: candidate.messageCount })
    }
    if (typeof candidate.sizeBytes === 'number') return formatBytes(candidate.sizeBytes)
    return ''
}

function relTime(ms: number): string {
    const diff = Date.now() - ms
    if (diff < 60 * 1000) return t('settings.claudeImport.relJustNow')
    if (diff < 60 * 60 * 1000) return t('settings.claudeImport.relMinutes', { n: Math.floor(diff / (60 * 1000)) })
    if (diff < DAY_MS) return t('settings.claudeImport.relHours', { n: Math.floor(diff / (60 * 60 * 1000)) })
    const days = Math.floor(diff / DAY_MS)
    if (days < 30) return t('settings.claudeImport.relDays', { n: days })
    return new Date(ms).toLocaleDateString()
}

/** 后端跳过原因（开放 string）→ 可读文案；未知原因原样显示 */
function reasonText(reason: string): string {
    const key = `settings.claudeImport.reason.${reason}`
    const translated = t(key)
    return translated === key ? reason : translated
}

function isImporting(sessionId: string): boolean {
    return importing.value && inFlight.value.includes(sessionId)
}

// ─── 导入 ───

async function ensureGroupsLoaded() {
    if (sessionGroups.value.length) return
    try {
        sessionGroups.value = await apiService.fetchSessionGroups()
    } catch {
        // 分组只影响「导入到」的候选项，拿不到就留在未分组
    }
}

async function confirmAndImport() {
    const ids = [...selected.value]
    if (ids.length === 0) return
    if (ids.length > CONFIRM_THRESHOLD) {
        const ok = await confirm(
            t('settings.claudeImport.confirmManyTitle', { n: ids.length }),
            t('settings.claudeImport.confirmManyDesc'),
            { type: 'info', confirmText: t('settings.claudeImport.importSelected', { n: ids.length }) },
        )
        if (!ok) return
    }
    await startImport(ids)
}

async function startImport(ids: string[]) {
    if (importing.value || ids.length === 0) return
    importing.value = true
    cancelled.value = false
    summary.value = null
    inFlight.value = [...ids]
    progress.done = 0
    progress.total = ids.length
    const acc: ClaudeImportResult = { imported: [], skipped: [], failed: [] }

    for (let offset = 0; offset < ids.length; offset += IMPORT_CHUNK) {
        if (cancelled.value) break
        const chunk = ids.slice(offset, offset + IMPORT_CHUNK)
        try {
            const result = await apiService.importClaudeSessions({
                source: source.value,
                sessionIds: chunk,
                ...(groupId.value ? { groupId: groupId.value } : {}),
            })
            acc.imported.push(...result.imported)
            acc.skipped.push(...result.skipped)
            acc.failed.push(...result.failed)
        } catch (error) {
            const reason = getErrorMessage(error) || t('settings.claudeImport.importFailed')
            for (const sessionId of chunk) acc.failed.push({ sessionId, reason })
            // 整片失败（多半是网络或服务异常），后续分片不再投递
            break
        }
        progress.done = Math.min(offset + IMPORT_CHUNK, ids.length)
    }

    if (cancelled.value || progress.done < progress.total) {
        for (const sessionId of ids.slice(progress.done)) {
            acc.failed.push({ sessionId, reason: t('settings.claudeImport.reasonCancelled') })
        }
    }

    importing.value = false
    cancelled.value = false
    inFlight.value = []
    for (const item of [...acc.imported, ...acc.skipped, ...acc.failed]) selected.value.delete(item.sessionId)
    summary.value = acc
    if (acc.imported.length) {
        toast.success(t('settings.claudeImport.importSuccess', { count: acc.imported.length }))
    } else if (!acc.failed.length) {
        toast.info(t('settings.claudeImport.importNothing'))
    }
    // 幂等锚点由后端算，前端猜不出来——静默重扫一次，让「已导入 / 打开」与后端对齐
    await scan(source.value, { silent: true })
}

function cancelImport() {
    cancelled.value = true
}

function dismissSummary() {
    summary.value = null
}

function openSession(sessionId: string) {
    router.replace({ name: 'Chat', params: { sessionId } })
}

function gotoSessionList() {
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
}
</script>

<style scoped>
/* 内容列宽由设置页统一限宽（md:max-w-220），这里只管行内几何 */
.ci-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 40px;
    margin-bottom: 8px;
    flex-wrap: wrap;
}

.ci-bar__left,
.ci-bar__right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.ci-bar__right {
    flex-shrink: 0;
}

/* 来源切换：下划线条选中态，不用主题色 */
.ci-sources {
    display: flex;
    align-items: center;
    gap: 4px;
}

.ci-source {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    cursor: pointer;
    font-size: var(--gd-size-text-base);
    line-height: 20px;
    color: var(--gd-color-text-gray);
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
}

.ci-source:hover {
    color: var(--gd-color-text);
}

.ci-source.is-active {
    color: var(--gd-color-text);
    font-weight: 500;
    border-bottom-color: var(--gd-color-text);
}

.ci-info {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}

.ci-info:hover {
    background-color: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}

.ci-info :deep(svg) {
    width: 16px;
    height: 16px;
}

.ci-search {
    width: 224px;
}

/* 筛选条：时间 + 工作区两个下拉，右侧一个开关，一行收完 */
.ci-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.ci-filters__spacer {
    flex: 1;
}

/* GdSelect 是 fragment 根且 inheritAttrs:false，外部 class 进不了它的 scoped 选择器，
   宽度由这层壳负责 */
.ci-select {
    flex-shrink: 0;
}

.ci-select--range {
    width: 132px;
}

.ci-select--workspace {
    width: 216px;
}

/* 分组 */
.ci-groups {
    min-width: 0;
}

.ci-group {
    margin-bottom: 4px;
}

.ci-group__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.15s;
}

.ci-group__head:hover {
    background-color: var(--gd-color-surface-subtle-hover);
}

.ci-group__caret {
    flex-shrink: 0;
    color: var(--gd-color-text-disabled);
}

.ci-group__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--gd-size-text-xs);
    line-height: 16px;
    font-weight: 600;
    color: var(--gd-color-text);
}

.ci-group__count {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 14px;
    color: var(--gd-color-text-disabled);
}

.ci-group__action {
    flex-shrink: 0;
}

/* 候选行 */
.ci-rows {
    min-width: 0;
}

.ci-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.15s;
}

.ci-row:hover {
    background-color: var(--gd-color-sidebar-bg-hover);
}

.ci-row.is-selected {
    background-color: color-mix(in srgb, var(--gd-color-text) 5%, transparent);
}

/* 方块 16px 居中到 20px 标题行：(20-16)/2 = 2 */
.ci-row__box {
    padding-top: 2px;
}

.ci-row__main {
    flex: 1;
    min-width: 0;
}

.ci-row__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--gd-size-text-base);
    line-height: 20px;
    color: var(--gd-color-text);
}

.ci-row__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-height: 20px;
    margin-top: 4px;
    font-size: var(--gd-size-text-xs);
    line-height: 16px;
    color: var(--gd-color-text-gray);
}

.ci-row__sep {
    color: color-mix(in srgb, var(--gd-color-text) 22%, transparent);
}

.ci-row__id {
    font-family: var(--gd-font-mono);
    font-size: 11px;
    line-height: 16px;
    color: var(--gd-color-text-disabled);
}

.ci-row__side {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding-top: 2px;
}

/* 行内动作与插件列表同款：静态不可见，指针或键盘落到行上才出现；
   触屏没有 hover，常驻显示。 */
.ci-row__btn {
    opacity: 0;
    transition: opacity 0.15s ease, background-color 0.2s, border-color 0.2s, color 0.2s;
}

.ci-row:hover .ci-row__btn,
.ci-row:focus-within .ci-row__btn {
    opacity: 1;
}

html.mobile .ci-row__btn {
    opacity: 1;
}

/* 空态 / 错误 / 骨架 */
/* GdEmpty 的根元素自己带着 .ci-empty，:deep 的后代选择器匹配不到，直接命中它 */
.ci-empty {
    gap: 8px;
    padding: 40px 20px;
}

.ci-empty__title {
    font-size: var(--gd-size-text-base);
    line-height: 20px;
    color: var(--gd-color-text);
}

.ci-empty__desc {
    max-width: 520px;
    font-size: var(--gd-size-text-xs);
    line-height: 18px;
    color: var(--gd-color-text-gray);
    word-break: break-all;
}

.ci-empty__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}

.ci-error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--gd-color-danger) 10%, var(--gd-color-surface));
}

.ci-error__body {
    flex: 1;
    min-width: 0;
}

.ci-error__title {
    font-size: var(--gd-size-text-base);
    line-height: 20px;
    color: var(--gd-color-text);
}

.ci-error__desc {
    margin-top: 2px;
    font-size: var(--gd-size-text-xs);
    line-height: 18px;
    color: var(--gd-color-text-gray);
    word-break: break-all;
}

.ci-skel {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 8px;
    animation: ci-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.ci-skel__box {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-top: 2px;
    border-radius: 4px;
    background-color: color-mix(in srgb, var(--gd-color-text) 10%, var(--gd-color-bg));
}

.ci-skel__lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.ci-skel__line {
    width: 100%;
    height: 20px;
    border-radius: 4px;
    background-color: color-mix(in srgb, var(--gd-color-text) 10%, var(--gd-color-bg));
}

.ci-skel__line--title {
    width: 45%;
    height: 20px;
}

@keyframes ci-pulse {

    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.5;
    }
}

/* 粘性操作条：只在有选择 / 导入中 / 有结果时出现 */
.ci-bar-bottom {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background-color: var(--gd-color-surface);
    border: 1px solid color-mix(in srgb, var(--gd-color-text) 12%, transparent);
    box-shadow: 0 -2px 12px color-mix(in srgb, var(--gd-color-text) 6%, transparent);
    flex-wrap: wrap;
}

.ci-bar__text {
    font-size: var(--gd-size-text-xs);
    line-height: 18px;
    color: var(--gd-color-text);
    white-space: nowrap;
}

/* 条内容分两组：窄容器在两组之间换行，最多两行，不会散成三行 */
.ci-bar-bottom__info,
.ci-bar-bottom__actions {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
}

.ci-bar-bottom__actions {
    gap: 8px;
    margin-left: auto;
}

.ci-bar__reason {
    color: var(--gd-color-text-gray);
}

.ci-bar__num {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 14px;
    color: var(--gd-color-text-disabled);
}

.ci-bar__label {
    flex-shrink: 0;
    font-size: var(--gd-size-text-xs);
    line-height: 18px;
    color: var(--gd-color-text-gray);
    white-space: nowrap;
}

.ci-group-select {
    width: 140px;
    flex-shrink: 0;
}

.ci-progress {
    flex: 1;
    min-width: 120px;
    height: 4px;
    border-radius: 999px;
    overflow: hidden;
    background-color: color-mix(in srgb, var(--gd-color-text) 10%, var(--gd-color-bg));
}

.ci-progress i {
    display: block;
    height: 100%;
    border-radius: 999px;
    background-color: var(--gd-color-text-gray);
    transition: width var(--gd-motion-duration-base) var(--gd-motion-ease-out);
}
</style>
