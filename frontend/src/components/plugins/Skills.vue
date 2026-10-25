<template>
    <div class="flex-1 skills-page">
        <!-- 头部区域 -->
        <div class="flex items-center justify-between gap-4 mb-6 mt-2">
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
            <!-- 技能列表 -->
            <div v-if="skills.length > 0" class="grid gap-4"
                style="grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));">
                <PluginListRow
                    v-for="skill in skills"
                    :key="skill.id"
                    :name="skill.manifest.name || skill.id"
                    :description="skill.manifest.description || t('plugins.skills.noDescription')"
                    :muted="skill.enabled === false"
                    :menu-items="getSkillMenuItems(skill)"
                    @click="handleViewDocumentation(skill.id)"
                    @command="(command) => handleSkillCommand(command, skill)"
                >
                    <template #badges>
                        <el-tag v-if="skill.provider" size="small" type="warning" effect="light">{{ t('plugins.skills.fromPlugin') }}</el-tag>
                        <el-tag v-else-if="skill.source === 'system'" size="small" type="success" effect="light">{{ t('plugins.skills.sourceBuiltin') }}</el-tag>
                        <el-tag v-else-if="skill.source === 'agents'" size="small" type="warning" effect="light">{{ t('plugins.skills.sourceShared') }}</el-tag>
                        <el-tag v-if="skill.manifest.version" type="info" size="small" effect="plain">v{{ skill.manifest.version }}</el-tag>
                    </template>
                    <template #actions>
                        <GdTooltip v-if="skill.provider" :content="t('plugins.skills.pluginManaged')" placement="top">
                            <el-switch :model-value="skill.enabled !== false" disabled size="small" />
                        </GdTooltip>
                        <el-switch
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
            <div v-if="!loading && skills.length === 0"
                class="rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) overflow-hidden bg-(--gd-color-surface)">
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

        <!-- 技能市场（独立组件：搜索/标签筛选/分页/安装） -->
        <SkillMarket :local-skills="skills" @installed="() => loadSkills()" />

        <!-- 查看文档对话框 -->
        <GdDialog v-model="showDocDialog" :title="currentSkillName + ' - SKILL.md'" size="lg"
            align-center destroy-on-close append-to-body>

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
                <MarkdownContent class="markdown-text" :content="bodyContent" />
            </div>
            <template #footer>
                <el-button @click="showDocDialog = false">{{ t('common.close') }}</el-button>
            </template>
        </GdDialog>

        <!-- 安装 Skill 对话框 -->
        <GdDialog v-model="showInstallDialog" :title="t('plugins.skills.installTitle')" size="sm" align-center destroy-on-close>
            <div class="py-4">
                <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
                    {{ t('plugins.skills.installDesc') }}
                </div>

                <el-upload ref="uploadRef" class="upload-demo" drag :auto-upload="false" :show-file-list="false" :on-change="handleFileChange"
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
        </GdDialog>

    </div>
</template>
<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElButton, ElTag, ElIcon, ElUpload, ElSwitch } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { RefreshOutlined, InboxOutlined, UploadOutlined } from '@vicons/material'
import { Loading, UploadFilled, Document, Close } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import { openInExternalBrowser } from '@/utils/browserUtils'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import GdDialog from '@/components/ui/GdDialog.vue'
import PluginListRow from './PluginListRow.vue'
import SkillMarket from './SkillMarket.vue'
import type { PluginRowMenuItem } from './pluginList.types'
import type { Skill } from '@/types/skills'

const loading = ref(false)
const scanning = ref(false)
const reloadingSkills = ref<Set<string>>(new Set())
const skills = ref<Skill[]>([])
const { t } = useI18n()
const { confirm } = usePopup()

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
const uploadRef = ref()
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
    } catch (err) {
        // 失败回滚
        skill.enabled = previousState
        console.error('切换技能状态失败:', err)
        ElMessage.error(getErrorMessage(err) || t('plugins.skills.toggleFailed'))
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
        ElMessage.success(t('plugins.skills.scanSuccess'))
        // 扫描后重新加载列表
        await loadSkills()
    } catch (err) {
        console.error('扫描 Skills 失败:', err)
        const errorMsg = getErrorMessage(err) || t('plugins.skills.scanFailed')
        ElMessage.error(errorMsg)
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
        ElMessage.success(t('plugins.skills.reloadSuccess'))
        // 重载后重新加载列表
        await loadSkills()
    } catch (err) {
        console.error('重载 Skill 失败:', err)
        const errorMsg = getErrorMessage(err) || t('plugins.skills.reloadFailed')
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
    } catch (err) {
        console.error('获取 Skill 文档失败:', err)
        const errorMsg: string = getErrorMessage(err) || t('plugins.skills.docLoadFailed')
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
function handleFileChange(file: UploadFile) {
    selectedFile.value = file.raw ?? null
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
    } catch (err) {
        console.error('安装 Skill 失败:', err)
        ElMessage.error(getErrorMessage(err) || t('plugins.skills.installFailed'))
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
            ElMessage.success(response.message || t('plugins.skills.uninstallSuccess'))
            // 重新加载列表
            await loadSkills()
        } else {
            ElMessage.error(response.message || t('plugins.skills.uninstallFailed'))
        }
    } catch (err) {
        console.error('卸载 Skill 失败:', err)
        ElMessage.error(getErrorMessage(err) || t('plugins.skills.uninstallFailed'))
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

/* All tags: flat gray style, no colored borders */
.skills-page :deep(.el-tag) {
    background-color: #f0f0f2;
    border: none;
    color: #6b6d75;
    font-size: calc(var(--gd-size-text-base) - 3px);
}
html.dark .skills-page :deep(.el-tag) {
    background-color: #2a2a2e;
    color: #8b8d95;
}
</style>
