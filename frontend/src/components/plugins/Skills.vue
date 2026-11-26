<template>
    <div class="flex-1 skills-page">
        <!-- 视图条：二级切换 + 当前视图的动作（取代原大标题区与市场自带标题行） -->
        <div class="plugins-view-bar">
            <div class="plugins-view-bar__left">
                <PluginViewSwitch v-model="view" :items="viewItems" />
                <button v-tooltip="t('plugins.skills.subtitle')" type="button" class="plugins-view-info" :aria-label="t('plugins.page.info')">
                        <Info24Regular />
                    </button>
                <!-- 项目下拉：只影响「已安装」视图；切到市场语义仍是全局安装。
                     全局项的 value 为 ''（无值态），触发器用 placeholder 显示「全局技能」。
                     宽度由外层容器决定：GdSelect 基准是 w-full，直接给类会被同特异性覆盖 -->
                <div v-if="view === 'installed'" class="plugins-project-select">
                    <GdSelect
                        v-model="projectSelectValue"
                        :options="projectSelectOptions"
                        :loading="projectsLoading"
                        :placeholder="t('plugins.skills.projectAll')"
                        :no-data-text="t('plugins.skills.projectEmpty')"
                        filterable
                        @visible-change="handleProjectSelectVisible"
                    />
                </div>
            </div>
            <div class="plugins-view-bar__right">
                <template v-if="view === 'installed'">
                    <GdButton circle :loading="scanning" v-tooltip="t('plugins.skills.scan')" @click="handleScan">
                        <template #icon>
                            <ArrowClockwise16Regular />
                        </template>
                    </GdButton>
                    <GdButton type="primary" @click="handleShowInstallDialog"
                        :title="selectedProjectId ? t('plugins.skills.installGlobalHint') : undefined">
                        <template #icon>
                            <ArrowUpload16Regular />
                        </template>
                        {{ t('plugins.skills.install') }}
                    </GdButton>
                    <GdButton @click="handleOpenSkillsDocs">
                        <template #icon>
                            <Document16Regular />
                        </template>
                        {{ t('plugins.skills.docs') }}
                    </GdButton>
                </template>
                <template v-else-if="view === 'market'">
                    <GdInput
                        v-model="marketKeyword"
                        :placeholder="t('plugins.skills.marketSearchPlaceholder')"
                        clearable
                        size="default"
                        class="plugins-search"
                    >
                        <template #prefix>
                            <Search16Regular class="size-4"  />
                        </template>
                    </GdInput>
                    <GdButton link size="small" :loading="marketLoading" @click="handleMarketRefresh">
                        <template #icon>
                            
                                <ArrowClockwise16Regular class="size-4" :class="{ 'animate-spin': marketLoading }" />
                            
                        </template>
                        {{ marketLoading ? t('common.loading') : t('plugins.skills.marketRefresh') }}
                    </GdButton>
                    <GdButton circle size="small" v-tooltip="t('plugins.page.marketOpenWeb')" @click="handleOpenMarketSite">
                        <template #icon>
                            <ArrowUpRight16Regular />
                        </template>
                    </GdButton>
                </template>
                <template v-else>
                    <GdInput
                        v-model="skillhubKeyword"
                        :placeholder="t('plugins.skills.skillhubSearchPlaceholder')"
                        clearable
                        size="default"
                        class="plugins-search"
                    >
                        <template #prefix>
                            <Search16Regular class="size-4"  />
                        </template>
                    </GdInput>
                    <GdButton link size="small" :loading="skillHubLoading" @click="handleSkillHubRefresh">
                        <template #icon>
                            <ArrowClockwise16Regular class="size-4" :class="{ 'animate-spin': skillHubLoading }" />
                        </template>
                        {{ skillHubLoading ? t('common.loading') : t('plugins.skills.skillhubRefresh') }}
                    </GdButton>
                    <GdButton circle size="small" v-tooltip="t('plugins.page.marketOpenWeb')" @click="handleOpenSkillHubSite">
                        <template #icon>
                            <ArrowUpRight16Regular />
                        </template>
                    </GdButton>
                </template>
            </div>
        </div>

        <!-- 已安装视图：来源筛选 chips 取代原竖排可折叠分区 -->
        <div v-show="view === 'installed'" class="plugins-view-fade">
            <div v-if="skillGroups.length > 0" class="plugins-filter-row">
                <button
                    v-for="chip in sourceChips"
                    :key="chip.key"
                    type="button"
                    class="plugins-chip"
                    :class="{ 'is-active': sourceFilter === chip.key }"
                    @click="sourceFilter = chip.key"
                >
                    {{ chip.label }}
                </button>
                <!-- 项目视图：把「本项目有显式覆盖」做成可点的筛选入口，便于核对与恢复继承 -->
                <button
                    v-if="projectOverrideCount > 0"
                    type="button"
                    class="plugins-chip plugins-filter-row__spacer"
                    :class="{ 'is-active': labelFilter === 'project-override' }"
                    @click="labelFilter = labelFilter === 'project-override' ? '' : 'project-override'"
                >
                    {{ t('plugins.skills.projectOverrideCount', { count: projectOverrideCount }) }}
                </button>
            </div>

            <div
                v-if="visibleSkills.length > 0"
                class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2"
            >
                <PluginListRow
                    v-for="skill in visibleSkills"
                    :key="skill.id"
                    :name="getSkillDisplayName(skill.manifest, skill.id)"
                    :icon-src="skill.origin?.iconUrl"
                    :description="getSkillDisplayDescription(skill.manifest) || t('plugins.skills.noDescription')"
                    :muted="skill.enabled === false"
                    :menu-items="getSkillMenuItems(skill)"
                    @click="handleViewDocumentation(skill.id)"
                    @command="(command) => handleSkillCommand(command, skill)"
                >
                    <template #badges>
                        <GdTag v-if="skill.provider" size="small" type="warning" effect="light">{{ t('plugins.skills.fromPlugin') }}</GdTag>
                        <GdTag v-else-if="skill.source === 'system'" size="small" type="success" effect="light">{{ t('plugins.skills.sourceBuiltin') }}</GdTag>
                        <GdTag v-else-if="skill.source === 'agents'" size="small" type="warning" effect="light">{{ t('plugins.skills.sourceShared') }}</GdTag>
                        <GdTag v-else-if="skill.source === 'workspace'" size="small" type="primary" effect="light">{{ t('plugins.skills.sourceProject') }}</GdTag>
                        <!-- 作用域徽标与来源徽标相互独立：插件技能也会从全局继承，
                             若用 v-else-if 串联，「插件」会把「全局」挤掉 -->
                        <GdTag
                            v-if="selectedProjectId && skill.source !== 'workspace' && skill.projectOverride === undefined"
                            size="small"
                            type="info"
                            effect="plain"
                        >{{ t('plugins.skills.inheritedGlobal') }}</GdTag>
                        <GdTag v-if="skill.overridden" size="small" type="info" effect="plain">{{ t('plugins.skills.overriddenGlobal') }}</GdTag>
                        <!-- 项目显式覆盖：true = 本项目已启用（即使全局关闭），false = 本项目已禁用 -->
                        <GdTag v-if="skill.projectOverride === true" size="small" type="success" effect="light">{{ t('plugins.skills.projectEnabledBadge') }}</GdTag>
                        <GdTag v-else-if="skill.projectOverride === false" size="small" type="warning" effect="light">{{ t('plugins.skills.projectDisabledBadge') }}</GdTag>
                        <GdTag v-if="skill.origin?.source === 'skillhub'" size="small" type="info" effect="light">{{ t('plugins.skills.originSkillHub') }}</GdTag>
                        <GdTag v-if="skill.manifest.version" type="info" size="small" effect="plain">v{{ skill.manifest.version }}</GdTag>
                    </template>
                    <template #actions>
                        <GdSwitch v-if="skill.provider" v-tooltip="t('plugins.skills.pluginManaged')" :model-value="skill.enabled !== false" disabled size="small" />
                        <!-- 项目视图：开关写项目覆盖（可双向，能打开全局已关闭的技能）；
                             全局视图：写全局启停 -->
                        <GdSwitch
                            v-else
                            :model-value="skill.enabled !== false"
                            :loading="updatingSkills.has(skill.id)"
                            @update:model-value="(val: string | number | boolean) => handleToggleSkill(skill.id, !!val)"
                            @click.stop
                            size="small"
                        />
                    </template>
                </PluginListRow>
            </div>

            <!-- 空状态 -->
            <div v-else-if="!loading"
                class="rounded-[var(--gd-size-surface-radius)] overflow-hidden bg-(--gd-color-surface-subtle)">
                <div class="p-12 text-center">
                    
                        <MailInbox24Regular class="mb-4 opacity-50 text-gray-400 w-16 h-16 mx-auto"  />
                    
                    <div class="text-xl font-medium text-gray-600 dark:text-[#e8e9ed] mb-2">
                        {{ t('plugins.skills.empty') }}
                    </div>
                    <div v-if="selectedProjectId" class="text-sm text-gray-500 dark:text-[#8b8d95] mb-4">
                        {{ t('plugins.skills.projectEmptyHint', { path: selectedProjectPath || '' }) }}
                    </div>
                    <div v-else class="text-sm text-gray-500 dark:text-[#8b8d95] mb-4">
                        {{ t('plugins.skills.emptyHint') }}
                    </div>
                    <GdButton type="primary" @click="handleScan" :loading="scanning">
                        <template #icon>
                            <ArrowClockwise16Regular />
                        </template>
                        {{ t('plugins.skills.scanNow') }}
                    </GdButton>
                    <GdButton v-if="selectedProjectId" class="ml-2" @click="handleSelectProject('')">
                        {{ t('plugins.skills.projectBackToGlobal') }}
                    </GdButton>
                    <GdButton v-else class="ml-2" @click="view = 'market'">
                        {{ t('plugins.page.goMarket') }}
                    </GdButton>
                </div>
            </div>
        </div>

        <!-- 市场视图：v-show 保留实例，切回来不重新请求、搜索与筛选状态都在；数据首次进入才拉 -->
        <div v-show="view === 'market'" class="plugins-view-fade">
            <SkillMarket
                ref="marketRef"
                v-model:keyword="marketKeyword"
                :local-skills="marketLocalSkills"
                :active="view === 'market'"
                @installed="() => loadSkills()"
            />
        </div>

        <!-- SkillHub 视图：独立第三视图，数据由本机后端代理 -->
        <div v-show="view === 'skillhub'" class="plugins-view-fade">
            <SkillHubMarket
                ref="skillHubRef"
                v-model:keyword="skillhubKeyword"
                :local-skills="marketLocalSkills"
                :active="view === 'skillhub'"
                @installed="() => loadSkills()"
            />
        </div>

        <!-- 查看文档对话框 -->
        <GdDialog v-model="showDocDialog" :title="currentSkillName + ' - SKILL.md'" size="lg"
            align-center destroy-on-close append-to-body>

            <div v-if="loadingDoc" class="flex justify-center items-center py-12">
                
                    <ArrowSync16Regular class="w-8 h-8 animate-spin" />
                
            </div>
            <div v-else-if="docError" class="py-12 text-center text-red-500">
                {{ docError }}
            </div>
            <div v-else>
                <!-- 元信息表格 -->
                <div v-if="parsedMeta.length > 0" class="skill-meta-table mb-6">
                    <table>
                        <tbody>
                            <tr v-for="item in parsedMeta" :key="item.key">
                                <td class="meta-key">{{ item.key }}</td>
                                <td class="meta-value">{{ item.value }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <!-- 正文内容 -->
                <MarkdownContent class="markdown-text" :content="bodyContent" />
            </div>
            <template #footer>
                <GdButton @click="showDocDialog = false">{{ t('common.close') }}</GdButton>
            </template>
        </GdDialog>

        <!-- 安装 Skill 对话框 -->
        <GdDialog v-model="showInstallDialog" :title="t('plugins.skills.installTitle')" size="sm" align-center destroy-on-close>
            <div class="py-4">
                <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                    {{ t('plugins.skills.installDesc') }}
                </div>

                <div class="rounded-lg border-2 border-dashed border-gray-300 dark:border-[#4a4b52] p-8 text-center cursor-pointer transition-colors duration-150 hover:border-(--gd-color-primary)"
                    @click="triggerFileSelect" @dragover.prevent @drop.prevent="handleDrop">
                    <input ref="fileInputRef" type="file" accept=".zip" class="sr-only" @change="handleNativeFileChange" />
                    <ArrowUpload24Regular class="mb-4 text-gray-400 dark:text-[#6b6d75] w-12 h-12 mx-auto" />
                    <div class="text-sm">
                        {{ t('plugins.skills.uploadText') }} <em class="not-italic text-(--gd-color-primary)">{{ t('plugins.skills.uploadClick') }}</em>
                    </div>
                    <div class="text-xs text-gray-500 mt-2">
                        {{ t('plugins.skills.uploadTip') }}
                    </div>
                </div>

                <div v-if="selectedFile" class="mt-4 p-3 bg-gray-50 dark:bg-[#2a2c30] rounded-lg">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            
                                <Document16Regular class="size-4"  />
                            
                            <span class="text-sm">{{ selectedFile.name }}</span>
                        </div>
                        <GdButton link type="danger" @click="clearSelectedFile">
                            
                                <Dismiss16Regular class="size-4"  />
                            
                        </GdButton>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        {{ t('plugins.skills.fileSize', { size: formatFileSize(selectedFile.size) }) }}
                    </div>
                </div>

                <div class="mt-4">
                    <GdCheckbox v-model="forceOverwrite">
                        <span class="text-sm">{{ t('plugins.skills.forceOverwrite') }}</span>
                    </GdCheckbox>
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1 ml-6">
                        {{ t('plugins.skills.forceOverwriteHint') }}
                    </div>
                </div>
            </div>

            <template #footer>
                <GdButton @click="showInstallDialog = false">{{ t('common.cancel') }}</GdButton>
                <GdButton type="primary" @click="handleInstallSkill" :loading="installing" :disabled="!selectedFile">
                    {{ t('plugins.skills.installBtn') }}
                </GdButton>
            </template>
        </GdDialog>

    </div>
</template>
<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GdButton from '@/components/ui/GdButton.vue';
import GdCheckbox from '@/components/ui/GdCheckbox.vue';
import GdTag from '@/components/ui/GdTag.vue';
import { toast } from '@/components/ui/toastService';
import GdInput from '@/components/ui/GdInput.vue';
import GdSwitch from '@/components/ui/GdSwitch.vue';

import { ArrowSync16Regular, ArrowUpload16Regular, ArrowUpload24Regular, ArrowUpRight16Regular, Document16Regular, Dismiss16Regular, ArrowClockwise16Regular, Info24Regular, MailInbox24Regular, Search16Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { usePluginViewQuery } from '@/composables/usePluginViewQuery'
import { getSkillDisplayName, getSkillDisplayDescription } from '@/utils/skillDisplay'
import { groupSkills } from '@/utils/pluginGroups'
import { resolveSelectedProject, toProjectOptions } from '@/utils/skillsProjectScope'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import { openInExternalBrowser } from '@/utils/browserUtils'
import GdDialog from '@/components/ui/GdDialog.vue'
import GdSelect from '@/components/ui/GdSelect.vue'
import PluginListRow from './PluginListRow.vue'
import PluginViewSwitch from './PluginViewSwitch.vue'
import SkillMarket from './SkillMarket.vue'
import SkillHubMarket from './SkillHubMarket.vue'
import type { PluginRowMenuItem, PluginViewSwitchItem } from './pluginList.types'
import type { Skill } from '@/types/skills'
import type { ProjectGroup } from '@/types/session'

const loading = ref(false)
const scanning = ref(false)
const reloadingSkills = ref<Set<string>>(new Set())
const { t } = useI18n()
const { confirm } = usePopup()

/** 项目下拉选中值：'' = 全局技能 */
const selectedProjectId = ref('')

/**
 * 项目清单（本页私有）。
 *
 * 刻意不复用侧栏 store 的 `projectGroups`：
 * - 侧栏快照只含「有可见会话」的项目，空项目会缺失；
 * - 侧栏那份还要掺入虚拟「通用」桶，而下拉只允许真实目录。
 * 因此这里直接取完整清单 `GET /project-groups`，页面卸载即释放。
 */
const projectOptions = ref<ProjectGroup[]>([])
const projectsLoading = ref(false)

/** 全局技能（默认视图 + 市场已安装标记的唯一依据） */
const globalSkills = ref<Skill[]>([])
/** 当前项目的技能（全局 + 项目 `.guada/skills`，同名已由后端覆盖） */
const projectSkills = ref<Skill[]>([])
/** 正在展示的清单：选了项目就用项目视图，否则全局 */
const skills = computed<Skill[]>(() =>
    selectedProjectId.value ? projectSkills.value : globalSkills.value,
)
// 市场/SkillHub 的「已安装」标记始终按全局口径，避免项目同名覆盖造成误判
const marketLocalSkills = computed<Skill[]>(() => globalSkills.value)
/** 已安装技能按来源分区（插件提供/内置/用户安装/共享/项目） */
const skillGroups = computed(() => groupSkills(skills.value))

const projectSelectOptions = computed(() => [
    { label: t('plugins.skills.projectAll'), value: '' },
    ...toProjectOptions(projectOptions.value),
])
const selectedProjectPath = computed(
    () => resolveSelectedProject(projectOptions.value, selectedProjectId.value)?.path ?? '',
)
/** v-model 桥：GdSelect 清空会发 ''，这里统一成字符串 */
const projectSelectValue = computed({
    get: () => selectedProjectId.value,
    set: (value: string | number | Array<string | number>) => {
        const next = typeof value === 'string' ? value : ''
        if (next !== selectedProjectId.value) handleSelectProject(next)
    },
})

/** 请求序号：切换项目时让在途的旧请求作废，避免慢响应覆盖新列表 */
let skillsRequestSeq = 0

/** 拉取完整项目清单（含空项目）；失败保留旧值，下拉仍可用 */
async function refreshProjectOptions(): Promise<void> {
    projectsLoading.value = true
    try {
        const rows = await apiService.fetchProjectGroups()
        projectOptions.value = (rows || []).filter(
            (g) => g.kind === 'workspace' && !!g.path,
        )
    } catch (err) {
        console.error('加载项目清单失败:', err)
    } finally {
        projectsLoading.value = false
    }
}

// ── 二级视图：已安装 / 市场 / SkillHub（状态落 route query，刷新与前进后退不丢）──
const view = usePluginViewQuery(
    'installed',
    ['installed', 'market', 'skillhub'],
    'skills',
)
/** 市场搜索词由页面工具栏持有，市场组件常驻不销毁，切回来仍保留 */
const marketKeyword = ref('')
/** SkillHub 搜索词独立于官网市场，避免两边搜索状态互相污染 */
const skillhubKeyword = ref('')
/** 已安装的来源筛选（'' = 全部）；与市场标签筛选各自独立 */
const sourceFilter = ref('')
/** 额外的标签筛选：'' = 无；'project-disabled' = 只看被本项目禁用的 */
const labelFilter = ref<'' | 'project-override'>('')
const marketRef = ref<InstanceType<typeof SkillMarket> | null>(null)
const skillHubRef = ref<InstanceType<typeof SkillHubMarket> | null>(null)

const viewItems = computed<PluginViewSwitchItem[]>(() => [
    { value: 'installed', label: t('plugins.page.viewInstalled') },
    { value: 'market', label: t('plugins.page.viewMarket') },
    { value: 'skillhub', label: t('plugins.page.viewSkillHub') },
])

/** 来源 chips：全部 + 有人的分区（空分区不出现，所以不用再带数字） */
const sourceChips = computed(() => [
    { key: '', label: t('plugins.page.sourceFilterAll') },
    ...skillGroups.value.map(g => ({
        key: g.key,
        label: t(`plugins.skills.groups.${g.key}`),
    })),
])

const visibleSkills = computed<Skill[]>(() => {
    const bySource = sourceFilter.value
        ? (skillGroups.value.find(g => g.key === sourceFilter.value)?.items ?? [])
        : skills.value
    if (labelFilter.value !== 'project-override') return bySource
    return bySource.filter(s => s.projectOverride !== undefined)
})

/** 项目视图里「被本项目显式覆盖」的数量（启用与禁用都算） */
const projectOverrideCount = computed(() =>
    selectedProjectId.value
        ? skills.value.filter(s => s.projectOverride !== undefined).length
        : 0,
)

// 切换项目时筛选会指向不存在的技能，必须一并重置
watch(selectedProjectId, () => {
    labelFilter.value = ''
})

/** 换一批按钮的加载态取自市场组件（v-show 常驻，父级只读不调） */
const marketLoading = computed(() => marketRef.value?.loading === true)
const skillHubLoading = computed(() => skillHubRef.value?.loading === true)

function handleMarketRefresh() {
    marketRef.value?.refresh()
}

function handleSkillHubRefresh() {
    skillHubRef.value?.refresh()
}

function handleOpenMarketSite() {
    openInExternalBrowser('https://ai.dingd.cn/skills')
}

function handleOpenSkillHubSite() {
    openInExternalBrowser('https://skillhub.cn/skills')
}

/** 项目下拉打开时刷新清单：新建项目、改名、删除后立刻反映在选项里 */
async function handleProjectSelectVisible(visible: boolean) {
    if (!visible) return
    await refreshProjectOptions()
    // 选中的项目可能刚被删掉：回落全局视图并提示
    if (
        selectedProjectId.value &&
        !resolveSelectedProject(projectOptions.value, selectedProjectId.value)
    ) {
        handleSelectProject('')
        toast.warning(t('plugins.skills.projectMissing'))
    }
}

/**
 * 切换项目作用域。
 *
 * 全局（''）与项目共用同一套界面：来源筛选重置，避免上一个作用域的 chip
 * 在新列表里不存在；文档弹窗一并关掉，否则内容与当前列表不匹配。
 */
function handleSelectProject(projectGroupId: string) {
    if (projectGroupId === selectedProjectId.value) return
    selectedProjectId.value = projectGroupId
    sourceFilter.value = ''
    showDocDialog.value = false
    void loadSkills()
}

/** 当前项目作用域下要带的 projectGroupId（全局时为 undefined） */
const activeProjectGroupId = computed(() => selectedProjectId.value || undefined)

// 文档查看相关状态
const showDocDialog = ref(false)
const loadingDoc = ref(false)
const docError = ref<string | null>(null)
const documentation = ref('')
const currentSkillName = ref('')
const currentSkillId = ref('')

// 解析 YAML frontmatter
interface SkillMeta {
    key: string
    value: string
}

const parsedMeta = computed((): SkillMeta[] => {
    const content = documentation.value
    if (!content) return []

    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
    if (!match) return []

    const yamlContent = match[1]
    const lines = yamlContent.split('\n')
    const result: SkillMeta[] = []

    let i = 0
    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
            i++
            continue
        }

        const colonIndex = trimmed.indexOf(':')
        if (colonIndex === -1) {
            i++
            continue
        }

        const key = trimmed.substring(0, colonIndex).trim()
        let value = trimmed.substring(colonIndex + 1).trim()

        // 处理多行字符串：> 或 | 折叠符
        if (value === '>' || value === '|' || value === '>-' || value === '|-') {
            const multilineValues: string[] = []
            i++
            // 收集缩进行
            while (i < lines.length) {
                const nextLine = lines[i]
                if (nextLine.match(/^\s+/)) {
                    multilineValues.push(nextLine.trim())
                    i++
                } else if (nextLine.trim() === '') {
                    // 空行：多行字符串中的空行保留一个标记
                    multilineValues.push('')
                    i++
                } else {
                    break
                }
            }
            if (multilineValues.length > 0) {
                // 过滤尾部空行
                while (multilineValues.length > 0 && multilineValues[multilineValues.length - 1] === '') {
                    multilineValues.pop()
                }
                result.push({ key, value: multilineValues.join(' ') })
            }
            continue
        }

        // 处理数组格式：tags 等
        if (value === '' && trimmed.endsWith(':')) {
            const arrayItems: string[] = []
            i++
            while (i < lines.length) {
                const nextLine = lines[i]
                if (nextLine.match(/^\s+-\s+/)) {
                    const item = nextLine.replace(/^\s+-\s*/, '').trim()
                    if (item) arrayItems.push(item)
                    i++
                } else if (nextLine.trim() && !nextLine.match(/^\s+/)) {
                    break
                } else {
                    i++
                }
            }
            if (arrayItems.length > 0) {
                result.push({ key, value: arrayItems.join(', ') })
            }
            continue
        }

        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        if (key && value) {
            result.push({ key, value })
        }
        i++
    }

    return result
})

// 提取正文（去掉 frontmatter）
const bodyContent = computed(() => {
    const content = documentation.value
    if (!content) return ''

    const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
    return match ? match[1].trim() : content.trim()
})

// 安装相关状态
const showInstallDialog = ref(false)
const installing = ref(false)
const selectedFile = ref<File | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const forceOverwrite = ref(false)

// 卸载相关状态
const uninstallingSkills = ref<Set<string>>(new Set())
const updatingSkills = ref<Set<string>>(new Set())

/**
 * 加载 Skills 列表。
 *
 * 两份清单并行取：全局那份始终新鲜（市场已安装标记依赖它），项目那份只在
 * 选了项目时才有意义。序号守卫让「切到 A 又切到 B」时慢响应不覆盖新列表。
 */
async function loadSkills() {
    const seq = ++skillsRequestSeq
    const projectGroupId = activeProjectGroupId.value
    loading.value = true

    const [globalResult, projectResult] = await Promise.allSettled([
        apiService.fetchSkills(),
        projectGroupId
            ? apiService.fetchSkills({ projectGroupId })
            : Promise.resolve(null),
    ])

    if (seq !== skillsRequestSeq) return // 已被更新的选择取代

    if (globalResult.status === 'fulfilled') {
        globalSkills.value = Array.isArray(globalResult.value?.items) ? globalResult.value.items : []
    } else {
        console.error('加载 Skills 失败:', globalResult.reason)
        globalSkills.value = []
        toast.error(getErrorMessage(globalResult.reason) || t('plugins.skills.loadFailed'))
    }

    if (!projectGroupId) {
        projectSkills.value = []
    } else if (projectResult.status === 'fulfilled') {
        const resp = projectResult.value
        projectSkills.value = Array.isArray(resp?.items) ? resp.items : []
    } else {
        // 项目刚被删除（404）或后端出错：清空项目清单并提示，不污染全局视图
        console.error('加载项目 Skills 失败:', projectResult.reason)
        projectSkills.value = []
        const status = (projectResult.reason as { status?: number } | undefined)?.status
        toast.error(
            status === 404
                ? t('plugins.skills.projectMissing')
                : getErrorMessage(projectResult.reason) || t('plugins.skills.loadFailed'),
        )
    }

    loading.value = false
}

/**
 * 切换技能开关：按当前作用域分流。
 *
 * - 全局视图 → 写全局配置（影响所有项目）
 * - 项目视图 → 写项目覆盖（仅本项目，可双向：能打开全局已关闭的技能）
 */
async function handleToggleSkill(skillId: string, enabled: boolean) {
    const skill = skills.value.find(s => s.id === skillId)
    if (!skill) return

    const projectGroupId = selectedProjectId.value
    const previousState = skill.enabled
    const previousOverride = skill.projectOverride
    // 乐观更新：项目视图下标记为显式覆盖
    skill.enabled = enabled
    if (projectGroupId) skill.projectOverride = enabled
    updatingSkills.value.add(skillId)

    try {
        // 全局与项目走同一个接口，作用域由 projectGroupId 决定：
        // 全局 → <SETTINGS_DIR>/skills.yaml；项目 → <项目>/.guada/skills.yaml
        await apiService.setSkillEnabled(
            skillId,
            enabled,
            projectGroupId || undefined,
        )
    } catch (err) {
        // 失败回滚
        skill.enabled = previousState
        skill.projectOverride = previousOverride
        console.error('切换技能状态失败:', err)
        toast.error(
            getErrorMessage(err) ||
                (projectGroupId
                    ? t('plugins.skills.projectConfigSaveFailed')
                    : t('plugins.skills.toggleFailed')),
        )
    } finally {
        updatingSkills.value.delete(skillId)
    }
}

function getSkillMenuItems(skill: Skill): PluginRowMenuItem[] {
    const items: PluginRowMenuItem[] = [{
        command: 'reload',
        label: t('plugins.skills.reload'),
        disabled: reloadingSkills.value.has(skill.id),
    }]

    if (skill.source === 'agents') {
        items.push({
            command: 'uninstall',
            label: t('plugins.skills.uninstall'),
            disabled: true,
            danger: true,
            title: t('plugins.skills.sharedTooltip'),
        })
    } else if (skill.source === 'workspace') {
        // 项目技能属项目资产：可以开关（项目级配置），但删除目录仍属项目维护范围
        items.push({
            command: 'uninstall',
            label: t('plugins.skills.uninstall'),
            disabled: true,
            danger: true,
            title: t('plugins.skills.projectDeleteTooltip'),
        })
    } else if (skill.source !== 'system') {
        items.push({
            command: 'uninstall',
            label: t('plugins.skills.uninstall'),
            danger: true,
            disabled: uninstallingSkills.value.has(skill.id),
        })
    }

    return items
}

function handleSkillCommand(command: string, skill: Skill) {
    if (command === 'reload') void handleReloadSkill(skill.id)
    else if (command === 'uninstall') void handleUninstallSkill(skill.id)
}

/**
 * 触发手动扫描（带项目作用域时，后端先刷新该项目来源再全量扫描）
 */
async function handleScan() {
    scanning.value = true

    try {
        await apiService.scanSkills(activeProjectGroupId.value)
        toast.success(t('plugins.skills.scanSuccess'))
        // 扫描后重新加载列表
        await loadSkills()
    } catch (err) {
        console.error('扫描 Skills 失败:', err)
        const errorMsg = getErrorMessage(err) || t('plugins.skills.scanFailed')
        toast.error(errorMsg)
    } finally {
        scanning.value = false
    }
}

/**
 * 重载指定 Skill
 *
 * 项目视图下带 projectGroupId：同名技能重载的必须是页面上显示的项目版本，
 * 否则会出现「列表是项目版、重载改了全局版」。
 */
async function handleReloadSkill(skillId: string) {
    try {
        reloadingSkills.value.add(skillId)
        await apiService.reloadSkill(skillId, activeProjectGroupId.value)
        toast.success(t('plugins.skills.reloadSuccess'))
        // 重载后重新加载列表
        await loadSkills()
    } catch (err) {
        console.error('重载 Skill 失败:', err)
        const errorMsg = getErrorMessage(err) || t('plugins.skills.reloadFailed')
        toast.error(errorMsg)
    } finally {
        reloadingSkills.value.delete(skillId)
    }
}

/**
 * 查看 Skill 文档（项目视图下读项目版本，与列表来源保持一致）
 */
async function handleViewDocumentation(skillId: string) {
    showDocDialog.value = true
    loadingDoc.value = true
    docError.value = null
    documentation.value = ''

    // 获取 skill 名称用于标题（优先展示扩展字段）
    const skill = skills.value.find(s => s.id === skillId)
    currentSkillName.value = skill ? getSkillDisplayName(skill.manifest, skill.id) : skillId
    currentSkillId.value = skillId

    try {
        const response = await apiService.fetchSkillDocumentation(
            skillId,
            activeProjectGroupId.value,
        )
        documentation.value = response.content || t('plugins.skills.docNoContent')
    } catch (err) {
        console.error('获取 Skill 文档失败:', err)
        const errorMsg: string = getErrorMessage(err) || t('plugins.skills.docLoadFailed')
        docError.value = errorMsg
        toast.error(errorMsg)
    } finally {
        loadingDoc.value = false
    }
}

/**
 * 显示安装对话框
 */
function handleShowInstallDialog() {
    showInstallDialog.value = true
    selectedFile.value = null
    forceOverwrite.value = false
}

/**
 * 处理文件选择
 */
function handleNativeFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    selectedFile.value = input.files?.[0] ?? null
}

function triggerFileSelect(): void {
    fileInputRef.value?.click()
}

function handleDrop(e: DragEvent): void {
    const file = e.dataTransfer?.files?.[0]
    if (file) selectedFile.value = file
}

/**
 * 清除选中的文件
 */
function clearSelectedFile() {
    selectedFile.value = null
    forceOverwrite.value = false
    // 重置原生 input（等价原 clearFiles，且天然没有 limit 二次选择拒绝问题）
    if (fileInputRef.value) {
        fileInputRef.value.value = ''
    }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * 安装 Skill
 */
async function handleInstallSkill() {
    if (!selectedFile.value) {
        toast.warning(t('plugins.skills.installSelectWarning'))
        return
    }

    installing.value = true

    try {
        const response = await apiService.installSkill(selectedFile.value, forceOverwrite.value)

        if (response.success) {
            toast.success(response.message || t('common.createSuccess'))
            showInstallDialog.value = false
            selectedFile.value = null
            forceOverwrite.value = false
            // 重新加载列表
            await loadSkills()
        } else {
            toast.error(response.message || t('plugins.skills.installFailed'))
        }
    } catch (err) {
        console.error('安装 Skill 失败:', err)
        toast.error(getErrorMessage(err) || t('plugins.skills.installFailed'))
    } finally {
        installing.value = false
    }
}

/**
 * 卸载 Skill
 */
async function handleUninstallSkill(skillId: string) {
    const ok = await confirm(
        t('plugins.skills.uninstallTitle'),
        t('plugins.skills.uninstallConfirm', { id: skillId }),
        {
            confirmText: t('common.ok'),
            cancelText: t('common.cancel'),
            type: 'warning',
        }
    )
    if (!ok) return

    try {
        uninstallingSkills.value.add(skillId)

        // 带项目作用域：同名时误删全局版本会比「删不掉」更糟
        const response = await apiService.uninstallSkill(skillId, activeProjectGroupId.value)

        if (response.success) {
            toast.success(response.message || t('plugins.skills.uninstallSuccess'))
            // 重新加载列表
            await loadSkills()
        } else {
            toast.error(response.message || t('plugins.skills.uninstallFailed'))
        }
    } catch (err) {
        console.error('卸载 Skill 失败:', err)
        toast.error(getErrorMessage(err) || t('plugins.skills.uninstallFailed'))
    } finally {
        uninstallingSkills.value.delete(skillId)
    }
}

/**
 * 打开 Skills 使用说明文档
 */
function handleOpenSkillsDocs() {
    openInExternalBrowser('https://ai.dingd.cn/docs/skills')
}

// 插件注册/卸载/启停时后端广播 plugins_changed：技能列表按插件启停过滤，
// 这里全量刷新让禁用插件的技能即时消失（与 pluginSlots store 同一事件源）
let offPluginsChanged: (() => void) | null = null

/** 记住上次选的项目：刷新页面/切 tab 回来仍在同一作用域 */
const PROJECT_STORAGE_KEY = 'plugins.skills.projectGroupId'

function readSavedProjectId(): string {
    try {
        return localStorage.getItem(PROJECT_STORAGE_KEY) || ''
    } catch {
        return ''
    }
}

function saveProjectId(id: string) {
    try {
        if (id) localStorage.setItem(PROJECT_STORAGE_KEY, id)
        else localStorage.removeItem(PROJECT_STORAGE_KEY)
    } catch {
        /* 隐私模式等场景忽略：只是偏好，不影响功能 */
    }
}

// 记录每次选择（含回落全局时清空），避免下次进入停留在已失效项目
watch(selectedProjectId, (id) => saveProjectId(id))

onMounted(async () => {
    offPluginsChanged = apiService.onSessionEvent('plugins_changed', () => {
        loadSkills()
    })

    // 恢复上次的项目选择：先拉清单校验（项目可能已被删），再按作用域加载
    const savedId = readSavedProjectId()
    if (savedId) {
        await refreshProjectOptions()
        if (resolveSelectedProject(projectOptions.value, savedId)) {
            selectedProjectId.value = savedId
            await loadSkills()
            return
        }
        // 项目已删除：清掉偏好，回落全局视图
        saveProjectId('')
    }

    await loadSkills()
})

onUnmounted(() => {
    offPluginsChanged?.()
    offPluginsChanged = null
})
</script>

<style scoped>
/* 项目下拉容器：GdSelect 自身是 w-full，宽度必须由外层给 */
.plugins-project-select {
    width: 200px;
    flex: 0 1 auto;
    min-width: 140px;
}

/* 元信息表格样式
   颜色全部取自 markdown token：暗色下变量值本身会翻转，无需再写 .dark 分支 */
.skill-meta-table {
    border-radius: var(--gd-md-radius);
    overflow: hidden;
    border: 1px solid var(--gd-md-border);
    font-size: var(--gd-md-font-size);
}

.skill-meta-table table {
    width: 100%;
    border-collapse: collapse;
}

.skill-meta-table td {
    padding: calc(var(--gd-md-font-size) - 4px) calc(var(--gd-md-font-size) + 6px);
    border-bottom: 1px solid var(--gd-md-divider);
    color: var(--gd-color-text);
}

.skill-meta-table tr:last-child td {
    border-bottom: none;
}

.skill-meta-table .meta-key {
    width: 100px;
    background-color: var(--gd-md-fill-secondary);
    font-weight: 600;
    color: var(--gd-md-text-secondary);
    white-space: nowrap;
}

.skill-meta-table .meta-value {
    word-break: break-word;
}
</style>
