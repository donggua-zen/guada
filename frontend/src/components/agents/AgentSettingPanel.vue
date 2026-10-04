<template>
  <div class="agent-setting-panel-root h-full" v-loading="pageLoading" :element-loading-text="t('agents.setting.loading')">
    <div class="flex h-full overflow-hidden">
      <!-- 侧边栏 -->
      <div class="w-40 shrink-0 overflow-y-auto py-3">
        <div v-for="group in sidebarGroups" :key="group.label" class="mb-2">
          <div class="px-2 pt-2 pb-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            {{ group.label }}
          </div>
          <div class="pr-2 space-y-1">
            <div v-for="item in group.items" :key="item.path" @click="tabsValue = item.path"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200"
              :class="tabsValue === item.path
                ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
                : 'text-(--gd-color-text) hover:bg-(--gd-color-sidebar-bg-hover) hover:text-(--gd-color-sidebar-text-hover)'">
              <el-icon :size="16">
                <component :is="item.icon" />
              </el-icon>
              <span class="text-sm font-medium">{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 内容区：横向内边距放在各 tab 的滚动容器上，滚动条才会贴外边界 -->
      <div class="flex-1 overflow-hidden flex flex-col">
        <!-- 基础设置 -->
        <div v-show="tabsValue === 'basic'" class="flex-1 overflow-hidden">
          <div class="h-full overflow-y-auto px-4 py-4">
            <el-form ref="basicFormRef" :model="agentForm" :rules="basicRules" label-position="top">
              <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                <!-- 头像设置 -->
                <el-form-item prop="avatarUrl" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('agents.setting.avatarTitle') }} <span class="text-xs text-gray-400">{{ t('agents.setting.avatarOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('agents.setting.avatarHint') }}</span>
                    </div>
                    <AvatarPreview :src="agentForm.avatarUrl" type="assistant" class="w-10"
                      :name="agentForm.name" @avatar-changed="handleAvatarChanged" />
                  </div>
                </el-form-item>
                <!-- 智能体名称 -->
                <el-form-item prop="name" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('agents.setting.titleLabel') }}</span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('agents.setting.titleHint') }}</span>
                    </div>
                    <div class="w-1/2 flex justify-end">
                      <el-input v-model="agentForm.name" :placeholder="t('agents.setting.titlePlaceholder')" class="w-full" />
                    </div>
                  </div>
                </el-form-item>
                <!-- 智能体描述 -->
                <el-form-item prop="description" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('agents.setting.descLabel') }} <span class="text-xs text-gray-400">{{ t('agents.setting.descOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('agents.setting.descHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-input v-model="agentForm.description" type="textarea" :placeholder="t('agents.setting.descPlaceholder')"
                        :autosize="{ minRows: 3, maxRows: 5 }" class="w-full" />
                    </div>
                  </div>
                </el-form-item>
                <!-- 标识符（目录名即 id）：新建时可自定义，编辑时只读 -->
                <el-form-item prop="id" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">
                        {{ t('agents.setting.idLabel') }}
                        <span v-if="props.isNew" class="text-xs text-gray-400">{{ t('agents.setting.idOptional') }}</span>
                      </span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                        {{ props.isNew ? t('agents.setting.idCreateHint') : t('agents.setting.idHint') }}
                      </span>
                    </div>
                    <div class="w-1/2">
                      <el-input v-model="agentForm.id" :readonly="!props.isNew"
                        :placeholder="t('agents.setting.idPlaceholder')" class="w-full font-mono" />
                    </div>
                  </div>
                </el-form-item>
              </div>

              <!-- 模型选择 -->
              <div class="mt-3 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                <el-form-item prop="modelId" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('agents.setting.modelLabel') }} <span class="text-xs text-gray-400">{{ t('agents.setting.modelOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('agents.setting.modelHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-select v-model="agentForm.modelId" :options="modelOptions" :placeholder="t('agents.setting.modelPlaceholder')" clearable
                        class="w-full" />
                    </div>
                  </div>
                </el-form-item>
              </div>

              <!-- 记忆与压缩 -->
              <div class="mt-3 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                <!-- 压缩策略档位（档位同时决定触发时机/保留比例/摘要方式） -->
                <el-form-item prop="compressionTier" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('agents.setting.compressionTier') }}</span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('agents.setting.compressionTierHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-select v-model="agentForm.compressionTier" :placeholder="t('agents.setting.compressionTierPlaceholder')" class="w-full">
                        <el-option v-for="opt in COMPRESSION_TIER_OPTIONS" :key="opt.value" :label="t(opt.labelKey)" :value="opt.value">
                          <span class="flex items-center gap-2">
                            <span>{{ t(opt.descKey) }}</span>
                          </span>
                        </el-option>
                      </el-select>
                    </div>
                  </div>
                </el-form-item>
              </div>

              <el-alert :title="t('agents.setting.tipTitle')" type="info" :closable="false" show-icon style="margin-top: 16px;">
                <p class="text-sm">{{ t('agents.setting.tip1') }}</p>
                <p class="text-sm">{{ t('agents.setting.tip2') }}</p>
                <p class="text-sm">{{ t('agents.setting.tip3') }}</p>
              </el-alert>
            </el-form>
          </div>
        </div>

        <!-- 提示词：外层负责滚动，内层至少铺满高度（内容超出时改为滚动而非裁切）；
             顶部内边距按左导航的首行对齐收窄，避免上方大片留白 -->
        <div v-show="tabsValue === 'prompt'" class="flex-1 overflow-y-auto">
          <div class="px-4 pt-2 pb-6 min-h-full flex flex-col">
            <div class="px-0 flex-1 flex flex-col min-h-0">
              <el-form ref="promptFormRef" :model="agentForm" :rules="promptRules" label-position="top"
                label-width="80px" size="large" class="flex-1 flex flex-col min-h-0">
                <el-form-item :show-label="false" :show-feedback="false" style="flex-shrink: 0;" class="no-border-item">
                  <div class="flex items-center w-full justify-between">
                    <span>{{ t('agents.setting.systemPromptLabel') }}</span>
                  </div>
                </el-form-item>

                <!-- 详细设定 -->
                <el-form-item prop="systemPrompt" :show-label="false"
                  class="flex-1 min-h-40 prompt-form-item no-border-item">
                  <el-input v-model="agentForm.systemPrompt" type="textarea" :placeholder="t('agents.setting.systemPromptPlaceholder')" resize="none" />
                </el-form-item>

              </el-form>
            </div>
          </div>
        </div>

        <!-- 本地工具 -->
        <div v-show="tabsValue === 'local_tools'" class="flex-1 overflow-hidden">
          <div class="px-4 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- 全部禁用与白名单模式 同一行左对齐 + 右对齐 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allDisabled" @update:model-value="(v) => handleAllDisabledToggle(!v)" />
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allDisabled }]">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.newPluginLabel') }}</span>
                      <SegmentedToggle v-model="allowlistMode" :options="autoEnableOptions" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="visibleLocalTools.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('agents.setting.noLocalTools') }}</div>
                  <div class="text-sm mt-2">{{ t('agents.setting.noLocalToolsHint') }}</div>
                </div>

                <div v-else class="grid gap-2"
                  style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));"
                  :class="{ 'opacity-50 pointer-events-none': allDisabled }">
                  <!-- 扁平工具包卡片网格：不按插件分组，右下角标注来源插件 -->
                  <div v-for="card in visibleKitCards" :key="card.key"
                    class="tool-item p-2.5 rounded-xl transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] bg-gray-50/60 dark:bg-[#242629]/60">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <div class="font-medium text-sm flex-1 truncate text-gray-800 dark:text-gray-200">{{ card.kit.name || card.kit.id }}</div>
                      <el-switch :model-value="isKitEnabled(card.pluginId, card.kit.id)"
                        @update:model-value="(val) => handleKitToggle(card.pluginId, card.kit.id, !!val)"
                        :disabled="allDisabled" size="small" inline-prompt />
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">
                      {{ card.kit.description || t('agents.setting.noDescription') }}
                    </p>
                    <!-- 底部：左侧工具/提示词统计，右侧来源插件 -->
                    <div class="flex items-center justify-between mt-1.5 text-xs text-gray-400">
                      <div class="flex items-center gap-3">
                        <span class="flex items-center gap-1">
                          <el-icon :size="13"><Wrench16Regular /></el-icon>
                          {{ card.kit.toolCount ?? 0 }}
                        </span>
                        <span class="flex items-center gap-1">
                          <el-icon :size="13"><TextDescription20Regular /></el-icon>
                          {{ card.kit.promptCount ?? 0 }}
                        </span>
                      </div>
                      <span class="truncate ml-2">{{ t('agents.setting.kitSource', { plugin: card.pluginName }) }}</span>
                    </div>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </div>

        <!-- MCP 工具 -->
        <div v-show="tabsValue === 'mcp_tools'" class="flex-1 overflow-hidden">
          <div class="px-4 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- MCP 全部禁用与白名单模式 同一行 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allMcpDisabled" @update:model-value="(v) => handleAllMcpDisabledToggle(!v)" />
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allMcpDisabled }]">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.newMcpLabel') }}</span>
                      <SegmentedToggle :model-value="mcpAllowlistMode" :options="autoEnableOptions"
                        @update:model-value="handleMcpAllowlistModeChange" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="mcpServers.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('agents.setting.noMcpServers') }}</div>
                </div>

                <div v-else>
                  <div v-for="server in mcpServers" :key="server.id"
                    class="mcp-server-item p-2.5 rounded-xl mb-2 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                    :class="{ 'opacity-50': allMcpDisabled }">
                    <div class="flex items-start justify-between">
                      <div class="flex-1 mr-4">
                        <div class="font-medium text-base mb-1 text-gray-800 dark:text-gray-200">
                          {{ server.name }}
                          <el-tag v-if="server.enabled" type="success" size="small" class="ml-2">
                            {{ t('agents.setting.mcpRunning') }}
                          </el-tag>
                          <el-tag v-else type="info" size="small" class="ml-2">
                            {{ t('agents.setting.mcpNotRunning') }}
                          </el-tag>
                        </div>
                        <div v-if="server.description" class="text-sm text-gray-600 line-clamp-2">
                          {{ server.description }}
                        </div>
                        <div v-if="server.tools && Object.keys(server.tools).length > 0"
                          class="text-sm text-gray-500 mt-2">
                          {{ t('agents.setting.availableTools', { count: Object.keys(server.tools).length }) }}
                        </div>
                      </div>

                      <!-- 启用/禁用开关 -->
                      <el-switch :model-value="isMcpServerEnabled(server.id)"
                        @update:model-value="(val) => handleMcpServerToggle(server.id, !!val)"
                        :disabled="allMcpDisabled" />
                    </div>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </div>

        <!-- Skills 技能 -->
        <div v-show="tabsValue === 'skills'" class="flex-1 overflow-hidden">
          <div class="px-4 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- Skills 全部禁用与白名单模式 同一行 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allSkillsDisabled" @update:model-value="(v) => handleAllSkillsDisabledToggle(!v)" />
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allSkillsDisabled }]">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.newSkillLabel') }}</span>
                      <SegmentedToggle v-model="skillsAllowlistMode" :options="autoEnableOptions" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="loadingSkills" class="text-center py-8">
                  <el-icon class="is-loading" size="24">
                    <LoadingOutlined />
                  </el-icon>
                  <div class="text-sm text-gray-500 mt-2">{{ t('agents.setting.loadingSkills') }}</div>
                </div>

                <div v-else-if="visibleSkills.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('agents.setting.noSkills') }}</div>
                  <div class="text-sm mt-2">{{ t('agents.setting.noSkillsHint') }}</div>
                </div>

                <div v-else class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
                  <div v-for="skill in visibleSkills" :key="skill.id"
                    class="skill-item p-2.5 rounded-xl transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                    :class="{ 'opacity-50 pointer-events-none': allSkillsDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="font-medium text-sm flex-1 truncate text-gray-800 dark:text-gray-200">{{ skill.manifest?.name || skill.id }}</div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <el-switch :model-value="getSkillEffectiveEnabled(skill)"
                          :loading="updatingSkills.has(skill.id)"
                          @update:model-value="(val) => handleSkillToggle(skill.id, !!val)" :disabled="allSkillsDisabled"
                          size="small" inline-prompt :active-text="t('common.enable')" :inactive-text="t('common.disable')" />
                        <el-tag v-if="skill.source === 'system'" type="success" size="small" effect="light">{{ t('agents.setting.sourceBuiltin') }}</el-tag>
                        <el-tag v-if="skill.manifest?.version" type="info" size="small" effect="plain">v{{
                          skill.manifest.version }}</el-tag>
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{{ skill.manifest?.description || t('agents.setting.noDescription')
                      }}</p>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </div>

        <!-- 子代理 -->
        <div v-show="tabsValue === 'agent_presets'" class="flex-1 overflow-hidden">
          <div class="px-4 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- 全部禁用与白名单模式 同一行 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('agents.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allAgentsDisabled" @update:model-value="(v) => handleAllAgentsDisabledToggle(!v)" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="loadingAgents" class="text-center py-8">
                  <el-icon class="is-loading" size="24">
                    <LoadingOutlined />
                  </el-icon>
                  <div class="text-sm text-gray-500 mt-2">{{ t('agents.setting.loadingAgents') }}</div>
                </div>

                <div v-else-if="presetAgents.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('agents.setting.noAgents') }}</div>
                  <div class="text-sm mt-2">{{ t('agents.setting.noAgentsHint') }}</div>
                </div>

                <div v-else class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
                  <div v-for="char in presetAgents" :key="char.id"
                    class="agent-item p-2.5 rounded-xl transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                    :class="{ 'opacity-50 pointer-events-none': allAgentsDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <div class="font-medium text-sm flex-1 truncate text-gray-800 dark:text-gray-200">{{ char.name }}</div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <el-switch :model-value="getAgentEffectiveEnabled(char)"
                          @update:model-value="(val) => handleAgentToggle(char.id, !!val)" :disabled="allAgentsDisabled"
                          size="small" inline-prompt :active-text="t('common.enable')" :inactive-text="t('common.disable')" />
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{{ char.description || t('agents.setting.noDescription') }}</p>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getLocale } from '@/locales'
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElSelect,
  ElInputNumber,
  ElTooltip,
  ElCheckbox,
  ElIcon,
  ElButton,
  ElAlert,
  ElTag,
  ElCheckboxGroup,
  ElSwitch
} from 'element-plus'
import {
  InfoCircleOutlined,
  LoadingOutlined,
  UserOutlined,
  MessageOutlined,
  ToolOutlined,
  ApiOutlined
} from '@vicons/antd'

import { Code24Regular, Bot24Regular, Wrench16Regular, TextDescription20Regular } from '@vicons/fluent'

import { apiService } from '../../services/ApiService'
import type { Model, ModelProvider, McpServer } from '@/types/api'
import type { FormInstance } from 'element-plus'
import type { CompressionTier } from '@/constants'

import { usePopup } from '../../composables/usePopup'
import AvatarPreview from '../ui/AvatarPreview.vue'
import SegmentedToggle from '../ui/SegmentedToggle.vue'
import { DEFAULT_COMPRESSION_TIER, COMPRESSION_TIER_OPTIONS } from '@/constants'
import {
  buildPluginConfig,
  effectiveKitEnabled,
  parseAllAgentsDisabled,
  parseAllSkillsDisabled,
  parseMcpGate,
  parsePluginConfig,
  splitUnrendered,
  type ParsedPluginConfig,
  type UnrenderedRefs,
} from '../../utils/agentPluginConfig'

const { toast } = usePopup()
const { t } = useI18n()

// 工具栏目"全部禁用/自定义"分段按钮选项
const autoEnableOptions = computed(() => [
  { label: t('agents.setting.autoEnable'), value: false },
  { label: t('agents.setting.keepDisabled'), value: true }
])

// Props
const props = defineProps({
  simple: {
    type: Boolean,
    default: false
  },
  data: {
    type: Object,
    default: () => ({
      id: '',
      name: '',
      description: '',
      avatarUrl: '',
      settings: {
        assistantName: '',
        assistantIdentity: '',
        systemPrompt: '',
        modelId: '',
        memoryType: null
      }
    })
  },
  tab: {
    type: String,
    default: 'basic'
  },
  isNew: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['update:data', 'update:tab', 'saved'])

// 响应式数据
const pageLoading = ref(false)

// 模型数据
const models = ref<Model[]>([]);
const providers = ref<ModelProvider[]>([]);

// 表单引用
const basicFormRef = ref<FormInstance | null>(null)
const promptFormRef = ref<FormInstance | null>(null)

const tabsValue = ref(props.tab)

// 初始表单数据对照（用于检测是否有未保存的变更）
// 在 loadAllData 全部就绪后记录
// 必须用 ref，否则 hasChanges computed 无法追踪变化
const _initialFormData = ref<Record<string, unknown> | null>(null)

// 深度比较两个值（忽略对象 key 顺序）
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    const ka = Object.keys(ra), kb = Object.keys(rb)
    if (ka.length !== kb.length) return false
    return ka.every(k => k in rb && deepEqual(ra[k], rb[k]))
  }
  return a === b
}

// 侧边栏分组
const sidebarGroups = computed(() => [
  {
    label: t('agents.setting.groupBasic'),
    items: [
      { label: t('agents.setting.navBasic'), path: 'basic', icon: UserOutlined },
      { label: t('agents.setting.navPrompt'), path: 'prompt', icon: MessageOutlined },
    ]
  },
  {
    label: t('agents.setting.groupTools'),
    items: [
      { label: t('agents.setting.navLocalTools'), path: 'local_tools', icon: ToolOutlined },
      { label: t('agents.setting.navMcpTools'), path: 'mcp_tools', icon: ApiOutlined },
      { label: t('agents.setting.navSkills'), path: 'skills', icon: Code24Regular },
      { label: t('agents.setting.navSubAgents'), path: 'agent_presets', icon: Bot24Regular },
    ]
  }
])

// 表单数据
interface AgentFormData {
  id: string
  name: string
  description: string
  avatarUrl: string
  avatarFile: File | null
  assistantName: string
  assistantIdentity: string
  systemPrompt: string
  modelId: string | null
  memoryType: string
  /** 按智能体启用的技能 { skillId: true/false } */
  enabledSkills: Record<string, boolean>
  compressionTier: CompressionTier
}

const agentForm = reactive<AgentFormData>({
  id: '',
  name: '',
  description: '',
  avatarUrl: '',
  avatarFile: null,
  assistantName: '',
  assistantIdentity: '',
  systemPrompt: '',
  modelId: null,
  memoryType: '',
  enabledSkills: {},
  compressionTier: DEFAULT_COMPRESSION_TIER,
})

// 验证规则
const basicRules = computed(() => ({
  name: [
    { required: true, message: t('agents.setting.titleRequired'), trigger: ['input', 'blur'] },
    { min: 2, max: 20, message: t('agents.setting.titleLength'), trigger: ['input', 'blur'] }
  ],
  // 标识符（id）：可留空（后端按 name 派生，非 ASCII 名则随机兜底）；
  // 一旦填写必须是 ASCII slug —— 禁止中文，否则跨平台会有目录名风险
  id: [
    {
      validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
        if (!value) return callback()
        return /^[a-z0-9][a-z0-9-]*$/.test(value)
          ? callback()
          : callback(new Error(t('agents.setting.idInvalid')))
      },
      trigger: ['input', 'blur']
    }
  ]
}))

const promptRules = {}

// 选项数据
// const modelOptions = [
//     { label: '默认/不设置', value: '' },
//     { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
//     { label: 'GPT-4', value: 'gpt-4' },
//     { label: 'Claude 2', value: 'claude-2' },
//     { label: 'Llama 2', value: 'llama-2' }
// ]

// 模型选择选项（按供应商分组）
const modelOptions = computed(() => {
  if (!models.value.length || !providers.value.length) return []

  const options = []

  // 添加"使用默认模型"选项
  options.push({
    label: t('agents.setting.modelUseDefault'),
    value: '',
    key: 'default'
  })

  providers.value?.forEach(provider => {
    // 获取该供应商下的text类型模型
    const providerModels = models.value.filter(model =>
      model.providerId === provider.id && model.modelType === 'text'
    )

    if (providerModels.length > 0) {
      // 添加分组标签
      options.push({
        label: provider.name,
        value: provider.id,
        key: provider.id,
        disabled: true,
      })

      // 添加该分组下的模型选项
      providerModels.forEach(model => {
        options.push({
          label: model.modelName,
          value: model.id,
          key: model.id
        })
      })
    }
  })
  return options
})

// MCP 禁用列表（不在列表中的 MCP 服务器默认启用）
const mcpDeniedServers = ref<string[]>([]);

// MCP 服务器数据
const mcpServers = ref<McpServer[]>([]);

// Skills 数据（面板仅消费 id/enabled/source/manifest，最小结构即可）
interface SkillListItem {
  id: string
  enabled?: boolean
  source?: string
  manifest?: { name?: string; version?: string; description?: string }
}
const skillsList = ref<SkillListItem[]>([]);
const loadingSkills = ref(false);
const updatingSkills = ref(new Set<string>());

// 本地工具数据（queryPlugins 返回的插件条目，仅消费插件与工具包标识字段）
interface ToolkitInfo {
  id: string
  name?: string
  description?: string
  enabled?: boolean
  toolCount?: number
  promptCount?: number
}
interface LocalToolPlugin {
  pluginId: string
  displayName?: string
  enabled: boolean
  toolkits: ToolkitInfo[]
}
const localTools = ref<LocalToolPlugin[]>([]);

// 卡片展示列表：只显示有工具包的插件（无能力包的插件不受智能体层控制，不在此显示）
const visibleLocalTools = computed(() =>
  localTools.value.filter(t => Array.isArray(t.toolkits) && t.toolkits.length > 0),
);

// 扁平化的工具包卡片列表（不按插件分组），每项携带来源插件信息
const visibleKitCards = computed(() =>
  visibleLocalTools.value.flatMap(tool =>
    tool.toolkits.map(kit => ({
      key: `${tool.pluginId}::${kit.id}`,
      pluginId: tool.pluginId,
      pluginName: tool.displayName || tool.pluginId,
      kit,
    })),
  ),
);

// 智能体能力包设置（key = `${pluginId}::${kitId}` -> boolean）
const agentToolSettings = ref<Record<string, boolean>>({});

// 已保存的智能体插件配置（解析后），作为工具包开关的默认来源
const parsedPluginConfig = ref<ParsedPluginConfig>({
  allDisabled: false,
  allowlistMode: false,
  perPlugin: {},
});
// 当前工具列表中渲染不到的已保存条目：保存时原样透传，避免一次保存丢配置
const unrenderedRefs = ref<UnrenderedRefs>({ whole: {}, partial: {} });

// 是否全部禁用本地工具
const allDisabled = ref(false);
// 是否白名单模式（新插件默认不启用）
const allowlistMode = ref(false);
// 是否全部禁用 MCP
const allMcpDisabled = ref(false);
// MCP 白名单模式（新服务器默认不开启）
const mcpAllowlistMode = ref(false);
// MCP 白名单列表（允许的服务器 ID）
const mcpAllowlistServers = ref<string[]>([]);
// 是否全部禁用 Skills
const allSkillsDisabled = ref(false);
// Skills 白名单模式（新技能默认不开启）
const skillsAllowlistMode = ref(false);
// 通用子代理（虚拟智能体，不出现在智能体列表中）
const GENERIC_AGENT = computed(() => ({
  id: 'generic',
  name: t('agents.setting.genericAgentTitle'),
  description: t('agents.setting.genericAgentDesc'),
}));
// 是否全部禁用子代理
const allAgentsDisabled = ref(false);
// 智能体偏好 { agentId: true/false }
const enabledAgents = reactive<Record<string, boolean>>({});
// 子代理列表（排除当前智能体，含虚拟通用子代理；通用项仅携带 id/name/description）
interface PresetAgent {
  id: string
  name?: string
  description?: string | null
}
const presetAgents = ref<PresetAgent[]>([]);
const loadingAgents = ref(false);




// 能力包 key 构造
const kitKey = (pluginId: string, kitId: string) => `${pluginId}::${kitId}`;

// 判断某个能力包是否启用（用于 Switch 显示）
const isKitEnabled = (pluginId: string, kitId: string) => {
  const key = kitKey(pluginId, kitId);
  if (key in agentToolSettings.value) return agentToolSettings.value[key];
  // 未初始化时回退到查询结果（已含智能体配置的生效状态）
  const tool = localTools.value.find(t => t.pluginId === pluginId);
  const kit = tool?.toolkits?.find(k => k.id === kitId);
  return kit ? !!kit.enabled : false;
};

// 能力包开关切换
const handleKitToggle = (pluginId: string, kitId: string, enabled: boolean) => {
  // 从全部禁用模式切回正常模式
  if (allDisabled.value) allDisabled.value = false;
  agentToolSettings.value = {
    ...agentToolSettings.value,
    [kitKey(pluginId, kitId)]: enabled,
  };
};

// 计算技能的最终显示状态（不受模式影响，始终 = 用户显式值 → 全局继承）
const getSkillEffectiveEnabled = (skill: SkillListItem) => {
  if (skill.id in agentForm.enabledSkills) {
    return agentForm.enabledSkills[skill.id];
  }
  return skill.enabled !== false;
};

// 智能体面板可见的技能
const visibleSkills = computed(() => {
  // 强制追踪模式切换依赖，确保技能列表随白名单/黑名单切换重渲染
  void skillsAllowlistMode.value;
  // 全部禁用模式下仍然展示所有技能（灰色不可操作状态）
  return skillsList.value.filter(skill => {
      // 全局禁用的技能，仅当智能体显式启用时显示
      if (skill.enabled === false) {
        return agentForm.enabledSkills[skill.id] === true;
      }
    return true;
  });
});

// 判断 MCP 服务器是否启用（根据当前模式）
const isMcpServerEnabled = (serverId: string) => {
  if (mcpAllowlistMode.value) {
    // 白名单：在白名单列表中才显示启用
    return mcpAllowlistServers.value.includes(serverId);
  }
  // 黑名单：不在拒绝列表中才显示启用
  return !mcpDeniedServers.value.includes(serverId);
};

// 监听 props.data 变化
watch(() => props.data, (newVal, oldVal) => {
  // 检测是否是智能体切换（id 变化）或初始化
  const isAgentSwitch = !agentForm.id || (newVal.id && newVal.id !== agentForm.id);

  if (isAgentSwitch) {
    agentForm.avatarFile = null;
  }

  agentForm.id = newVal.id || '';
  agentForm.name = newVal.name || '';
  agentForm.description = newVal.description || '';
  agentForm.avatarUrl = newVal.avatarUrl || '';
  agentForm.modelId = newVal.modelId || '';

  agentForm.assistantName = newVal.settings?.assistantName || '';
  agentForm.assistantIdentity = newVal.settings?.assistantIdentity || '';
  agentForm.systemPrompt = newVal.settings?.systemPrompt || '';
  agentForm.memoryType = newVal.settings?.memoryType || 'sliding_window';

  // 从 memory 分组加载压缩档位（旧自由比例/摘要模式读时映射：disabled→off，其余→默认档）
  const memoryConfig = newVal.settings?.memory || {};
  agentForm.compressionTier = memoryConfig.compressionTier
    ?? (memoryConfig.summaryMode === 'disabled' ? 'off' : undefined)
    ?? DEFAULT_COMPRESSION_TIER;
  // 加载智能体插件设置（新格式：工具包粒度，仅消费 __strategy/__default/toolkits_*）
  // 旧版插件级开关条目（{ pluginId: { enabled } } / 裸布尔）直接忽略
  parsedPluginConfig.value = parsePluginConfig(newVal.settings?.plugins);
  allDisabled.value = parsedPluginConfig.value.allDisabled;
  allowlistMode.value = parsedPluginConfig.value.allowlistMode;

  // 加载 MCP 配置（工具包粒度：每个 server 即 mcp 插件的一个能力包）
  const mcpGate = parseMcpGate(newVal.settings?.plugins);
  mcpDeniedServers.value = mcpGate.deniedServers;
  mcpAllowlistServers.value = mcpGate.allowlistServers;
  mcpAllowlistMode.value = mcpGate.allowlistMode;
  // 全部禁用标记：白名单过滤但允许列表为空（拒绝全部 MCP 能力包）
  allMcpDisabled.value = mcpGate.allDisabled;

  // 加载智能体技能偏好
  // 全部禁用：skill 插件的能力包被整体拒绝（allow 过滤 + 空允许列表）
  allSkillsDisabled.value = parseAllSkillsDisabled(newVal.settings?.plugins);
  // 白名单模式：从 skills.__default 读取
  const skillsConfig = newVal.settings?.skills;
  skillsAllowlistMode.value = skillsConfig?.__default === false;
  // 单项偏好：从 skills 读取（过滤 __default 系统字段）
  if (typeof skillsConfig === 'object' && !Array.isArray(skillsConfig)) {
    agentForm.enabledSkills = {};
    for (const [skillId, val] of Object.entries(skillsConfig)) {
      if (skillId === '__default') continue;
      agentForm.enabledSkills[skillId] = val as boolean;
    }
  } else {
    agentForm.enabledSkills = {};
  }

  // 加载子代理偏好（固定白名单语义：仅显式允许 subagent 能力包时启用）
  // 默认禁用：无配置时 allAgentsDisabled = true
  allAgentsDisabled.value = parseAllAgentsDisabled(newVal.settings?.plugins);
  const agentsConfig = newVal.settings?.agents;
  // 重建 enabledAgents
  for (const key of Object.keys(enabledAgents)) delete enabledAgents[key];
  if (typeof agentsConfig === 'object' && !Array.isArray(agentsConfig)) {
    for (const [key, val] of Object.entries(agentsConfig)) {
      if (key === '__default' || key.startsWith('__')) continue;
      enabledAgents[key] = val as boolean;
    }
  }

  // 首次加载（新建或真实数据到达）→ 触发统一数据加载
  if (props.isNew || (newVal?.id && !oldVal?.id)) {
    loadAllData();
  }

}, { immediate: true })

const handleAvatarChanged = (file: File) => {
  agentForm.avatarFile = file
}

// MCP 服务器开关切换处理（根据当前模式决定存到拒绝列表或允许列表）
const handleMcpServerToggle = (serverId: string, enabled: boolean) => {
  if (mcpAllowlistMode.value) {
    // 白名单：启用时加入允许列表，禁用时移出
    const index = mcpAllowlistServers.value.indexOf(serverId);
    if (enabled && index === -1) {
      mcpAllowlistServers.value.push(serverId);
    } else if (!enabled && index !== -1) {
      mcpAllowlistServers.value.splice(index, 1);
    }
  } else {
    // 黑名单：禁用时加入拒绝列表，启用时移出
    const index = mcpDeniedServers.value.indexOf(serverId);
    if (!enabled && index === -1) {
      mcpDeniedServers.value.push(serverId);
    } else if (enabled && index !== -1) {
      mcpDeniedServers.value.splice(index, 1);
    }
  }
}

// ── Skills 切换 ──
const handleSkillToggle = (skillId: string, enabled: boolean) => {
  agentForm.enabledSkills[skillId] = enabled;
  agentForm.enabledSkills = { ...agentForm.enabledSkills };
};

// ── 子代理 ──
const getAgentEffectiveEnabled = (char: PresetAgent) => {
  return enabledAgents[char.id] ?? false;
};
const handleAgentToggle = (charId: string, enabled: boolean) => {
  enabledAgents[charId] = enabled;
};
const handleAllAgentsDisabledToggle = async (val: boolean) => {
  allAgentsDisabled.value = val;
};
const loadPresetAgents = async () => {
  loadingAgents.value = true;
  try {
    const response = await apiService.fetchAgents();
    const allChars = response.items || [];
    // 排除当前正在编辑的智能体，并在列表开头插入虚拟通用子代理
    presetAgents.value = [
      GENERIC_AGENT.value,
      ...allChars.filter(c => c.id !== agentForm.id),
    ];
  } catch (err) {
    console.error('加载子代理失败:', err);
  } finally {
    loadingAgents.value = false;
  }
};

// 统一加载所有异步数据（并行请求，全部就绪后记录初始快照）
async function loadAllData() {
  pageLoading.value = true
  try {
    const [modelsResp, mcpsResp, skillsResp, charsResp] = await Promise.all([
      apiService.fetchModels(),
      apiService.getMcpServers(),
      apiService.fetchSkills(),
      apiService.fetchAgents(),
      loadLocalTools(),
    ])

    // 模型
    models.value = []
    providers.value = []
    modelsResp.items.forEach((provider) => {
      models.value.push(...(provider.models ?? []))
      delete provider.models
      providers.value.push(provider)
    })

    // MCP 服务器
    mcpServers.value = mcpsResp.items.filter((s) => s.enabled)

    // Skills
    skillsList.value = Array.isArray(skillsResp?.items)
      ? skillsResp.items.filter((s: any) => s.enabled !== false)
      : []
    if (skillsAllowlistMode.value) {
      for (const skill of skillsList.value) {
        if (!(skill.id in agentForm.enabledSkills)) {
          agentForm.enabledSkills[skill.id] = false
        }
      }
    }

    // 子代理列表（排除当前智能体 + 通用虚拟子代理）
    const allChars = charsResp.items || []
    presetAgents.value = [
      GENERIC_AGENT.value,
      ...allChars.filter((c) => c.id !== agentForm.id),
    ]

    // 所有数据就绪后记录初始快照
    _initialFormData.value = getFormData()
  } catch (err) {
    console.error('加载智能体设置数据失败', err)
  } finally {
    pageLoading.value = false
  }
}

// 智能体切换时刷新子代理列表
watch(() => agentForm.id, () => {
  if (agentForm.id) {
    loadPresetAgents();
  }
})

// 全部禁用开关切换处理
const handleAllDisabledToggle = async (val: boolean) => {
  allDisabled.value = val;
  await loadLocalTools();
};

const handleAllMcpDisabledToggle = async (val: boolean) => {
  allMcpDisabled.value = val;
  await loadMCPServers();
};

const handleAllSkillsDisabledToggle = async (val: boolean) => {
  allSkillsDisabled.value = val;
};

// 工具包粒度状态 → 查询/保存用的条目
function buildKitEntries() {
  const denyByPlugin: Record<string, string[]> = {};
  const allowByPlugin: Record<string, string[]> = {};
  for (const [key, enabled] of Object.entries(agentToolSettings.value)) {
    const idx = key.indexOf('::');
    if (idx === -1) continue;
    const pluginId = key.slice(0, idx);
    const kitId = key.slice(idx + 2);
    if (allowlistMode.value) {
      // 白名单：只收集显式开启的能力包
      if (enabled) (allowByPlugin[pluginId] ||= []).push(kitId);
    } else {
      // 黑名单：只收集显式关闭的能力包
      if (!enabled) (denyByPlugin[pluginId] ||= []).push(kitId);
    }
  }
  return { denyByPlugin, allowByPlugin };
}

// 根据查询结果初始化各能力包开关的显示状态（保留已有偏好）
//
// 默认来源是**已保存的智能体配置**（parsedPluginConfig），而不是查询返回的 tk.enabled：
// 后者的 query 载荷是由当前 UI 状态构造的，拿它当默认值会形成循环依赖，
// 导致首屏永远显示"全开"、已保存的关闭项被忽略。
// 同时把当前列表里渲染不到的已保存条目收进 unrenderedRefs，供保存时原样透传。
function initKitSettings(stored: Record<string, boolean> = {}) {
  const next: Record<string, boolean> = {};
  const renderableKitsByPlugin: Record<string, string[]> = {};
  for (const p of localTools.value) {
    renderableKitsByPlugin[p.pluginId] ||= [];
    for (const tk of p.toolkits || []) {
      const key = kitKey(p.pluginId, tk.id);
      renderableKitsByPlugin[p.pluginId].push(tk.id);
      next[key] = key in stored
        ? stored[key]
        : effectiveKitEnabled(parsedPluginConfig.value, p.pluginId, tk.id);
    }
  }
  agentToolSettings.value = next;
  unrenderedRefs.value = splitUnrendered(
    parsedPluginConfig.value,
    renderableKitsByPlugin,
  );
}

// 加载本地工具列表
async function loadLocalTools() {
  try {
    const stored = { ...agentToolSettings.value };
    // 根据当前 UI 状态动态构建查询配置（工具包粒度预览）
    if (!allDisabled.value) {
      const queryConfig: Record<string, unknown> = {
        __strategy: 'custom',
        __default: allowlistMode.value ? false : true,
      };
      const { denyByPlugin, allowByPlugin } = buildKitEntries();
      for (const [pid, list] of Object.entries(allowByPlugin)) {
        queryConfig[pid] = { toolkits_filter: 'allow', toolkits_allow: list };
      }
      for (const [pid, list] of Object.entries(denyByPlugin)) {
        queryConfig[pid] = { toolkits_deny: list };
      }

      const response = await apiService.queryPlugins(queryConfig, getLocale());

      const plugins: LocalToolPlugin[] = response.plugins || [];
      // 本地工具列表：后端已过滤 system 插件；此处只保留全局启用的插件
      // （全局关闭的插件其工具包对智能体层不可见，二级过滤）
      localTools.value = plugins.filter(p => p.enabled);
      initKitSettings(stored);
    } else {
      // 全部禁用：仅传 strategy，由后端拒绝所有非受保护插件的能力包
      const response = await apiService.queryPlugins({
        __strategy: 'deny_nonsystem',
      }, getLocale());

      const plugins: LocalToolPlugin[] = response.plugins || [];
      // 全部禁用模式下仍只展示全局启用的插件（全局关闭的插件工具包不可见）
      localTools.value = plugins.filter(p => p.enabled);
      initKitSettings(stored);
    }
  } catch (error) {
    console.error('加载本地工具失败:', error);
    toast.error(t('agents.setting.loadLocalToolsFailed'));
  }
}

const loadMCPServers = async () => {
  try {
    const response = await apiService.getMcpServers()
    // 只显示已启动的服务器
    mcpServers.value = response.items.filter(server => server.enabled)
  } catch (error) {
    console.error('获取 MCP 服务器列表失败:', error)
  }
}

// MCP 白名单模式切换（仅由用户点击触发）
//
// 迁移逻辑刻意放在显式 handler 而非 watch：watch 会被回读赋值（props.data 变化时
// 从配置重建 mcpAllowlistMode）触发，从而把刚解析出的 toolkits_allow 放大成"全部服务器"，
// 切黑名单方向则会被改写成"拒绝全部"。
const handleMcpAllowlistModeChange = (newMode: string | number | boolean) => {
  mcpAllowlistMode.value = !!newMode;
  if (mcpServers.value.length === 0) return;
  if (newMode) {
    // 切换为白名单：当前启用中的服务器变为允许列表
    mcpAllowlistServers.value = mcpServers.value
      .filter(s => !mcpDeniedServers.value.includes(s.id))
      .map(s => s.id);
    mcpDeniedServers.value = [];
  } else {
    // 切换为黑名单：当前禁用中的服务器变为拒绝列表
    mcpDeniedServers.value = mcpServers.value
      .filter(s => !mcpAllowlistServers.value.includes(s.id))
      .map(s => s.id);
    mcpAllowlistServers.value = [];
  }
};

// localTools 加载完成后，自定义模式下初始化能力包开关
watch(localTools, (tools) => {
  if (!allDisabled.value && tools.length > 0) {
    initKitSettings({ ...agentToolSettings.value });
  }
});

// 监听白名单模式切换 → 按新模式重算未显式设置过的能力包默认值
watch(allowlistMode, () => {
  if (allDisabled.value || localTools.value.length === 0) return;
  initKitSettings({ ...agentToolSettings.value });
});

// 生命周期
onMounted(async () => {
  // 首次挂载时，所有异步数据由 props.data watch 统一触发 loadAllData
})

onUnmounted(() => {
  // window.removeEventListener('resize', updateDrawerWidth)
  if (agentForm.avatarUrl && agentForm.avatarUrl.startsWith('blob:')) {
    URL.revokeObjectURL(agentForm.avatarUrl);
  }
})



// 获取表单数据
const getFormData = () => {
  let finalData = {
    // 新建时生效（编辑由 updateAgent 处理，忽略 id）；留空则后端按 name 派生或随机兜底
    'id': agentForm.id || undefined,
    'name': agentForm.name,
    'description': agentForm.description,
    'avatarUrl': agentForm.avatarUrl,
    'avatarFile': agentForm.avatarFile,
    'modelId': agentForm.modelId === '' ? null : agentForm.modelId,
    'settings': {
      'assistantName': agentForm.assistantName,
      'assistantIdentity': agentForm.assistantIdentity,
      'systemPrompt': agentForm.systemPrompt,
      'memoryType': agentForm.memoryType,
      // 记忆与压缩配置分组（档位）
      'memory': {
        'compressionTier': agentForm.compressionTier,
      },
      // 插件配置（工具包/能力包粒度）
      // 组装抽到纯函数（utils/agentPluginConfig）里：往返等价性必须可单测，
      // 一次保存丢条目就等于智能体层门控静默变化
      'plugins': buildPluginConfig({
        allDisabled: allDisabled.value,
        allowlistMode: allowlistMode.value,
        renderableKits: (() => {
          const byPlugin: Record<string, Array<{ kitId: string; enabled: boolean }>> = {};
          for (const p of localTools.value) {
            for (const tk of p.toolkits || []) {
              (byPlugin[p.pluginId] ||= []).push({
                kitId: tk.id,
                enabled: !!agentToolSettings.value[kitKey(p.pluginId, tk.id)],
              });
            }
          }
          return byPlugin;
        })(),
        unrendered: unrenderedRefs.value,
        mcp: {
          allDisabled: allMcpDisabled.value,
          allowlistMode: mcpAllowlistMode.value,
          deniedServers: mcpDeniedServers.value,
          allowlistServers: mcpAllowlistServers.value,
        },
        allSkillsDisabled: allSkillsDisabled.value,
        allAgentsDisabled: allAgentsDisabled.value,
      }),
      // Skills 单项偏好（按模式保存）
      'skills': (() => {
        // 遍历所有技能，按当前显示状态保存
        const skillsOut: Record<string, any> = {};
        for (const skill of skillsList.value) {
          const effectiveEnabled = getSkillEffectiveEnabled(skill);
          if (skillsAllowlistMode.value) {
            // 白名单：当前显示为 ON 的全部存 true
            if (effectiveEnabled) skillsOut[skill.id] = true;
          } else {
            // 黑名单：当前显示为 OFF 的全部存 false
            if (!effectiveEnabled) skillsOut[skill.id] = false;
          }
        }
        if (skillsAllowlistMode.value) {
          skillsOut.__default = false;
        }
        return Object.keys(skillsOut).length > 0 ? skillsOut : undefined;
      })(),
      // 子代理配置（固定白名单：仅存显式 true）
      'agents': (() => {
        const agentsOut: Record<string, any> = {};
        for (const char of presetAgents.value) {
          if (getAgentEffectiveEnabled(char)) {
            agentsOut[char.id] = true;
          }
        }
        agentsOut.__default = false;
        return Object.keys(agentsOut).length > 1 ? agentsOut : undefined;
      })(),
    }
  }
  return finalData;
}

// 验证所有表单
const validate = async () => {
  try {
    var formValidates = [
      basicFormRef.value?.validate(),
      promptFormRef.value?.validate(),
    ]
    const validationResults = await Promise.allSettled(formValidates)
    const hasError = validationResults.some(result => result.status === 'rejected')

    if (hasError) {
      const firstErrorIndex = validationResults.findIndex(result => result.status === 'rejected')
      if (firstErrorIndex !== -1) {
        const tabNames = ['basic', 'prompt']
        tabsValue.value = tabNames[firstErrorIndex]
      }
      return false;
    }
    return true;
  } catch (errors) {
    console.error('Validation error:', errors);
    return false;
  }
}

// 清除头像文件（上传成功后由父组件调用）
const clearAvatarFile = () => {
  agentForm.avatarFile = null;
}

// 检测表单是否有未保存的变更
const hasChanges = computed(() => {
  if (!_initialFormData.value) return true
  const current = getFormData()
  return !deepEqual(current, _initialFormData.value)
})

// 暴露方法给父组件
defineExpose({
  clearAvatarFile,
  validate,
  getFormData,
  hasChanges
})

// 移除不再需要的 parse 和 format 方法（已删除 max_memory_tokens 和 short_term_memory_tokens）
</script>

<style scoped>
.avatar-upload-container {
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 100%;
}

.avatar-upload-actions {
  display: flex;
  gap: 10px;
}

.avatar-preview {
  width: 100px;
  height: 100px;
}

.modal-body {
  height: 400px;
}

.tool-item {
  transition: all 0.2s;
}

.skill-item {
  transition: all 0.2s;
}

/* 工具配置对话框样式 */
.tool-config-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
}

.tool-config-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  transition: all 0.2s;
  overflow: hidden;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.tool-config-item:hover {
  border-color: var(--el-color-primary-light-5);
  background-color: var(--el-fill-color-lighter);
}

.tool-config-item :deep(.el-checkbox__label) {
  width: 100%;
  overflow: hidden;
}

.tool-config-item :deep(.el-checkbox) {
  width: 100%;
}

/* 强制工具描述文本换行 */
.tool-config-item :deep(*) {
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
  word-break: break-word !important;
}

/* 工具配置对话框样式已迁移到 GdDialog scoped styles */

.mcp-server-item {
  transition: all 0.2s;
}

.tool-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.tool-checkbox-item {
  display: block;
}

.tool-name {
  font-size: 13px;
  padding: 8px 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
  transition: all 0.2s;
}

.tool-checkbox-item :deep(.el-checkbox__input) {
  position: absolute;
  left: -9999px;
}

.tool-checkbox-item.is-checked .tool-name {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary);
}

/* 表单区域优化 */
:deep(.el-form) {
  height: 100%;
}


/* 提示词输入框样式 - 禁止resize并占满flex空间（高度下限由模板的 min-h-40 提供） */
.prompt-form-item {
  display: flex;
  flex-direction: column;
}

.prompt-form-item :deep(.el-form-item__content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.prompt-form-item :deep(.el-textarea) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.prompt-form-item :deep(textarea) {
  resize: none !important;
  flex: 1;
  min-height: 0;
}

.prompt-form-item :deep(.el-textarea__inner) {
  resize: none !important;
  height: 100% !important;
  min-height: unset !important;
}

/* 无横线表单项 */
.no-border-item {
  border-bottom: none !important;
  padding-bottom: 0 !important;
  margin-bottom: 0 !important;
}

/* 卡片内的表单项去除默认边距和边框 */
.el-form-item {
  margin-bottom: 0 !important;
}


</style>