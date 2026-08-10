<template>
    <div class="flex-1 skills-page">
        <!-- 头部区域 -->
        <div class="flex items-center justify-between gap-4 mb-8 mt-2">
            <div class="min-w-0">
                <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('plugins.skills.title') }}</h1>
                <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('plugins.skills.subtitle') }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <el-button @click="handleShowInstallDialog">
                    <template #icon>
                        <UploadOutlined />
                    </template>
                    {{ t('plugins.skills.install') }}
                </el-button>
                <el-button v-if="loading" :loading="true" size="small">
                    {{ t('common.loading') }}
                </el-button>
                <el-button @click="handleScan" :loading="scanning">
                    <template #icon>
                        <RefreshOutlined />
                    </template>
                    {{ t('plugins.skills.scan') }}
                </el-button>
                <el-button @click="handleOpenSkillsDocs">
                    <template #icon>
                        <Document />
                    </template>
                    {{ t('plugins.skills.docs') }}
                </el-button>
            </div>
        </div>

        <!-- Skills 列表 -->
        <div class="space-y-4">
            <!-- 技能卡片列表 -->
            <div class="grid gap-y-4 gap-x-3" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
                <div v-for="skill in skills" :key="skill.id"
                    class="plugin-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
                    :style="skill.enabled === false ? { opacity: 0.6 } : {}"
                    @click="handleViewDocumentation(skill.id)">
                    <div class="flex items-center gap-2.5 mb-3">
                        <CardAvatar :name="skill.manifest.name || skill.id" :disabled="skill.enabled === false" />
                        <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);">
                            {{ skill.manifest.name || skill.id }}
                        </h3>
                        <el-tag v-if="skill.source === 'system'" size="small" type="success" effect="light">{{ t('plugins.skills.sourceBuiltin') }}</el-tag>
                        <el-tag v-else-if="skill.source === 'agents'" size="small" type="warning" effect="light">{{ t('plugins.skills.sourceShared') }}</el-tag>
                        <el-tag v-if="skill.manifest.version" type="info" size="small" effect="plain">v{{ skill.manifest.version }}</el-tag>
                    </div>

                    <p class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
                    {{ skill.manifest.description || t('plugins.skills.noDescription') }}
                    </p>

                    <div class="flex items-center justify-end gap-2 mt-3">
                        <el-button link size="small" @click.stop="handleReloadSkill(skill.id)"
                            :loading="reloadingSkills.has(skill.id)">
                            {{ t('plugins.skills.reload') }}
                        </el-button>
                        <el-button v-if="skill.source !== 'system' && skill.source !== 'agents'" link size="small" type="danger"
                            @click.stop="handleUninstallSkill(skill.id)"
                            :loading="uninstallingSkills.has(skill.id)">
                            {{ t('plugins.skills.uninstall') }}
                        </el-button>
                        <LTooltip v-else-if="skill.source === 'agents'" :content="t('plugins.skills.sharedTooltip')" placement="top">
                            <el-button link size="small" type="danger" disabled>
                                {{ t('plugins.skills.uninstall') }}
                            </el-button>
                        </LTooltip>
                        <el-switch
                            :model-value="skill.enabled !== false"
                            :loading="updatingSkills.has(skill.id)"
                            @update:model-value="(val: string | number | boolean) => handleToggleSkill(skill.id, !!val)"
                            @click.stop
                            size="small"
                            inline-prompt
                            :active-text="t('common.enable')"
                            :inactive-text="t('common.disable')"
                        />
                    </div>
                </div>
            </div>

            <!-- 空状态 -->
            <div v-if="!loading && skills.length === 0"
                class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) overflow-hidden bg-(--color-surface)">
                <div class="p-12 text-center">
                    <el-icon size="64" class="mb-4 opacity-50 text-gray-400">
                        <InboxOutlined />
                    </el-icon>
                    <div class="text-xl font-medium text-gray-600 dark:text-[#e8e9ed] mb-2">
                        {{ t('plugins.skills.empty') }}
                    </div>
                    <div class="text-sm text-gray-500 dark:text-[#8b8d95] mb-4">
                        {{ t('plugins.skills.emptyHint') }}
                    </div>
                    <el-button type="primary" @click="handleScan" :loading="scanning">
                        <template #icon>
                            <RefreshOutlined />
                        </template>
                        {{ t('plugins.skills.scanNow') }}
                    </el-button>
                </div>
            </div>
        </div>

        <!-- 技能市场推荐 -->
        <div class="mt-8">
            <div class="sessions-header py-1 text-lg font-semibold flex items-center gap-3 mb-4">
                <span>{{ t('plugins.skills.marketTitle') }}</span>
                <el-button link size="small" :loading="loadingMarket" @click="() => loadMarketSkills(true)">
                    <template #icon>
                        <el-icon :class="{ 'is-loading': loadingMarket }">
                            <ArrowClockwise16Regular />
                        </el-icon>
                    </template>
                    {{ loadingMarket ? t('common.loading') : t('plugins.skills.marketRefresh') }}
                </el-button>
            </div>

            <!-- 错误提示 -->
            <div v-if="marketError"
                class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) p-6 text-center">
                <el-icon size="32" class="mb-2 opacity-50 text-gray-400">
                    <InboxOutlined />
                </el-icon>
                <div class="text-sm text-gray-500 dark:text-[#8b8d95]">
                    {{ marketError }}
                </div>
            </div>

            <!-- 推荐列表 -->
            <div v-else-if="marketSkills.length > 0" class="grid gap-3"
                style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
                <div v-for="skill in marketSkills" :key="skill.id"
                    class="plugin-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
                    @click="handleShowMarketInstallDialog(skill)">
                    <div class="flex items-center gap-2.5 mb-3">
                        <CardAvatar :name="skill.name" />
                        <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);">
                            {{ skill.name }}
                        </h3>
                        <el-tag v-if="skill.localStatus === 'installed'" type="success" size="small" effect="plain">{{ t('plugins.skills.marketInstalled') }}</el-tag>
                        <el-tag v-else-if="skill.localStatus === 'updatable'" type="warning" size="small" effect="plain">{{ t('plugins.skills.marketUpdatable') }}</el-tag>
                    </div>

                    <p class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
                    {{ skill.description || t('plugins.skills.noDescription') }}
                    </p>

                    <div class="flex items-center justify-between gap-2 mt-3">
                        <div class="flex flex-wrap gap-1 min-w-0 overflow-hidden">
                            <el-tag v-if="skill.labels && skill.labels.length > 0" v-for="label in skill.labels"
                                :key="label" size="small" effect="light">
                                {{ label }}
                            </el-tag>
                        </div>
                        <el-button link size="small" shrink-0
                            :type="skill.localStatus === 'updatable' ? 'warning' : 'primary'"
                            @click.stop="handleShowMarketInstallDialog(skill)">
                            {{ installingFromMarket.has(skill.id) ? t('plugins.skills.marketInstalling') : getMarketButtonLabel(skill) }}
                        </el-button>
                    </div>
                </div>
            </div>

            <!-- 底部提示 -->
            <div class="mt-6 text-center text-sm text-gray-500 dark:text-[#8b8d95]">
                访问<span class="text-blue-500 cursor-pointer hover:underline" @click="openInExternalBrowser('https://ai.dingd.cn/skills')">{{ t('plugins.skills.marketLink') }}</span>获取更多推荐技能
            </div>
        </div>

        <!-- 查看文档对话框 -->
        <el-dialog v-model="showDocDialog" :title="currentSkillName + ' - SKILL.md'" width="800px"
            :style="{ maxWidth: '90vw' }" align-center destroy-on-close>

            <div v-if="loadingDoc" class="flex justify-center items-center py-12">
                <el-icon class="is-loading" size="32">
                    <Loading />
                </el-icon>
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
                <div class="markdown-doc prose dark:prose-invert max-w-none" v-html="parsedDocumentation">
                </div>
            </div>
            <template #footer>
                <el-button @click="showDocDialog = false">{{ t('common.close') }}</el-button>
            </template>
        </el-dialog>

        <!-- 安装 Skill 对话框 -->
        <el-dialog v-model="showInstallDialog" :title="t('plugins.skills.installTitle')" width="500px" align-center destroy-on-close>
            <div class="py-4">
                <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                    {{ t('plugins.skills.installDesc') }}
                </div>

                <el-upload ref="uploadRef" class="upload-demo" drag :auto-upload="false" :on-change="handleFileChange"
                    :limit="1" accept=".zip">
                    <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                    <div class="el-upload__text">
                        {{ t('plugins.skills.uploadText') }} <em>{{ t('plugins.skills.uploadClick') }}</em>
                    </div>
                    <template #tip>
                        <div class="el-upload__tip text-xs text-gray-500 mt-2">
                            {{ t('plugins.skills.uploadTip') }}
                        </div>
                    </template>
                </el-upload>

                <div v-if="selectedFile" class="mt-4 p-3 bg-gray-50 dark:bg-[#2a2c30] rounded-lg">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <el-icon>
                                <Document />
                            </el-icon>
                            <span class="text-sm">{{ selectedFile.name }}</span>
                        </div>
                        <el-button link type="danger" @click="clearSelectedFile">
                            <el-icon>
                                <Close />
                            </el-icon>
                        </el-button>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        {{ t('plugins.skills.fileSize', { size: formatFileSize(selectedFile.size) }) }}
                    </div>
                </div>

                <div class="mt-4">
                    <el-checkbox v-model="forceOverwrite">
                        <span class="text-sm">{{ t('plugins.skills.forceOverwrite') }}</span>
                    </el-checkbox>
                    <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1 ml-6">
                        {{ t('plugins.skills.forceOverwriteHint') }}
                    </div>
                </div>
            </div>

            <template #footer>
                <el-button @click="showInstallDialog = false">{{ t('common.cancel') }}</el-button>
                <el-button type="primary" @click="handleInstallSkill" :loading="installing" :disabled="!selectedFile">
                    {{ t('plugins.skills.installBtn') }}
                </el-button>
            </template>
        </el-dialog>

        <!-- 市场技能安装对话框 -->
        <el-dialog v-model="showMarketInstallDialog" :title="t('plugins.skills.marketInstallTitle')" width="420px" align-center destroy-on-close>
            <div v-if="selectedMarketSkill" class="py-2">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-[#e8e9ed] mb-2">
                    {{ selectedMarketSkill.name }}
                </h3>
                <p class="text-sm text-gray-600 dark:text-[#8b8d95] mb-3">
                    {{ selectedMarketSkill.description || t('plugins.skills.noDescription') }}
                </p>
                <div v-if="selectedMarketSkill.labels && selectedMarketSkill.labels.length > 0" class="flex flex-wrap gap-1.5 mb-4">
                    <el-tag v-for="label in selectedMarketSkill.labels" :key="label" size="small" effect="light">
                        {{ label }}
                    </el-tag>
                </div>
                <div class="flex flex-col gap-3 market-install-actions">
                    <!-- 直接安装（ZIP） -->
                    <el-button v-if="getInstallUrl(selectedMarketSkill, 'zip')" type="primary" size="large"
                        :loading="installingFromMarket.has(selectedMarketSkill.id)"
                        @click="handleInstallFromMarketUrl(selectedMarketSkill)">
                        <template #icon>
                            <ArrowDownload16Regular />
                        </template>
                        {{ getMarketButtonLabel(selectedMarketSkill) }}
                    </el-button>
                    <!-- 访问仓库（Git） -->
                    <el-button v-if="getInstallUrl(selectedMarketSkill, 'git')" size="large"
                        @click="handleViewSourceCode(selectedMarketSkill)">
                        {{ t('plugins.skills.marketViewSource') }}
                    </el-button>
                    <!-- 查看详情 -->
                    <el-button v-if="selectedMarketSkill.detailUrl" size="large"
                        @click="handleOpenDetailUrl(selectedMarketSkill)">
                        {{ t('plugins.skills.marketViewDetail') }}
                    </el-button>
                </div>
            </div>
            <template #footer>
                <el-button @click="showMarketInstallDialog = false">{{ t('common.cancel') }}</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElButton, ElTag, ElIcon, ElDialog, ElUpload, ElMessageBox } from 'element-plus'
import { RefreshOutlined, InboxOutlined, DescriptionOutlined, UploadOutlined, DeleteOutlined } from '@vicons/material'
import { RefreshRight, Loading, UploadFilled, Document, Close } from '@element-plus/icons-vue'
import { ArrowDownload16Regular, ArrowClockwise16Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import { SkillMarketService, type MarketSkill, type MarketSkillWithStatus } from '@/services/SkillMarketService'
import { useMarkdown } from '@/composables/useMarkdown'
import { openInExternalBrowser } from '@/utils/browserUtils'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import LTooltip from '@/components/ui/LTooltip.vue'

interface SkillManifest {
    name: string
    description?: string
    version?: string
    author?: string
    tags?: string[]
}

type SkillSource = 'global' | 'system' | 'agents'

interface Skill {
    id: string
    basePath: string
    manifest: SkillManifest
    contentHash: string
    source?: SkillSource
    enabled?: boolean
}

const loading = ref(false)
const scanning = ref(false)
const reloadingSkills = ref<Set<string>>(new Set())
const skills = ref<Skill[]>([])
const { t } = useI18n()

// 文档查看相关状态
const showDocDialog = ref(false)
const loadingDoc = ref(false)
const docError = ref<string | null>(null)
const documentation = ref('')
const currentSkillName = ref('')
const currentSkillId = ref('')

// Markdown 解析
const { parseMarkdown } = useMarkdown()

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

const parsedDocumentation = computed(() => {
    return parseMarkdown(bodyContent.value)
})

// 安装相关状态
const showInstallDialog = ref(false)
const installing = ref(false)
const selectedFile = ref<File | null>(null)
const uploadRef = ref()
const forceOverwrite = ref(false)

// 卸载相关状态
const uninstallingSkills = ref<Set<string>>(new Set())
const updatingSkills = ref<Set<string>>(new Set())

// 市场推荐相关状态
const marketSkills = ref<MarketSkillWithStatus[]>([])
const loadingMarket = ref(false)
const marketError = ref<string | null>(null)

// 市场安装弹窗相关状态
const showMarketInstallDialog = ref(false)
const selectedMarketSkill = ref<MarketSkillWithStatus | null>(null)
const installingFromMarket = ref<Set<string>>(new Set())

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

    try {
        const response = await apiService.installSkillFromUrl(zipUrl)
        if (response.success) {
            ElMessage.success(response.message || t('common.createSuccess'))
            showMarketInstallDialog.value = false
            selectedMarketSkill.value = null
            // 刷新本地技能列表
            await loadSkills()
        } else {
            ElMessage.error(response.message || '安装失败')
        }
    } catch (err: any) {
        console.error('从市场安装技能失败:', err)
        ElMessage.error(err.message || t('plugins.skills.installFailed'))
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
 * 更新所有市场技能的状态（与本地已安装技能做名字匹配）
 */
function refreshMarketSkillStatus() {
    const localSkills = skills.value
    marketSkills.value = marketSkills.value.map(marketSkill => {
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

/**
 * 加载 Skills 列表
 */
async function loadSkills() {
    loading.value = true

    try {
        const response = await apiService.fetchSkills()
        skills.value = Array.isArray(response?.items) ? response.items : []
        // 加载后刷新市场技能状态
        refreshMarketSkillStatus()
    } catch (err: any) {
        console.error('加载 Skills 失败:', err)
        const errorMsg = err.message || t('plugins.skills.loadFailed')
        ElMessage.error(errorMsg)
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
    } catch (err: any) {
        // 失败回滚
        skill.enabled = previousState
        console.error('切换技能状态失败:', err)
        ElMessage.error(err.message || t('plugins.skills.toggleFailed'))
    } finally {
        updatingSkills.value.delete(skillId)
    }
}

/**
 * 触发手动扫描
 */
async function handleScan() {
    scanning.value = true

    try {
        await apiService.scanSkills()
        ElMessage.success(t('plugins.skills.scanSuccess'))
        // 扫描后重新加载列表
        await loadSkills()
    } catch (err: any) {
        console.error('扫描 Skills 失败:', err)
        const errorMsg = err.message || t('plugins.skills.scanFailed')
        ElMessage.error(errorMsg)
    } finally {
        scanning.value = false
    }
}

/**
 * 重载指定 Skill
 */
async function handleReloadSkill(skillId: string) {
    const previousState = reloadingSkills.value.has(skillId)

    try {
        reloadingSkills.value.add(skillId)
        await apiService.reloadSkill(skillId)
        ElMessage.success(t('plugins.skills.reloadSuccess'))
        // 重载后重新加载列表
        await loadSkills()
    } catch (err: any) {
        console.error('重载 Skill 失败:', err)
        const errorMsg = err.message || t('plugins.skills.reloadFailed')
        ElMessage.error(errorMsg)
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

    // 获取 skill 名称用于标题
    const skill = skills.value.find(s => s.id === skillId)
    currentSkillName.value = skill?.manifest.name || skillId
    currentSkillId.value = skillId

    try {
        const response = await apiService.fetchSkillDocumentation(skillId)
        documentation.value = response.content || t('plugins.skills.docNoContent')
    } catch (err: any) {
        console.error('获取 Skill 文档失败:', err)
        const errorMsg: string = err.message || t('plugins.skills.docLoadFailed')
        docError.value = errorMsg
        ElMessage.error(errorMsg)
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
function handleFileChange(file: any) {
    selectedFile.value = file.raw
}

/**
 * 清除选中的文件
 */
function clearSelectedFile() {
    selectedFile.value = null
    forceOverwrite.value = false
    if (uploadRef.value) {
        uploadRef.value.clearFiles()
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
        ElMessage.warning(t('plugins.skills.installSelectWarning'))
        return
    }

    installing.value = true

    try {
        const response = await apiService.installSkill(selectedFile.value, forceOverwrite.value)

        if (response.success) {
            ElMessage.success(response.message || t('common.createSuccess'))
            showInstallDialog.value = false
            selectedFile.value = null
            forceOverwrite.value = false
            // 重新加载列表
            await loadSkills()
        } else {
            ElMessage.error(response.message || t('plugins.skills.installFailed'))
        }
    } catch (err: any) {
        console.error('安装 Skill 失败:', err)
        ElMessage.error(err.message || t('plugins.skills.installFailed'))
    } finally {
        installing.value = false
    }
}

/**
 * 卸载 Skill
 */
async function handleUninstallSkill(skillId: string) {
    try {
        // 确认卸载
        await new Promise<void>((resolve, reject) => {
            ElMessageBox.confirm(
                t('plugins.skills.uninstallConfirm', { id: skillId }),
                t('plugins.skills.uninstallTitle'),
                {
                    confirmButtonText: t('common.ok'),
                    cancelButtonText: t('common.cancel'),
                    type: 'warning',
                }
            ).then(() => resolve()).catch(() => reject())
        })

        uninstallingSkills.value.add(skillId)

        const response = await apiService.uninstallSkill(skillId)

        if (response.success) {
            ElMessage.success(response.message || t('plugins.skills.uninstallSuccess'))
            // 重新加载列表
            await loadSkills()
        } else {
            ElMessage.error(response.message || t('plugins.skills.uninstallFailed'))
        }
    } catch (err: any) {
        if (err !== 'cancel' && err !== 'close') {
            console.error('卸载 Skill 失败:', err)
            ElMessage.error(err.message || t('plugins.skills.uninstallFailed'))
        }
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

/**
 * 加载市场推荐技能列表
 * @param forceRefresh 是否强制刷新（来自用户手动点击"换一批"）
 */
async function loadMarketSkills(forceRefresh: boolean = false) {
    if (loadingMarket.value) return

    loadingMarket.value = true
    marketError.value = null

    const startTime = Date.now()

    try {
        const remoteSkills = await SkillMarketService.fetchMarketSkills(!forceRefresh)

        // 仅手动刷新时确保至少显示 500ms 的加载动画
        if (forceRefresh) {
            const elapsed = Date.now() - startTime
            if (elapsed < 500) {
                await new Promise(resolve => setTimeout(resolve, 500 - elapsed))
            }
        }

        marketSkills.value = remoteSkills.map(skill => ({
            ...skill,
            localStatus: 'not_installed' as const,
        }))
        // 与本地技能做名字匹配，更新状态
        refreshMarketSkillStatus()
    } catch (err: any) {
        console.error('加载市场技能失败:', err)
        marketError.value = err.message || t('plugins.skills.marketError')
    } finally {
        loadingMarket.value = false
    }
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

onMounted(async () => {
    await loadSkills()
    await loadMarketSkills()
})
</script>

<style scoped>
@import "@/assets/markdown.css";

/* 市场安装弹窗中按钮垂直排列，取消 Element Plus 默认水平按钮间距 */
.market-install-actions :deep(.el-button + .el-button) {
    margin-left: 0;
}


/* 代码块容器 */
.markdown-doc :deep(.custom-code-block) {
    margin-bottom: 1em;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e3e3e7;
}

.dark .markdown-doc :deep(.custom-code-block) {
    border-color: #333;
}

/* 代码块头部 */
.markdown-doc :deep(.code-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 12px;
    background: #f3f3f5;
    color: #222;
    font-size: 0.8em;
    border-bottom: 1px solid #e3e3e7;
}

.dark .markdown-doc :deep(.code-header) {
    background: #2a2c30;
    color: #e8e9ed;
    border-color: #333;
}

.markdown-doc :deep(.code-language) {
    font-weight: 600;
    text-transform: uppercase;
    color: #666;
}

.dark .markdown-doc :deep(.code-language) {
    color: #8b8d95;
}

/* 代码块内容 */
.markdown-doc :deep(pre.hljs) {
    margin: 0;
    border-radius: 0;
    background: #fafafb !important;
    padding: 16px;
    overflow-x: auto;
}

.dark .markdown-doc :deep(pre.hljs) {
    background: #1a1c20 !important;
}

.markdown-doc :deep(code.hljs) {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.875em;
    background: transparent !important;
    display: block;
    overflow-x: auto;
}

/* 行内代码 */
.markdown-doc :deep(:not(pre) > code) {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.875em;
    background-color: #f0f0f0;
    padding: 2px 6px;
    border-radius: 4px;
    color: #e83e8c;
}

.dark .markdown-doc :deep(:not(pre) > code) {
    background-color: #2a2c30;
    color: #ff7b72;
}

.markdown-doc :deep(p) {
    margin-bottom: 1em;
    line-height: 1.6;
}

.markdown-doc :deep(h1),
.markdown-doc :deep(h2),
.markdown-doc :deep(h3),
.markdown-doc :deep(h4) {
    margin-top: 1.5em;
    margin-bottom: 0.75em;
    font-weight: 600;
}

.markdown-doc :deep(ul),
.markdown-doc :deep(ol) {
    margin-bottom: 1em;
    padding-left: 1.5em;
}

.markdown-doc :deep(li) {
    margin-bottom: 0.25em;
}

.markdown-doc :deep(blockquote) {
    border-left: 4px solid #ddd;
    padding-left: 1em;
    color: #666;
    margin-bottom: 1em;
}

.dark .markdown-doc :deep(blockquote) {
    border-left-color: #444;
    color: #999;
}

.markdown-doc :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
}

.markdown-doc :deep(th),
.markdown-doc :deep(td) {
    border: 1px solid #ddd;
    padding: 8px 12px;
    text-align: left;
}

.dark .markdown-doc :deep(th),
.dark .markdown-doc :deep(td) {
    border-color: #444;
}

.markdown-doc :deep(th) {
    background-color: #f6f8fa;
    font-weight: 600;
}

.dark .markdown-doc :deep(th) {
    background-color: #2a2c30;
}

/* 元信息表格样式 */
.skill-meta-table {
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e3e3e7;
}

.dark .skill-meta-table {
    border-color: #333;
}

.skill-meta-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
}

.skill-meta-table td {
    padding: 10px 14px;
    border-bottom: 1px solid #e3e3e7;
}

.dark .skill-meta-table td {
    border-color: #333;
}

.skill-meta-table tr:last-child td {
    border-bottom: none;
}

.skill-meta-table .meta-key {
    width: 100px;
    background-color: #f6f8fa;
    font-weight: 600;
    color: #444;
    white-space: nowrap;
}

.dark .skill-meta-table .meta-key {
    background-color: #2a2c30;
    color: #b0b2b8;
}

.skill-meta-table .meta-value {
    color: #333;
    word-break: break-word;
}

.dark .skill-meta-table .meta-value {
    color: #e8e9ed;
}

/* All tags: flat gray style, no colored borders */
.skills-page :deep(.el-tag) {
    background-color: #f0f0f2;
    border: none;
    color: #6b6d75;
    font-size: calc(var(--size-text-base) - 3px);
}
html.dark .skills-page :deep(.el-tag) {
    background-color: #2a2a2e;
    color: #8b8d95;
}
</style>
