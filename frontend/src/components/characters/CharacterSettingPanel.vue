<template>
  <div class="character-setting-panel-root h-full" v-loading="pageLoading" :element-loading-text="t('characters.setting.loading')">
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
                ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
                : 'text-(--color-text) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
              <el-icon :size="16">
                <component :is="item.icon" />
              </el-icon>
              <span class="text-sm font-medium">{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 内容区 -->
      <div class="flex-1 overflow-hidden flex flex-col px-4">
        <!-- 基础设置 -->
        <div v-show="tabsValue === 'basic'" class="flex-1 overflow-hidden">
          <div class="h-full overflow-y-auto py-4">
            <el-form ref="basicFormRef" :model="characterForm" :rules="basicRules" label-position="top">
              <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                <!-- 头像设置 -->
                <el-form-item prop="avatarUrl" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.avatarTitle') }} <span class="text-xs text-gray-400">{{ t('characters.setting.avatarOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.avatarHint') }}</span>
                    </div>
                    <AvatarPreview :src="characterForm.avatarUrl" type="assistant" class="w-10"
                      :name="characterForm.title" @avatar-changed="handleAvatarChanged" />
                  </div>
                </el-form-item>
                <!-- 角色标题 -->
                <el-form-item prop="title" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.titleLabel') }}</span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.titleHint') }}</span>
                    </div>
                    <div class="w-1/2 flex justify-end">
                      <el-input v-model="characterForm.title" :placeholder="t('characters.setting.titlePlaceholder')" class="w-full" />
                    </div>
                  </div>
                </el-form-item>
                <!-- 角色描述 -->
                <el-form-item prop="description" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.descLabel') }} <span class="text-xs text-gray-400">{{ t('characters.setting.descOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.descHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-input v-model="characterForm.description" type="textarea" :placeholder="t('characters.setting.descPlaceholder')"
                        :autosize="{ minRows: 3, maxRows: 5 }" class="w-full" />
                    </div>
                  </div>
                </el-form-item>
                <!-- 分组设置 -->
                <el-form-item prop="groupId" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.groupLabel') }} <span class="text-xs text-gray-400">{{ t('characters.setting.groupOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.groupHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-select v-model="characterForm.groupId" :placeholder="t('characters.setting.groupPlaceholder')" clearable class="w-full">
                        <el-option :label="t('characters.setting.groupUngrouped')" value="" />
                        <el-option v-for="group in characterGroups" :key="group.id" :label="group.name"
                          :value="group.id ?? ''" />
                      </el-select>
                    </div>
                  </div>
                </el-form-item>
              </div>

              <!-- 模型选择 -->
              <div class="mt-3 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                <el-form-item prop="modelId" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.modelLabel') }} <span class="text-xs text-gray-400">{{ t('characters.setting.modelOptional') }}</span></span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.modelHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-select v-model="characterForm.modelId" :options="modelOptions" :placeholder="t('characters.setting.modelPlaceholder')" clearable
                        class="w-full" />
                    </div>
                  </div>
                </el-form-item>
              </div>

              <!-- 记忆与压缩 -->
              <div class="mt-3 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                <!-- 触发阈值 -->
                <el-form-item prop="compressionTriggerRatio" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.triggerThreshold') }}</span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.triggerHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-slider v-model="characterForm.compressionTriggerRatio" :min="0.5" :max="0.95" :step="0.05"
                        show-input :format-tooltip="formatSliderTooltip" class="w-full" />
                    </div>
                  </div>
                </el-form-item>
                <!-- 保留目标 -->
                <el-form-item prop="compressionTargetRatio" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.targetRatio') }}</span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.targetHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-slider v-model="characterForm.compressionTargetRatio" :min="0.2" :max="0.8" :step="0.05"
                        show-input :format-tooltip="(val) => `${Math.round(val * 100)}%`" class="w-full" />
                    </div>
                  </div>
                </el-form-item>
                <!-- 摘要模式 -->
                <el-form-item prop="summaryMode" class="mb-0!">
                  <div class="px-4 py-3.5 flex items-center justify-between gap-4 w-full">
                    <div class="flex flex-col gap-1 w-1/2">
                      <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('characters.setting.summaryMode') }}</span>
                      <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('characters.setting.summaryHint') }}</span>
                    </div>
                    <div class="w-1/2">
                      <el-select v-model="characterForm.summaryMode" :placeholder="t('characters.setting.summaryPlaceholder')" class="w-full">
                        <el-option :label="t('characters.setting.summaryDisabled')" value="disabled">
                          <span class="flex items-center gap-2">
                            <el-icon><CloseOutlined /></el-icon>
                            <span>{{ t('characters.setting.summaryDisabledDesc') }}</span>
                          </span>
                        </el-option>
                        <el-option :label="t('characters.setting.summaryFast')" value="fast">
                          <span class="flex items-center gap-2">
                            <el-icon><ThunderboltOutlined /></el-icon>
                            <span>{{ t('characters.setting.summaryFastDesc') }}</span>
                          </span>
                        </el-option>
                        <el-option :label="t('characters.setting.summaryMemorySync')" value="memory_sync">
                          <span class="flex items-center gap-2">
                            <el-icon><FolderOutlined /></el-icon>
                            <span>{{ t('characters.setting.summaryMemorySyncDesc') }}</span>
                          </span>
                        </el-option>
                      </el-select>
                    </div>
                  </div>
                </el-form-item>
              </div>

              <el-alert :title="t('characters.setting.tipTitle')" type="info" :closable="false" show-icon style="margin-top: 16px;">
                <p class="text-sm">{{ t('characters.setting.tip1') }}</p>
                <p class="text-sm">{{ t('characters.setting.tip2') }}</p>
                <p class="text-sm">{{ t('characters.setting.tip3') }}</p>
              </el-alert>
            </el-form>
          </div>
        </div>

        <!-- 提示词 -->
        <div v-show="tabsValue === 'prompt'" class="flex-1 overflow-hidden">
          <div class="px-0 py-6 h-full flex flex-col flex-1">
            <div class="px-0 flex-1 flex flex-col min-h-0">
              <el-form ref="promptFormRef" :model="characterForm" :rules="promptRules" label-position="top"
                label-width="80px" size="large" class="flex-1 flex flex-col min-h-0">
                <el-form-item :show-label="false" :show-feedback="false" style="flex-shrink: 0;" class="no-border-item">
                  <div class="flex items-center w-full justify-between">
                    <span>{{ t('characters.setting.systemPromptLabel') }}</span>
                  </div>
                </el-form-item>

                <!-- 详细设定 -->
                <el-form-item prop="systemPrompt" :show-label="false"
                  class="flex-1 min-h-40 prompt-form-item no-border-item">
                  <el-input v-model="characterForm.systemPrompt" type="textarea" :placeholder="t('characters.setting.systemPromptPlaceholder')" resize="none" />
                </el-form-item>

              </el-form>
            </div>
          </div>
        </div>

        <!-- 本地工具 -->
        <div v-show="tabsValue === 'local_tools'" class="flex-1 overflow-hidden">
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- 全部禁用与白名单模式 同一行左对齐 + 右对齐 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allDisabled" @update:model-value="(v) => handleAllDisabledToggle(!v)" />
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allDisabled }]">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.newPluginLabel') }}</span>
                      <SegmentedToggle v-model="allowlistMode" :options="autoEnableOptions" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="localTools.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('characters.setting.noLocalTools') }}</div>
                  <div class="text-sm mt-2">{{ t('characters.setting.noLocalToolsHint') }}</div>
                </div>

                <div v-else class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
                  <div v-for="tool in localTools" :key="tool.pluginId"
                    class="tool-item p-2.5 rounded-xl transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                    :class="{ 'opacity-50 pointer-events-none': allDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <div class="font-medium text-sm flex-1 truncate text-gray-800 dark:text-gray-200">{{ tool.displayName }}</div>
                      <div class="flex items-center gap-2 shrink-0">
                        <el-switch :model-value="isToolProviderEnabled(tool.pluginId)"
                          @update:model-value="(val) => handleLocalToolToggle(tool.pluginId, val)"
                          :disabled="allDisabled" inline-prompt :active-text="t('common.enable')" :inactive-text="t('common.disable')" size="small" />
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2">{{ tool.description }}</p>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </div>

        <!-- MCP 工具 -->
        <div v-show="tabsValue === 'mcp_tools'" class="flex-1 overflow-hidden">
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- MCP 全部禁用与白名单模式 同一行 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allMcpDisabled" @update:model-value="(v) => handleAllMcpDisabledToggle(!v)" />
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allMcpDisabled }]">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.newMcpLabel') }}</span>
                      <SegmentedToggle v-model="mcpAllowlistMode" :options="autoEnableOptions" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="mcpServers.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('characters.setting.noMcpServers') }}</div>
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
                            {{ t('characters.setting.mcpRunning') }}
                          </el-tag>
                          <el-tag v-else type="info" size="small" class="ml-2">
                            {{ t('characters.setting.mcpNotRunning') }}
                          </el-tag>
                        </div>
                        <div v-if="server.description" class="text-sm text-gray-600 line-clamp-2">
                          {{ server.description }}
                        </div>
                        <div v-if="server.tools && Object.keys(server.tools).length > 0"
                          class="text-sm text-gray-500 mt-2">
                          {{ t('characters.setting.availableTools', { count: Object.keys(server.tools).length }) }}
                        </div>
                      </div>

                      <!-- 启用/禁用开关 -->
                      <el-switch :model-value="isMcpServerEnabled(server.id)"
                        @update:model-value="(val) => handleMcpServerToggle(server.id, val)"
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
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- Skills 全部禁用与白名单模式 同一行 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allSkillsDisabled" @update:model-value="(v) => handleAllSkillsDisabledToggle(!v)" />
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allSkillsDisabled }]">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.newSkillLabel') }}</span>
                      <SegmentedToggle v-model="skillsAllowlistMode" :options="autoEnableOptions" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="loadingSkills" class="text-center py-8">
                  <el-icon class="is-loading" size="24">
                    <LoadingOutlined />
                  </el-icon>
                  <div class="text-sm text-gray-500 mt-2">{{ t('characters.setting.loadingSkills') }}</div>
                </div>

                <div v-else-if="visibleSkills.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('characters.setting.noSkills') }}</div>
                  <div class="text-sm mt-2">{{ t('characters.setting.noSkillsHint') }}</div>
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
                          @update:model-value="(val) => handleSkillToggle(skill.id, val)" :disabled="allSkillsDisabled"
                          size="small" inline-prompt :active-text="t('common.enable')" :inactive-text="t('common.disable')" />
                        <el-tag v-if="skill.source === 'system'" type="success" size="small" effect="light">{{ t('characters.setting.sourceBuiltin') }}</el-tag>
                        <el-tag v-if="skill.manifest?.version" type="info" size="small" effect="plain">v{{
                          skill.manifest.version }}</el-tag>
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{{ skill.manifest?.description || t('characters.setting.noDescription')
                      }}</p>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </div>

        <!-- 子代理 -->
        <div v-show="tabsValue === 'agent_presets'" class="flex-1 overflow-hidden">
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top">
                <!-- 全部禁用与白名单模式 同一行 -->
                <el-form-item class="no-border-item">
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">{{ t('characters.setting.toolToggle') }}</span>
                      <el-switch :model-value="!allAgentsDisabled" @update:model-value="(v) => handleAllAgentsDisabledToggle(!v)" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="loadingAgents" class="text-center py-8">
                  <el-icon class="is-loading" size="24">
                    <LoadingOutlined />
                  </el-icon>
                  <div class="text-sm text-gray-500 mt-2">{{ t('characters.setting.loadingAgents') }}</div>
                </div>

                <div v-else-if="presetCharacters.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>{{ t('characters.setting.noAgents') }}</div>
                  <div class="text-sm mt-2">{{ t('characters.setting.noAgentsHint') }}</div>
                </div>

                <div v-else class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
                  <div v-for="char in presetCharacters" :key="char.id"
                    class="agent-item p-2.5 rounded-xl transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30]"
                    :class="{ 'opacity-50 pointer-events-none': allAgentsDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <div class="font-medium text-sm flex-1 truncate text-gray-800 dark:text-gray-200">{{ char.title }}</div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <el-switch :model-value="getAgentEffectiveEnabled(char)"
                          @update:model-value="(val) => handleAgentToggle(char.id, val)" :disabled="allAgentsDisabled"
                          size="small" inline-prompt :active-text="t('common.enable')" :inactive-text="t('common.disable')" />
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{{ char.description || t('characters.setting.noDescription') }}</p>
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
// @ts-nocheck - CharacterSettingPanel 组件复杂度高，临时使用@ts-nocheck
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElSelect,
  ElSlider,
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
  ApiOutlined,
  CloseOutlined,
  FolderOutlined,
  ThunderboltOutlined
} from '@vicons/antd'

import { Code24Regular, Bot24Regular } from '@vicons/fluent'

import { apiService } from '../../services/ApiService'


import { usePopup } from '../../composables/usePopup'
import AvatarPreview from '../ui/AvatarPreview.vue'
import SegmentedToggle from '../ui/SegmentedToggle.vue'
import { DEFAULT_SUMMARY_MODE } from '@/constants'

const { toast, notify } = usePopup()
const { t } = useI18n()

// 工具栏目"全部禁用/自定义"分段按钮选项
const autoEnableOptions = computed(() => [
  { label: t('characters.setting.autoEnable'), value: false },
  { label: t('characters.setting.keepDisabled'), value: true }
])

// Slider 百分比格式化函数
const formatSliderTooltip = (val: number): string => {
  return `${Math.round(val * 100)}%`;
};

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
      title: '',
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
const isSimpleStyle = computed(() => props.simple)
const pageLoading = ref(false)

// 模型数据
const models = ref([]);
const providers = ref([]);

// 表单引用
const basicFormRef = ref(null)
const promptFormRef = ref(null)

const tabsValue = ref(props.tab)

// 初始表单数据对照（用于检测是否有未保存的变更）
// 在 loadAllData 全部就绪后记录
// 必须用 ref，否则 hasChanges computed 无法追踪变化
const _initialFormData = ref<any>(null)

// 深度比较两个值（忽略对象 key 顺序）
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every(k => k in b && deepEqual(a[k], b[k]))
  }
  return a === b
}

// 侧边栏分组
const sidebarGroups = computed(() => [
  {
    label: t('characters.setting.groupBasic'),
    items: [
      { label: t('characters.setting.navBasic'), path: 'basic', icon: UserOutlined },
      { label: t('characters.setting.navPrompt'), path: 'prompt', icon: MessageOutlined },
    ]
  },
  {
    label: t('characters.setting.groupTools'),
    items: [
      { label: t('characters.setting.navLocalTools'), path: 'local_tools', icon: ToolOutlined },
      { label: t('characters.setting.navMcpTools'), path: 'mcp_tools', icon: ApiOutlined },
      { label: t('characters.setting.navSkills'), path: 'skills', icon: Code24Regular },
      { label: t('characters.setting.navSubAgents'), path: 'agent_presets', icon: Bot24Regular },
    ]
  }
])

// 表单数据
const characterForm = reactive({
  id: '',
  title: '',
  description: '',
  avatarUrl: '',
  avatarFile: null,
  groupId: null,  // 新增：分组 ID
  assistantName: '',
  assistantIdentity: '',
  systemPrompt: '',
  modelId: null,
  memoryType: '',
  enabledTools: [],  // 启用的本地工具
  toolsMode: 'inherit',
  enabledSkills: {},       // 按角色启用的技能 { skillId: true/false }
  skillsMode: 'inherit',  // Skills 模式: 'inherit' | 'custom' | 'disabled'
  compressionTriggerRatio: 0.8, // 触发阈值
  compressionTargetRatio: 0.5, // 保留目标
  summaryMode: DEFAULT_SUMMARY_MODE, // 摘要模式：'disabled' | 'fast' | 'memory_sync'
})

// 验证规则
const basicRules = computed(() => ({
  title: [
    { required: true, message: t('characters.setting.titleRequired'), trigger: ['input', 'blur'] },
    { min: 2, max: 20, message: t('characters.setting.titleLength'), trigger: ['input', 'blur'] }
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

const memoryOptions = computed(() => [
  { label: t('characters.setting.memorySlidingWindow'), value: 'sliding_window' },
  { label: t('characters.setting.memorySummaryAugmented'), value: 'summary_augmented_sliding_window' },
  { label: t('characters.setting.memorySlidingWindowWithRag'), value: 'sliding_window_with_rag' },
  { label: t('characters.setting.memoryless'), value: 'memoryless' }
]);

// 模型选择选项（按供应商分组）
const modelOptions = computed(() => {
  if (!models.value.length || !providers.value.length) return []

  const options = []

  // 添加"使用默认模型"选项
  options.push({
    label: t('characters.setting.modelUseDefault'),
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
const mcpServers = ref([]);

// Skills 数据
const skillsList = ref([]);
const loadingSkills = ref(false);
const updatingSkills = ref(new Set());

// 角色分组数据
const characterGroups = ref([]);

// 本地工具数据
const localTools = ref([]);

// 角色工具设置（pluginId -> boolean | 'all'）
const characterToolSettings = ref({});

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
// 通用子代理（虚拟角色，不出现在角色列表中）
const GENERIC_AGENT = computed(() => ({
  id: 'generic',
  title: t('characters.setting.genericAgentTitle'),
  description: t('characters.setting.genericAgentDesc'),
}));
// 是否全部禁用子代理
const allAgentsDisabled = ref(false);
// 助手偏好 { characterId: true/false }
const enabledAgents = reactive<Record<string, boolean>>({});
// 子代理列表（排除当前角色，含虚拟通用子代理）
const presetCharacters = ref<any[]>([]);
const loadingAgents = ref(false);




// 是否自动启用全部工具
const allToolsEnabled = computed(() => {
  // 如果角色工具配置为 true，则认为启用了全部工具
  return characterToolSettings.value === true;
});

// 计算技能的最终显示状态（不受模式影响，始终 = 用户显式值 → 全局继承）
const getSkillEffectiveEnabled = (skill) => {
  if (skill.id in characterForm.enabledSkills) {
    return characterForm.enabledSkills[skill.id];
  }
  return skill.enabled !== false;
};

// 角色面板可见的技能
const visibleSkills = computed(() => {
  // 强制追踪模式切换依赖，确保技能列表随白名单/黑名单切换重渲染
  void skillsAllowlistMode.value;
  // 全部禁用模式下仍然展示所有技能（灰色不可操作状态）
  return skillsList.value.filter(skill => {
    // 全局禁用的技能，但角色级覆盖启用了 → 显示
    if (skill.enabled === false) {
      if (characterForm.skillsMode === 'custom' && characterForm.enabledSkills[skill.id] === true) {
        return true;
      }
      return false;
    }
    return true;
  });
});

// 判断某个工具提供者是否启用（用于 Switch 显示）
const isToolProviderEnabled = (pluginId) => {
  // 优先读取角色稳定的工具偏好，避免主开关切换时后端重查导致开关跟随变化；
  // 主开关只负责灰显，不改变单个工具开关的原有状态。
  if (pluginId in characterToolSettings.value) {
    return characterToolSettings.value[pluginId];
  }
  const tool = localTools.value.find(t => t.pluginId === pluginId);
  return tool ? tool.enabled : false;
};

// 判断 MCP 服务器是否启用（根据当前模式）
const isMcpServerEnabled = (serverId) => {
  if (mcpAllowlistMode.value) {
    // 白名单：在白名单列表中才显示启用
    return mcpAllowlistServers.value.includes(serverId);
  }
  // 黑名单：不在拒绝列表中才显示启用
  return !mcpDeniedServers.value.includes(serverId);
};

// 监听 props.data 变化
watch(() => props.data, (newVal, oldVal) => {
  // 检测是否是角色切换（id 变化）或初始化
  const isCharacterSwitch = !characterForm.id || (newVal.id && newVal.id !== characterForm.id);

  if (isCharacterSwitch) {
    characterForm.avatarFile = null;
  }

  characterForm.id = newVal.id || '';
  characterForm.title = newVal.title || '';
  characterForm.description = newVal.description || '';
  characterForm.avatarUrl = newVal.avatarUrl || '';
  // groupId: null 或 undefined 转换为空字符串，以便 el-select 正确显示
  characterForm.groupId = newVal.groupId || '';  // 加载分组 ID
  characterForm.modelId = newVal.modelId || '';

  characterForm.assistantName = newVal.settings?.assistantName || '';
  characterForm.assistantIdentity = newVal.settings?.assistantIdentity || '';
  characterForm.systemPrompt = newVal.settings?.systemPrompt || '';
  characterForm.memoryType = newVal.settings?.memoryType || 'sliding_window';

  // 从 memory 分组加载记忆与压缩配置
  const memoryConfig = newVal.settings?.memory || {};
  characterForm.compressionTriggerRatio = memoryConfig.compressionTriggerRatio ?? newVal.settings?.compressionTriggerRatio ?? 0.8;
  characterForm.compressionTargetRatio = memoryConfig.compressionTargetRatio ?? newVal.settings?.compressionTargetRatio ?? 0.5;
  characterForm.summaryMode = memoryConfig.summaryMode ?? DEFAULT_SUMMARY_MODE;
  // 加载已启用的插件
  characterForm.enabledTools = newVal.settings?.plugins || [];
  // 加载角色插件设置（新格式：{ pluginId: { enabled: true/false } }）
  let pluginsConfig = newVal.settings?.plugins;
  // 向后兼容：旧数据使用 tools 字段
  if (pluginsConfig === undefined) {
    pluginsConfig = newVal.settings?.tools;
  }
  if (typeof pluginsConfig === 'object' && pluginsConfig !== null && !Array.isArray(pluginsConfig)) {
    // 读取策略 → 全部禁用开关
    const strategy = pluginsConfig?.__strategy;
    allDisabled.value = strategy === 'deny_nonsystem';
    // 读取白名单模式：__default === false 表示白名单
    allowlistMode.value = pluginsConfig?.__default === false;
    characterToolSettings.value = {};
    for (const [pluginId, cfg] of Object.entries(pluginsConfig)) {
      if (pluginId === '__strategy' || pluginId === '__default') continue;
      if (typeof cfg === 'object' && cfg !== null) {
        characterToolSettings.value[pluginId] = (cfg as Record<string, unknown>).enabled !== false;
      } else {
        characterToolSettings.value[pluginId] = cfg === true;
      }
    }
  } else {
    // undefined / null / true → 继承全局
    // 继承全局
    characterToolSettings.value = {};
  }
  // 加载 MCP 配置（黑白名单兼容）
  const mcpPluginsCfg = newVal.settings?.plugins?.mcp;
  const mcpDeny = mcpPluginsCfg?.toolkits_deny;
  mcpDeniedServers.value = mcpDeny
    ? mcpDeny.map((id: string) => id.replace(/^mcp_/, ''))
    : [];
  const mcpAllow = mcpPluginsCfg?.toolkits_allow;
  mcpAllowlistServers.value = mcpAllow
    ? mcpAllow.map((id: string) => id.replace(/^mcp_/, ''))
    : [];
  mcpAllowlistMode.value = mcpPluginsCfg?.toolkits_filter === 'allow';
  allMcpDisabled.value = mcpPluginsCfg?.enabled === false;

  // 加载角色技能偏好
  // 全部禁用：从 plugins.skill.enabled 读取
  allSkillsDisabled.value = newVal.settings?.plugins?.skill?.enabled === false;
  // 白名单模式：从 skills.__default 读取
  const skillsConfig = newVal.settings?.skills;
  skillsAllowlistMode.value = skillsConfig?.__default === false;
  // 单项偏好：从 skills 读取（过滤 __default 系统字段）
  if (typeof skillsConfig === 'object' && !Array.isArray(skillsConfig)) {
    characterForm.enabledSkills = {};
    for (const [skillId, val] of Object.entries(skillsConfig)) {
      if (skillId === '__default') continue;
      characterForm.enabledSkills[skillId] = val;
    }
  } else {
    characterForm.enabledSkills = {};
  }

  // 加载子代理偏好（固定白名单：仅显式 true 的角色被启用）
  // 默认禁用：无配置时 allAgentsDisabled = true
  allAgentsDisabled.value = newVal.settings?.plugins?.sub_agent?.enabled !== true;
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

const handleAvatarChanged = (file) => {
  characterForm.avatarFile = file
}

// MCP 服务器开关切换处理（根据当前模式决定存到拒绝列表或允许列表）
const handleMcpServerToggle = (serverId, enabled) => {
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
const handleSkillToggle = (skillId, enabled) => {
  characterForm.enabledSkills[skillId] = enabled;
  characterForm.enabledSkills = { ...characterForm.enabledSkills };
};

// ── 子代理 ──
const getAgentEffectiveEnabled = (char) => {
  return enabledAgents[char.id] ?? false;
};
const handleAgentToggle = (charId, enabled) => {
  enabledAgents[charId] = enabled;
};
const handleAllAgentsDisabledToggle = async (val) => {
  allAgentsDisabled.value = val;
};
const loadPresetCharacters = async () => {
  loadingAgents.value = true;
  try {
    const response = await apiService.fetchCharacters();
    const allChars = response.items || [];
    // 排除当前正在编辑的角色，并在列表开头插入虚拟通用子代理
    presetCharacters.value = [
      GENERIC_AGENT.value,
      ...allChars.filter(c => c.id !== characterForm.id),
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
    const [modelsResp, mcpsResp, skillsResp, groupsResp, charsResp] = await Promise.all([
      apiService.fetchModels(),
      apiService.getMcpServers(),
      apiService.fetchSkills(),
      apiService.fetchCharacterGroups(),
      apiService.fetchCharacters(),
      loadLocalTools(),
    ])

    // 模型
    models.value = []
    providers.value = []
    modelsResp.items.forEach((provider: any) => {
      models.value.push(...provider.models)
      delete provider.models
      providers.value.push(provider)
    })

    // MCP 服务器
    mcpServers.value = mcpsResp.items.filter((s: any) => s.enabled)

    // Skills
    skillsList.value = Array.isArray(skillsResp?.items)
      ? skillsResp.items.filter((s: any) => s.enabled !== false)
      : []
    if (skillsAllowlistMode.value) {
      for (const skill of skillsList.value) {
        if (!(skill.id in characterForm.enabledSkills)) {
          characterForm.enabledSkills[skill.id] = false
        }
      }
    }

    // 角色分组
    characterGroups.value = groupsResp

    // 子代理列表（排除当前角色 + 通用虚拟子代理）
    const allChars = charsResp.items || []
    presetCharacters.value = [
      GENERIC_AGENT.value,
      ...allChars.filter((c: any) => c.id !== characterForm.id),
    ]

    // 所有数据就绪后记录初始快照
    _initialFormData.value = getFormData()
  } catch (err) {
    console.error('加载角色设置数据失败', err)
  } finally {
    pageLoading.value = false
  }
}

// 角色切换时刷新子代理列表
watch(() => characterForm.id, () => {
  if (characterForm.id) {
    loadPresetCharacters();
  }
})

// 模式切换时同步初始状态
const handleMcpModeChange = (mode) => {
  if (mode === 'custom' && characterForm.enabledMcpServers.length === 0) {
    // 默认全选当前可用服务器
    characterForm.enabledMcpServers = mcpServers.value
      .filter(s => s.enabled)
      .map(s => s.id);
  }
};

const handleSkillsModeChange = (mode) => {
  if (mode === 'custom' && Object.keys(characterForm.enabledSkills).length === 0) {
    // 默认全选当前可用技能
    const initial = {};
    skillsList.value
      .filter(s => s.enabled !== false)
      .forEach(s => { initial[s.id] = true; });
    characterForm.enabledSkills = initial;
  }
};

// 全部禁用开关切换处理
const handleAllDisabledToggle = async (val) => {
  allDisabled.value = val;
  await loadLocalTools();
};

const handleAllMcpDisabledToggle = async (val) => {
  allMcpDisabled.value = val;
  await loadMCPServers();
};

const handleAllSkillsDisabledToggle = async (val) => {
  allSkillsDisabled.value = val;
};

// 加载本地工具列表
async function loadLocalTools() {
  try {
    // 根据当前 UI 状态动态构建查询配置
    // 不等于全部禁用时，按当前模式从内存状态构建查询
    if (!allDisabled.value) {
      const queryConfig: any = {};
      queryConfig.__strategy = 'custom';
      queryConfig.__default = allowlistMode.value ? false : true;

      // 从当前内存状态（characterToolSettings）构建，按模式过滤
      for (const [pluginId, enabled] of Object.entries(characterToolSettings.value)) {
        if (allowlistMode.value) {
          // 白名单：只传 enabled: true
          if (enabled) queryConfig[pluginId] = { enabled: true };
        } else {
          // 黑名单：只传 enabled: false
          if (!enabled) queryConfig[pluginId] = { enabled: false };
        }
      }

      const response = await apiService.queryPlugins(queryConfig);

      // API 返回 plugins[]，每个元素含 enabled 有效状态
      const plugins = response.plugins || [];

      // 本地工具列表：后端已过滤 system 插件，此处只排除全局关闭的
      localTools.value = plugins.filter(p => !(p.effective === 'global' && !p.enabled));

      // 正常模式：初始化 characterToolSettings
      const stored = { ...characterToolSettings.value };
      characterToolSettings.value = {};
      for (const tool of localTools.value) {
        characterToolSettings.value[tool.pluginId] = stored[tool.pluginId] ?? tool.enabled;
      }
    } else {
      // 全部禁用时，不传 __default 和具体条目，只传 strategy
      const response = await apiService.queryPlugins({
        __strategy: 'deny_nonsystem',
      });

      const plugins = response.plugins || [];
      localTools.value = plugins.filter(p => !(p.effective === 'global' && !p.enabled));
    }
  } catch (error) {
    console.error('加载本地工具失败:', error);
    toast.error(t('characters.setting.loadLocalToolsFailed'));
  }
}

// 全部工具开关切换处理
const handleAllToolsToggle = (enabled) => {
  // 直接设置为布尔值，保存到数据库时也是布尔值
  characterToolSettings.value = enabled;
  console.log(`角色工具整体${enabled ? '启用' : '禁用'}`);
}

// 本地工具开关切换处理
const handleLocalToolToggle = (pluginId, enabled) => {
  // 从全部禁用模式切换到正常模式
  if (allDisabled.value) {
    allDisabled.value = false;
    characterToolSettings.value = {};
  }
  characterToolSettings.value[pluginId] = enabled;
  // 同步更新 localTools 以便 isToolProviderEnabled 即时反馈
  const tool = localTools.value.find(t => t.pluginId === pluginId);
  if (tool) tool.enabled = enabled;
  console.log(`本地工具 ${pluginId} ${enabled ? '启用' : '禁用'}`);
}

const loadModels = async () => {
  try {
    const response = await apiService.fetchModels()

    response.items.forEach(provider => {
      models.value.push(...provider.models)
      delete provider.models
      providers.value.push(provider)
    })

  } catch (error) {
    console.error('获取模型列表失败:', error)
    notify.error(t('characters.setting.loadModelsFailed'), error)
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

// 监听 MCP 白名单模式切换 → 迁移当前状态，保持 UI 不变
watch(mcpAllowlistMode, (newMode) => {
  if (mcpServers.value.length === 0) return;
  if (newMode) {
    // 切换为白名单：当前启用中的服务器变为允许列表
    const enabledServers = mcpServers.value
      .filter(s => !mcpDeniedServers.value.includes(s.id))
      .map(s => s.id);
    mcpAllowlistServers.value = enabledServers;
    mcpDeniedServers.value = [];
  } else {
    // 切换为黑名单：当前禁用中的服务器变为拒绝列表
    const disabledServers = mcpServers.value
      .filter(s => !mcpAllowlistServers.value.includes(s.id))
      .map(s => s.id);
    mcpDeniedServers.value = disabledServers;
    mcpAllowlistServers.value = [];
  }
});

const findModelById = (modelId) => {
  return models.value.find(model => model.id === modelId)
}

// localTools 加载完成后，自定义模式下初始化 characterToolSettings
watch(localTools, (tools) => {
  if (!allDisabled.value && tools.length > 0) {
    const stored = { ...characterToolSettings.value };
    characterToolSettings.value = {};
    for (const tool of tools) {
      const defaultEnabled = allowlistMode.value ? false : tool.enabled;
      characterToolSettings.value[tool.pluginId] = stored[tool.pluginId] ?? defaultEnabled;
    }
  }
});

// 监听白名单模式切换 → 本地翻转，不查询后端
watch(allowlistMode, () => {
  if (allDisabled.value || localTools.value.length === 0) return;
  const stored = { ...characterToolSettings.value };
  characterToolSettings.value = {};
  for (const tool of localTools.value) {
    const defaultEnabled = allowlistMode.value ? false : tool.enabled;
    characterToolSettings.value[tool.pluginId] = stored[tool.pluginId] ?? defaultEnabled;
  }
});

// 生命周期
onMounted(async () => {
  // 首次挂载时，所有异步数据由 props.data watch 统一触发 loadAllData
})

onUnmounted(() => {
  // window.removeEventListener('resize', updateDrawerWidth)
  if (characterForm.avatarUrl && characterForm.avatarUrl.startsWith('blob:')) {
    URL.revokeObjectURL(characterForm.avatarUrl);
  }
})



const handleSave = async () => {
  // 验证逻辑已移至父组件调用 validate() 时执行
  // 此方法现在仅用于返回最终数据
  return getFormData();
}

// 获取表单数据
const getFormData = () => {
  let finalData = {
    'title': characterForm.title,
    'description': characterForm.description,
    'name': characterForm.name,
    'avatarUrl': characterForm.avatarUrl,
    'avatarFile': characterForm.avatarFile,
    'groupId': characterForm.groupId === '' ? null : characterForm.groupId,
    'identity': characterForm.identity,
    'modelId': characterForm.modelId === '' ? null : characterForm.modelId,
    'settings': {
      'assistantName': characterForm.assistantName,
      'assistantIdentity': characterForm.assistantIdentity,
      'systemPrompt': characterForm.systemPrompt,
      'memoryType': characterForm.memoryType,
      // 记忆与压缩配置分组
      'memory': {
        'compressionTriggerRatio': characterForm.compressionTriggerRatio,
        'compressionTargetRatio': characterForm.compressionTargetRatio,
        'summaryMode': characterForm.summaryMode,
      },
      // 插件配置
      'plugins': (() => {
        const buildCustom = () => {
          const result: Record<string, any> = {};
          for (const [pluginId, enabled] of Object.entries(characterToolSettings.value)) {
            if (allowlistMode.value) {
              // 白名单：只存 enabled: true（未显式开启的默认禁用）
              if (enabled) result[pluginId] = { enabled: true };
            } else {
              // 黑名单：只存 enabled: false（未显式关闭的默认启用）
              if (!enabled) result[pluginId] = { enabled: false };
            }
          }
          // MCP 配置（黑白名单兼容）
          const mcpConfig: Record<string, any> = {};
          mcpConfig.enabled = !allMcpDisabled.value;
          if (mcpAllowlistMode.value) {
            // 白名单模式
            mcpConfig.toolkits_filter = 'allow';
            if (mcpAllowlistServers.value.length > 0) {
              mcpConfig.toolkits_allow = mcpAllowlistServers.value.map((id: string) => `mcp_${id}`);
            }
          } else if (mcpDeniedServers.value.length > 0) {
            // 黑名单模式（有拒绝列表时才写入）
            mcpConfig.toolkits_filter = 'deny';
            mcpConfig.toolkits_deny = mcpDeniedServers.value.map((id: string) => `mcp_${id}`);
          }

          if (Object.keys(mcpConfig).length > 0) {
            result.mcp = mcpConfig;
          }
          // Skills：始终显式写入 enabled 状态，true=启用 false=全部禁用
          result.skill = { enabled: !allSkillsDisabled.value };
          // 预设 Agent
          result.sub_agent = { enabled: !allAgentsDisabled.value };
          return result;
        };
        // 全部禁用：保留原有配置值，追加 __default 以便切回时恢复白名单模式
        if (allDisabled.value) {
          const denyOutput: any = { __strategy: 'deny_nonsystem', ...buildCustom() };
          if (allowlistMode.value) {
            denyOutput.__default = false;
          }
          return denyOutput;
        }
        // 正常（自定义）
        const output: any = { __strategy: 'custom' };
        if (allowlistMode.value) {
          output.__default = false;
        }
        return { ...output, ...buildCustom() };
      })(),
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
        for (const char of presetCharacters.value) {
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
  characterForm.avatarFile = null;
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

/* 工具配置对话框样式已迁移到 LDialog scoped styles */

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

/* 内容区域 flex 布局 */
.character-setting-panel-root > div > div:last-child {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* 表单区域优化 */
:deep(.el-form) {
  height: 100%;
}


/* 提示词输入框样式 - 禁止resize并占满flex空间 */
.prompt-form-item {
  display: flex;
  flex-direction: column;
  min-height: 400px;
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