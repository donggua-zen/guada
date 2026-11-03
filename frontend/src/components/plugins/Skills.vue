<template>
    <div class="flex-1 skills-page">
        <!-- 视图条：二级切换 + 当前视图的动作（取代原大标题区与市场自带标题行） -->
        <div class="plugins-view-bar">
            <div class="plugins-view-bar__left">
                <PluginViewSwitch v-model="view" :items="viewItems" />
                <GdTooltip :content="t('plugins.skills.subtitle')" placement="top">
                    <button type="button" class="plugins-view-info" :aria-label="t('plugins.page.info')">
                        <Info24Regular />
                    </button>
                </GdTooltip>
            </div>
            <div class="plugins-view-bar__right">
                <template v-if="view === 'installed'">
                    <GdButton circle :loading="scanning" :title="t('plugins.skills.scan')" @click="handleScan">
                        <template #icon>
                            <ArrowClockwise16Regular />
                        </template>
                    </GdButton>
                    <GdButton type="primary" @click="handleShowInstallDialog">
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
                    <GdButton circle size="small" :title="t('plugins.page.marketOpenWeb')" @click="handleOpenMarketSite">
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
                    <GdButton circle size="small" :title="t('plugins.page.marketOpenWeb')" @click="handleOpenSkillHubSite">
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
            </div>

            <div
                v-if="visibleSkills.length > 0"
                class="-mx-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2"
            >
                <PluginListRow
                    v-for="skill in visibleSkills"
                    :key="skill.id"
                    :name="getSkillDisplayName(skill.manifest, skill.id)"
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
                        <GdTag v-if="skill.origin?.source === 'skillhub'" size="small" type="info" effect="light">{{ t('plugins.skills.originSkillHub') }}</GdTag>
                        <GdTag v-if="skill.manifest.version" type="info" size="small" effect="plain">v{{ skill.manifest.version }}</GdTag>
                    </template>
                    <template #actions>
                        <GdTooltip v-if="skill.provider" :content="t('plugins.skills.pluginManaged')" placement="top">
                            <GdSwitch :model-value="skill.enabled !== false" disabled size="small" />
                        </GdTooltip>
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
                    <div class="text-sm text-gray-500 dark:text-[#8b8d95] mb-4">
                        {{ t('plugins.skills.emptyHint') }}
                    </div>
                    <GdButton type="primary" @click="handleScan" :loading="scanning">
                        <template #icon>
                            <ArrowClockwise16Regular />
                        </template>
                        {{ t('plugins.skills.scanNow') }}
                    </GdButton>
                    <GdButton class="ml-2" @click="view = 'market'">
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
                :local-skills="skills"
                :active="view === 'market'"
                @installed="() => loadSkills()"
            />
        </div>

        <!-- SkillHub 视图：独立第三视图，数据由本机后端代理 -->
        <div v-show="view === 'skillhub'" class="plugins-view-fade">
            <SkillHubMarket
                ref="skillHubRef"
                v-model:keyword="skillhubKeyword"
                :local-skills="skills"
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
import { ref, onMounted, computed } from 'vue'
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
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import { openInExternalBrowser } from '@/utils/browserUtils'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import PluginListRow from './PluginListRow.vue'
import PluginViewSwitch from './PluginViewSwitch.vue'
import SkillMarket from './SkillMarket.vue'
import SkillHubMarket from './SkillHubMarket.vue'
import type { PluginRowMenuItem, PluginViewSwitchItem } from './pluginList.types'
import type { Skill } from '@/types/skills'

const loading = ref(false)
const scanning = ref(false)
const reloadingSkills = ref<Set<string>>(new Set())
const skills = ref<Skill[]>([])
/** 已安装技能按来源分区（插件提供/内置/用户安装/共享/工作区） */
const skillGroups = computed(() => groupSkills(skills.value))
const { t } = useI18n()
const { confirm } = usePopup()

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
    if (!sourceFilter.value) return skills.value
    return skillGroups.value.find(g => g.key === sourceFilter.value)?.items ?? []
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
 * 加载 Skills 列表
 */
async function loadSkills() {
    loading.value = true

    try {
        const response = await apiService.fetchSkills()
        skills.value = Array.isArray(response?.items) ? response.items : []
    } catch (err) {
        console.error('加载 Skills 失败:', err)
        const errorMsg = getErrorMessage(err) || t('plugins.skills.loadFailed')
        toast.error(errorMsg)
        skills.value = []
    } finally {
        loading.value = false
    }
}

/**
 * 触发手动扫描
 */
async function handleToggleSkill(skillId: string, enabled: boolean) {
    const skill = skills.value.find(s => s.id === skillId)
    if (!skill) return

    const previousState = skill.enabled
    // 乐观更新
    skill.enabled = enabled
    updatingSkills.value.add(skillId)

    try {
        if (enabled) {
            await apiService.enableSkill(skillId)
        } else {
            await apiService.disableSkill(skillId)
        }
    } catch (err) {
        // 失败回滚
        skill.enabled = previousState
        console.error('切换技能状态失败:', err)
        toast.error(getErrorMessage(err) || t('plugins.skills.toggleFailed'))
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
 * 触发手动扫描
 */
async function handleScan() {
    scanning.value = true

    try {
        await apiService.scanSkills()
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
 */
async function handleReloadSkill(skillId: string) {
    try {
        reloadingSkills.value.add(skillId)
        await apiService.reloadSkill(skillId)
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
 * 查看 Skill 文档
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
        const response = await apiService.fetchSkillDocumentation(skillId)
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

        const response = await apiService.uninstallSkill(skillId)

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

onMounted(async () => {
    await loadSkills()
})
</script>

<style scoped>
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
