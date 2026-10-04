<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- 详情标题区（固定不滚动） -->
    <div class="shrink-0 flex items-center justify-between gap-4 mb-8 mt-2 px-4 w-full md:max-w-220 md:mx-auto">
      <div class="flex items-center gap-3 min-w-0">
        <el-button link @click="$emit('back')"
          class="flex items-center gap-1 text-gray-900 dark:text-[#e8e9ed] hover:text-(--gd-color-primary) font-medium shrink-0">
          <el-icon :size="20"><ArrowBackIosFilled /></el-icon>
          <span>{{ t('settings.providerDetail.back') }}</span>
        </el-button>
        <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed] truncate">{{ provider?.name }}</h1>
      </div>
      <el-button @click="handleAddModel">
        <template #icon><PlusOutlined /></template>
        {{ t('settings.providerDetail.addModel') }}
      </el-button>
    </div>

    <!-- 内容区（独立滚动，满屏宽度） -->
    <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable both-edges;">
      <div class="px-4 pb-4 w-full md:max-w-220 md:mx-auto">
        <!-- 空状态 -->
        <div v-if="models.length === 0" class="rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) p-12 text-center">
          <el-icon size="48" class="text-gray-300 dark:text-[#3e4046] mb-3">
            <Box16Regular />
          </el-icon>
          <p class="text-lg text-gray-500 dark:text-[#8b8d95]">{{ t('settings.providerDetail.noModels') }}</p>
          <p class="text-sm mt-1 text-gray-400 dark:text-[#6b6d75]">{{ t('settings.providerDetail.noModelsDesc') }}</p>
          <div class="flex justify-center gap-3 mt-6">
            <el-button type="primary" @click="handleAddModel">
              <template #icon><PlusOutlined /></template>
              {{ t('settings.providerDetail.addModel') }}
            </el-button>
          </div>
        </div>

        <!-- 模型列表 -->
        <div v-else class="rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) px-3 py-1 mb-4">
          <ul>
            <li v-for="model in models" :key="model.id"
              class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-[#2e3035] last:border-b-0 hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors rounded px-3 -mx-3">
              <div class="flex items-center flex-1 min-w-0 mr-4">
                <Avatar class="w-10 h-10 shrink-0 mr-3" :src="getModelAvatarForSetting(model)"
                  :name="getModelDisplayName(model.modelName)" type="assistant" :round="false" />
                <div class="flex-1 min-w-0">
                  <div class="font-bold text-gray-800 dark:text-[#e8e9ed] truncate mb-2">{{
                    getModelDisplayName(model.modelName) }}</div>
                  <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-[#8b8d95]">
                    <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#2a2c30] font-medium">
                      {{ model.modelType === 'text' ? t('settings.providerDetail.chatType') : t('settings.providerDetail.embeddingType') }}
                    </span>
                    <div v-if="model.modelType === 'text'"
                      class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 dark:bg-[#2a2c30] border border-gray-100 dark:border-[#2e3035]">
                      <div class="flex items-center gap-0.5">
                        <template v-for="cap in (model.config?.inputCapabilities || [])" :key="'in-' + cap">
                          <GdTooltip :content="t('settings.providerDetail.input') + (cap === 'text' ? t('settings.providerDetail.text') : t('settings.providerDetail.image'))" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="16">
                              <TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else-if="cap === 'image'" />
                            </el-icon>
                          </GdTooltip>
                        </template>
                      </div>
                      <el-icon class="text-gray-300 dark:text-[#3e4046] mx-0.5" :size="12">
                        <ArrowRight24Regular />
                      </el-icon>
                      <div class="flex items-center gap-0.5">
                        <template v-for="cap in (model.config?.outputCapabilities || [])" :key="'out-' + cap">
                          <GdTooltip :content="t('settings.providerDetail.output') + (cap === 'text' ? t('settings.providerDetail.text') : t('settings.providerDetail.image'))" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="16">
                              <TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else-if="cap === 'image'" />
                            </el-icon>
                          </GdTooltip>
                        </template>
                      </div>
                      <template v-if="(model.config?.features || []).length > 0 || (model.thinkingEfforts?.length ?? 0) > 0">
                        <span class="w-px h-3 bg-gray-200 dark:bg-[#2e3035] mx-1"></span>
                        <template v-for="feature in (model.config?.features || [])" :key="feature">
                          <GdTooltip :content="getLableName(feature)" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="16">
                              <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                              <ScienceOutlined v-else />
                            </el-icon>
                          </GdTooltip>
                        </template>
                        <!-- 思考能力判据是档位菜单（空 = 不能思考） -->
                        <GdTooltip v-if="(model.thinkingEfforts?.length ?? 0) > 0" :content="getLableName('thinking')"
                          placement="top">
                          <el-icon class="hover:text-primary transition-colors" :size="16">
                            <LightbulbFilament24Regular />
                          </el-icon>
                        </GdTooltip>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity shrink-0">
                <el-switch v-model="model.isActive" :active-text="t('common.enabled')" :inactive-text="t('common.disabled')"
                  @change="handleToggleModelActive(model)" inline-prompt size="small" />
                <el-button link style="font-size: 18px; color: var(--el-text-color-secondary)"
                  @click="handleEditClick(model)">
                  <el-icon><SettingsOutlined /></el-icon>
                </el-button>
                <el-button type="danger" link style="font-size: 18px" @click="handleDeleteClick(model)">
                  <el-icon><RemoveCircleOutlineRound /></el-icon>
                </el-button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 编辑/新增模型信息的模态框 -->
    <GdDialog v-model="showEditModal" :title="isEditMode ? t('settings.providerDetail.editModelInfo') : t('settings.providerDetail.newModel')" width="600px" align-center
      class="model-edit-dialog dialog-with-scroll" append-to-body>
      <div class="dialog-content">
        <el-form ref="editFormRef" :model="editModelForm" :rules="editModelRules" label-position="left"
          label-width="120px" size="default">

          <div class="form-section">
            <el-form-item :label="t('settings.providerDetail.modelName')" prop="modelName">
              <div class="api-key-input-wrapper">
                <el-input v-model="editModelForm.modelName" :placeholder="t('settings.providerDetail.modelNamePlaceholder')" clearable
                  :disabled="isEditMode" />
                <el-button v-if="!isEditMode" type="primary" @click="handleFetchModels"
                  :loading="fetchingModels">
                  <template #icon>
                    <CloudDownloadOutlined />
                  </template>
                  {{ t('settings.providerDetail.fetchFromProvider') }}
                </el-button>
              </div>
              <!-- 预设检测提示 -->
              <div v-if="!isEditMode && matchedPreset" class="preset-hint" @click="applyPreset(matchedPreset)">
                <el-icon class="mr-1"><AutoFixHighOutlined /></el-icon>
                {{ t('settings.providerDetail.presetDetected', { label: matchedPreset.label }) }}
              </div>
            </el-form-item>

            <el-form-item :label="t('settings.providerDetail.modelType')" prop="modelType">
              <el-radio-group v-model="editModelForm.modelType">
                <el-radio-button value="text">
                  <span class="gd-option">
                    <span class="gd-option__mark gd-option__mark--radio"></span>
                    <el-icon class="gd-option__icon"><TextT24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.chatModel') }}</span>
                  </span>
                </el-radio-button>
                <el-radio-button value="embedding">
                  <span class="gd-option">
                    <span class="gd-option__mark gd-option__mark--radio"></span>
                    <el-icon class="gd-option__icon"><Group24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.embeddingModel') }}</span>
                  </span>
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
          </div>

          <!-- 对话模型配置 -->
          <div v-if="editModelForm.modelType === 'text'" class="transition-all">
            <el-form-item :label="t('settings.providerDetail.inputCapabilities')" prop="config.inputCapabilities" class="mb-3">
              <el-checkbox-group v-model="editModelForm.config.inputCapabilities">
                <el-checkbox-button value="text" disabled>
                  <span class="gd-option">
                    <span class="gd-option__mark"></span>
                    <el-icon class="gd-option__icon"><TextT24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.text') }}</span>
                    <GdTooltip :content="t('settings.providerDetail.capabilityLocked')" placement="top">
                      <el-icon class="gd-option__lock"><LockClosed16Regular /></el-icon>
                    </GdTooltip>
                  </span>
                </el-checkbox-button>
                <el-checkbox-button value="image">
                  <span class="gd-option">
                    <span class="gd-option__mark"></span>
                    <el-icon class="gd-option__icon"><Image24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.image') }}</span>
                  </span>
                </el-checkbox-button>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item :label="t('settings.providerDetail.outputCapabilities')" prop="config.outputCapabilities" class="mb-3">
              <el-checkbox-group v-model="editModelForm.config.outputCapabilities">
                <el-checkbox-button value="text" disabled>
                  <span class="gd-option">
                    <span class="gd-option__mark"></span>
                    <el-icon class="gd-option__icon"><TextT24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.text') }}</span>
                    <GdTooltip :content="t('settings.providerDetail.capabilityLocked')" placement="top">
                      <el-icon class="gd-option__lock"><LockClosed16Regular /></el-icon>
                    </GdTooltip>
                  </span>
                </el-checkbox-button>
                <el-checkbox-button value="image">
                  <span class="gd-option">
                    <span class="gd-option__mark"></span>
                    <el-icon class="gd-option__icon"><Image24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.image') }}</span>
                  </span>
                </el-checkbox-button>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item :label="t('settings.providerDetail.advancedFeatures')" prop="config.features" class="mb-4">
              <el-checkbox-group v-model="editModelForm.config.features">
                <el-checkbox-button value="tools">
                  <span class="gd-option">
                    <span class="gd-option__mark"></span>
                    <el-icon class="gd-option__icon"><WrenchScrewdriver24Regular /></el-icon>
                    <span class="gd-option__label">{{ t('settings.providerDetail.toolCalling') }}</span>
                  </span>
                </el-checkbox-button>
              </el-checkbox-group>
            </el-form-item>

            <!-- 思考调节：自动判断（跟随继承链）/ 不支持 / 支持。
                 只声明能力，不勾档位——档位由类型卡 / preset / 通用兜底决定 -->
            <el-form-item :label="t('settings.providerDetail.thinkingTuning')" class="mb-4">
              <div class="w-full">
                <el-radio-group v-model="editModelForm.thinkingMode">
                  <el-radio-button value="auto">
                    <span class="gd-option">
                      <span class="gd-option__mark gd-option__mark--radio"></span>
                      <span class="gd-option__label">{{ t('settings.providerDetail.thinkingAuto') }}</span>
                    </span>
                  </el-radio-button>
                  <el-radio-button value="false">
                    <span class="gd-option">
                      <span class="gd-option__mark gd-option__mark--radio"></span>
                      <span class="gd-option__label">{{ t('settings.providerDetail.thinkingUnsupported') }}</span>
                    </span>
                  </el-radio-button>
                  <el-radio-button value="true">
                    <span class="gd-option">
                      <span class="gd-option__mark gd-option__mark--radio"></span>
                      <span class="gd-option__label">{{ t('settings.providerDetail.thinkingSupported') }}</span>
                    </span>
                  </el-radio-button>
                </el-radio-group>

                <div class="mt-2 text-xs text-gray-400">
                  <template v-if="editModelForm.thinkingMode === 'auto'">
                    {{ t('settings.providerDetail.thinkingAutoHint') }}
                  </template>
                  <template v-else-if="editModelForm.thinkingMode === 'true'">
                    {{ t('settings.providerDetail.thinkingSupportedHint') }}
                  </template>
                  <template v-else>{{ t('settings.providerDetail.thinkingUnsupportedHint') }}</template>
                </div>

                <!-- 档位菜单 / wire 值 / 拼法：仅显式"支持"态展开；自动判断 = 全部跟随继承链 -->
                <template v-if="editModelForm.thinkingMode === 'true'">
                  <div class="mt-3 pt-3 border-t border-gray-100 dark:border-[#2e3035]">
                    <div class="text-xs font-medium text-gray-500 dark:text-[#8b8d95] mb-2">
                      {{ t('settings.providerDetail.thinkingEffortMenu') }}
                    </div>
                    <el-checkbox-group v-model="editModelForm.thinkingEffortsMenu">
                      <el-checkbox-button v-for="effort in THINKING_EFFORT_OPTIONS" :key="effort" :value="effort">
                        <span class="gd-option">
                          <span class="gd-option__mark"></span>
                          <span class="gd-option__label">{{ getThinkingEffortLabelWithKey(effort) }}</span>
                        </span>
                      </el-checkbox-button>
                    </el-checkbox-group>
                    <div class="mt-1.5 text-xs text-gray-400">{{ t('settings.providerDetail.thinkingEffortMenuHint') }}</div>
                    <div v-if="menuNeedsNonOff" class="mt-1 text-xs text-red-500">
                      {{ t('settings.providerDetail.thinkingMenuNeedsNonOff') }}
                    </div>

                    <div class="text-xs font-medium text-gray-500 dark:text-[#8b8d95] mt-3 mb-2">
                      {{ t('settings.providerDetail.thinkingTemplateLabel') }}
                    </div>
                    <el-select v-model="templateSelection" filterable
                      :placeholder="t('settings.providerDetail.thinkingTemplateDefault')"
                      style="max-width: 240px;" @change="onTemplateSelect">
                      <el-option v-for="tpl in curatedTemplates" :key="tpl.format"
                        :label="templateLabel(tpl.format)" :value="tpl.format" />
                      <el-option :label="t('settings.providerDetail.thinkingTemplateCustom')"
                        :value="PATCH_TEMPLATE_CUSTOM" />
                    </el-select>
                    <div v-if="formatSuggestion" class="preset-hint">
                      <el-icon class="mr-1"><AutoFixHighOutlined /></el-icon>
                      {{ t('settings.providerDetail.thinkingTemplateSuggested', formatSuggestion) }}
                      <el-button v-if="suggestedTemplateExpr" link type="primary" class="!text-xs !px-1"
                        @click="fillTemplate(suggestedTemplateExpr)">
                        {{ t('settings.providerDetail.thinkingExprFill') }}
                      </el-button>
                    </div>

                    <!-- 拼法表达式（CEL）：选模板回填，可自定义；表达式接管思考字段写入 -->
                    <div class="mt-2">
                      <CelExpressionEditor v-model="editModelForm.thinkingPatchExpr"
                        :placeholder="t('settings.providerDetail.thinkingExprPlaceholder')"
                        @diagnostic="onExprDiagnostic" />
                      <div v-if="exprDiagnostic" class="mt-1 text-xs text-red-500">
                        {{ t('settings.providerDetail.thinkingExprInvalid', { message: exprDiagnostic.message }) }}
                      </div>
                      <div v-else class="mt-1 text-xs text-gray-400">
                        {{ t('settings.providerDetail.thinkingExprHint') }}
                      </div>
                      <div class="mt-0.5 text-xs text-gray-400">
                        {{ t('settings.providerDetail.thinkingExprVars', { vars: exprVariablesText }) }}
                      </div>
                    </div>

                    <!-- 各档位输出预览（与运行时同库求值，所见即所发） -->
                    <div v-if="exprPreview.length" class="mt-2">
                      <div class="text-xs font-medium text-gray-500 dark:text-[#8b8d95] mb-1">
                        {{ t('settings.providerDetail.thinkingExprPreview') }}
                      </div>
                      <div v-for="row in exprPreview" :key="'pv-' + row.level" class="flex items-start gap-2 mb-1">
                        <span class="w-28 shrink-0 text-xs text-gray-500 dark:text-[#8b8d95] text-right">
                          {{ getThinkingEffortLabelWithKey(row.level) }}
                        </span>
                        <code class="text-xs font-mono break-all text-gray-600 dark:text-[#b8bac1]">{{ row.json }}</code>
                      </div>
                    </div>

                    <!-- 表达式为空：显示当前生效拼法及其等价表达式，一键填入（不自动改数据） -->
                    <div v-if="!editModelForm.thinkingPatchExpr.trim()" class="preset-hint">
                      <el-icon class="mr-1"><AutoFixHighOutlined /></el-icon>
                      {{ t('settings.providerDetail.thinkingExprEmptyHint', { format: formEffectiveFormat }) }}
                      <el-button v-if="inheritedTemplateExpr" link type="primary" class="!text-xs !px-1"
                        @click="fillTemplate(inheritedTemplateExpr)">
                        {{ t('settings.providerDetail.thinkingExprFill') }}
                      </el-button>
                    </div>
                    <div v-else-if="!effectiveFormatSupportsEffort" class="mt-1.5 text-xs text-amber-500">
                      {{ t('settings.providerDetail.thinkingOnNoEffortHint') }}
                    </div>

                    <!-- 旧版「档位 → JSON Patch」数据：界面已由表达式取代，运行时继续生效；
                         有残留数据时提示，可显式清除（不随保存隐式清除） -->
                    <div v-if="legacyPatchLevels" class="mt-1.5 text-xs text-amber-500">
                      {{ t('settings.providerDetail.thinkingLegacyPatch', { levels: legacyPatchLevels }) }}
                      <el-button link type="primary" class="!text-xs !px-1" @click="clearLegacyPatchRequested = true">
                        {{ t('settings.providerDetail.thinkingLegacyPatchClear') }}
                      </el-button>
                    </div>
                    <div v-else-if="clearLegacyPatchRequested" class="mt-1 text-xs text-gray-400">
                      {{ t('settings.providerDetail.thinkingLegacyPatchCleared') }}
                    </div>

                    <!-- 旧版「wire 值映射」数据：界面已由表达式取代，运行时继续生效
                         （且会优先于档位勾选决定菜单）；有残留时提示，可显式清除 -->
                    <div v-if="legacyMapLevels" class="mt-1.5 text-xs text-amber-500">
                      {{ t('settings.providerDetail.thinkingLegacyMap', { levels: legacyMapLevels }) }}
                      <el-button link type="primary" class="!text-xs !px-1" @click="clearLegacyMapRequested = true">
                        {{ t('settings.providerDetail.thinkingLegacyPatchClear') }}
                      </el-button>
                    </div>
                    <div v-else-if="clearLegacyMapRequested" class="mt-1 text-xs text-gray-400">
                      {{ t('settings.providerDetail.thinkingLegacyMapCleared') }}
                    </div>
                  </div>
                </template>
                <div v-else-if="editModelForm.thinkingMode === 'auto' && hasExplicitOverrides"
                  class="mt-1.5 text-xs text-amber-500">
                  {{ t('settings.providerDetail.thinkingOverrideResetNote') }}
                </div>
              </div>
            </el-form-item>

            <el-form-item :label="t('settings.providerDetail.contextWindow')" prop="config.contextWindow">
              <el-input-number v-model="editModelForm.config.contextWindow" placeholder="128000"
                controls-position="right" style="width: 240px;">
                <template #suffix><span class="text-gray-400 text-xs ml-1">Tokens</span></template>
              </el-input-number>
            </el-form-item>

            <el-form-item :label="t('settings.providerDetail.maxOutputTokens')" prop="config.maxOutputTokens">
              <el-input-number v-model="editModelForm.config.maxOutputTokens" placeholder="4096"
                controls-position="right" style="width: 240px;">
                <template #suffix><span class="text-gray-400 text-xs ml-1">Tokens</span></template>
              </el-input-number>
            </el-form-item>

            <el-divider content-position="left" class="!my-4 text-xs text-gray-400">
              <button type="button"
                class="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap hover:text-gray-600 dark:hover:text-[#b8bac1]"
                @click="defaultParamsExpanded = !defaultParamsExpanded">
                <el-icon class="transition-transform" :class="defaultParamsExpanded ? 'rotate-90' : ''" :size="12">
                  <ChevronRight16Regular />
                </el-icon>
                {{ t('settings.providerDetail.defaultParamsDesc') }}
              </button>
            </el-divider>

            <!-- 默认折叠：这些参数绝大多数情况不需要设置；条目已有值时自动展开，不隐藏存量配置 -->
            <div v-show="defaultParamsExpanded">
              <el-form-item :label="t('settings.providerDetail.temperature')" prop="config.temperature">
                <el-input-number v-model="editModelForm.config.temperature" :min="0" :max="2" :step="0.1"
                  :placeholder="t('settings.providerDetail.modelDefault')" controls-position="right" style="width: 240px;" />
              </el-form-item>

              <el-form-item label="Top P" prop="config.topP">
                <el-input-number v-model="editModelForm.config.topP" :min="0" :max="1" :step="0.05"
                  :placeholder="t('settings.providerDetail.modelDefault')" controls-position="right" style="width: 240px;" />
              </el-form-item>

              <el-form-item :label="t('settings.providerDetail.frequencyPenalty')" prop="config.frequencyPenalty">
                <el-input-number v-model="editModelForm.config.frequencyPenalty" :min="-2" :max="2" :step="0.1"
                  :placeholder="t('settings.providerDetail.modelDefault')" controls-position="right" style="width: 240px;" />
              </el-form-item>

              <el-form-item :label="t('settings.providerDetail.customParameters')" prop="config.customParameters">
                <el-input v-model="customParamsStr" type="textarea" :rows="3"
                  placeholder='{ "temperature": 0.7, "top_p": 1 }' class="font-mono text-xs" />
              </el-form-item>
            </div>
          </div>

          <!-- 嵌入模型配置 -->
          <div v-else-if="editModelForm.modelType === 'embedding'" class="transition-all">
            <el-form-item :label="t('settings.providerDetail.vectorDimensions')" prop="config.vectorDimensions">
              <el-input-number v-model="editModelForm.config.vectorDimensions" :placeholder="t('settings.providerDetail.vectorDimensionsPlaceholder')"
                style="width: 240px;" controls-position="right" />
              <div class="text-xs text-gray-400 mt-1">{{ t('settings.providerDetail.vectorDimensionsDesc') }}</div>
            </el-form-item>
          </div>
        </el-form>
      </div>
      <template #footer>
        <div class="dialog-footer flex justify-end gap-3">
          <el-button @click="showEditModal = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="handleSaveModel" :loading="saving">{{ t('settings.providerDetail.saveChanges') }}</el-button>
        </div>
      </template>
    </GdDialog>

    <!-- 获取模型列表的模态框 -->
    <GdDialog v-model="showFetchModal" :title="t('settings.providerDetail.fetchModelsTitle')" width="600px" align-center
      class="model-fetch-dialog dialog-with-scroll" append-to-body>
      <div class="dialog-content">
        <div class="mb-2 sticky top-0 bg-white dark:bg-[#232428] z-10">
          <el-input v-model="searchModelName" :placeholder="t('settings.providerDetail.searchModelName')" clearable @input="handleSearchModel">
            <template #prefix>
              <el-icon>
                <SearchOutlined />
              </el-icon>
            </template>
          </el-input>
        </div>

        <div v-if="fetchingModels" class="flex justify-center items-center py-12">
          <el-icon class="is-loading text-primary" style="font-size: 32px;">
            <Loading />
          </el-icon>
        </div>
        <div v-else class="pb-4">
          <div v-if="filteredFetchedModels.length > 0">
            <ul
              class="rounded-lg border border-gray-100 dark:border-[#2e3035] divide-y divide-gray-100 dark:divide-[#2e3035]">
              <li v-for="model in filteredFetchedModels" :key="model.modelName"
                class="flex items-center justify-between py-2 px-4 hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors">
                <div class="flex items-center gap-2 flex-1 min-w-0 mr-4">
                  <span class="font-medium text-gray-800 dark:text-[#e8e9ed] truncate">{{ model.modelName }}</span>
                  <span v-if="model.modelType !== 'text'"
                    class="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium text-xs">
                    {{ t('settings.providerDetail.embeddingBadge') }}
                  </span>
                  <template v-for="feature in (model.config?.features || [])" :key="feature">
                    <GdTooltip :content="getLableName(feature)" placement="top">
                      <el-icon class="hover:text-primary transition-colors" :size="14">
                        <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                        <ScienceOutlined v-else />
                      </el-icon>
                    </GdTooltip>
                  </template>
                  <GdTooltip v-if="(model.thinkingEfforts?.length ?? 0) > 0" :content="getLableName('thinking')"
                    placement="top">
                    <el-icon class="hover:text-primary transition-colors" :size="14">
                      <LightbulbFilament24Regular />
                    </el-icon>
                  </GdTooltip>
                </div>
                <el-button link type="primary" size="small" @click="handleSelectFromFetch(model)">
                  {{ t('settings.providerDetail.select') }}
                </el-button>
              </li>
            </ul>
          </div>

          <div v-if="filteredFetchedModels.length === 0" class="text-center py-12 text-gray-400 text-sm">
            {{ t('settings.providerDetail.noMatchFound') }}
          </div>
        </div>
      </div>
    </GdDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import Avatar from '../ui/Avatar.vue'
import GdTooltip from '../ui/GdTooltip.vue'
import {
  SettingsOutlined,
  RemoveCircleOutlineRound,
  SearchOutlined, ArrowBackIosFilled, PlusOutlined, CloudDownloadOutlined, ScienceOutlined,
  AutoFixHighOutlined
} from '@vicons/material'
import {
  TextT24Regular, LightbulbFilament24Regular, Image24Regular, WrenchScrewdriver24Regular, Group24Regular, ArrowRight24Regular, Box16Regular, LockClosed16Regular, ChevronRight16Regular
} from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import {
  getModelDisplayName,
  getModelAvatarPath,
  getThinkingEffortLabelWithKey,
  THINKING_EFFORT_OPTIONS,
  matchPatchTemplate,
  PATCH_TEMPLATE_CUSTOM
} from '@/utils/modelUtils'
import {
  buildPatchExprContext,
  evaluatePatchExpr,
  validatePatchExpr,
  type CelDiagnostic
} from '@/utils/celExpression'
import GdDialog from '@/components/ui/GdDialog.vue'
import CelExpressionEditor from './CelExpressionEditor.vue'
import type { Model, ModelProvider, ModelPreset } from '@/types/api'

const props = defineProps<{
  provider: ModelProvider
  models: Model[]
  modelPresets: ModelPreset[]
}>()

const emit = defineEmits<{
  back: []
  changed: []
}>()

const { t } = useI18n()
const { notify, confirm } = usePopup()

// ========== 编辑/新增模型信息 ==========
const showEditModal = ref(false)
const saving = ref(false)
const editFormRef = ref<any>(null)
const currentEditModelId = ref<string | null>(null)
const isEditMode = ref(false)

// 编辑弹窗每次打开时尝试加载拼法推荐（进程内只请求一次）
watch(showEditModal, (open) => {
  if (open) {
    loadFormatSuggestion()
    loadPatchTemplates()
  }
})

// ========== 思考调节（能力三态 + 档位菜单 + wire 映射 + 拼法）==========
/** 条目级覆盖 → 表单三态；无覆盖 = 跟随继承链 */
const thinkingModeFromModel = (model: Model): 'auto' | 'true' | 'false' => {
  const override = model?.supportsThinkingOverride
  if (override === true) return 'true'
  if (override === false) return 'false'
  return 'auto'
}

/** 覆盖态 → 表单档位菜单（仅取条目显式覆盖；继承链的菜单不回填，避免保存时误写覆盖） */
const effortsMenuFromModel = (model: Model): string[] => {
  const override = model?.thinkingEffortsOverride
  return Array.isArray(override) ? [...override] : []
}

/** 组思考 payload：
 * - true：能力覆盖 + 可选显式档位/表达式（勾选菜单 → thinkingEfforts 数组；
 *   表达式非空 → thinkingPatchExpr 并清掉条目级 thinkingFormat 覆盖——wire 值
 *   输入已移出界面，改名/钳制由表达式承担，thinkingEffortsMap 不再由表单产出）
 * - false：仅能力覆盖 false
 * - auto：条目存在任一覆盖时发 null 清除，全部回退继承链
 */
const buildThinkingPayload = (): Record<string, any> => {
  const mode = editModelForm.value.thinkingMode
  const model = props.models?.find((x) => x.id === currentEditModelId.value)
  if (mode === 'false') return { supportsThinking: false }
  if (mode === 'auto') {
    const payload: Record<string, any> = {}
    if (model?.supportsThinkingOverride !== undefined) payload.supportsThinking = null
    if (model?.thinkingEffortsOverride !== undefined) payload.thinkingEfforts = null
    if (model?.thinkingEffortsMapOverride !== undefined) payload.thinkingEffortsMap = null
    if (model?.thinkingPatchExprOverride !== undefined) payload.thinkingPatchExpr = null
    if (model?.compatOverride !== undefined) payload.compat = null
    return payload
  }

  const payload: Record<string, any> = { supportsThinking: true }
  const checked = new Set(editModelForm.value.thinkingEffortsMenu as string[])
  const menu = THINKING_EFFORT_OPTIONS.filter((e) => checked.has(e))
  if (menu.length > 0) {
    payload.thinkingEfforts = menu
  } else if (model?.thinkingEffortsOverride !== undefined) {
    payload.thinkingEfforts = null
  }

  // 旧版 wire 值映射：仅显式清除时下发 null（保存不隐式清除，存量数据运行时继续生效）
  if (clearLegacyMapRequested.value) {
    payload.thinkingEffortsMap = null
  }

  // 拼法表达式：非空 → 提交并清掉条目级 thinkingFormat 覆盖（表达式接管拼法，
  // 避免清空表达式后回落到陈旧拼法）。空 → 自定义态拼法显式化：默认 openai 钉在
  // 条目 compat 上（不再跟随类型卡，想跟随用「自动判断」）；条目已有显式
  // thinkingFormat（legacy 数据）则保留不动；同时清掉残留的表达式覆盖
  const expr = (editModelForm.value.thinkingPatchExpr || '').trim()
  if (expr) {
    payload.thinkingPatchExpr = expr
    const restCompat = { ...(model?.compatOverride || {}) }
    delete restCompat.thinkingFormat
    if (Object.keys(restCompat).length > 0) {
      payload.compat = restCompat
    } else if (model?.compatOverride !== undefined) {
      payload.compat = null
    }
  } else {
    if (model?.thinkingPatchExprOverride !== undefined) {
      payload.thinkingPatchExpr = null
    }
    if (model?.compatOverride?.thinkingFormat === undefined) {
      payload.compat = { ...(model?.compatOverride || {}), thinkingFormat: 'openai' }
    }
  }

  // 旧版「档位 → JSON Patch」：界面已由表达式取代；仅显式清除时下发 null
  //（保存不再隐式清除，存量 patch 数据运行时继续生效）
  if (clearLegacyPatchRequested.value) {
    payload.thinkingEffortsPatch = null
  }
  return payload
}
// 显式"支持"态的派生提示
const menuNeedsNonOff = computed(() => {
  const menu = editModelForm.value.thinkingEffortsMenu as string[]
  return menu.length > 0 && !menu.some((e) => e !== 'none')
})

const hasExplicitOverrides = computed(() => {
  const model = currentModel.value
  if (!model) return false
  return (
    model.supportsThinkingOverride !== undefined ||
    model.thinkingEffortsOverride !== undefined ||
    model.thinkingEffortsMapOverride !== undefined ||
    model.thinkingEffortsPatchOverride !== undefined ||
    model.thinkingPatchExprOverride !== undefined ||
    model.compatOverride !== undefined
  )
})

const currentModel = computed(() =>
  props.models?.find((x) => x.id === currentEditModelId.value) || null
)

/** 生效拼法不上强度值（开关型 format）——表达式为空时的非阻断提示 */
const effectiveFormatSupportsEffort = computed(
  () => currentModel.value?.supportsReasoningEffort ?? true
)

/** 自定义态空表达式的生效拼法（所见即所存）：条目显式 thinkingFormat（legacy 保留）> 默认 openai */
const formEffectiveFormat = computed(() => {
  return currentModel.value?.compatOverride?.thinkingFormat ?? 'openai'
})

// 按 API 地址推荐拼法（每次会话只请求一次；仅供提示，保存需用户显式选择）
const formatSuggestion = ref<{ format: string; vendor: string } | null>(null)
const suggestionLoaded = ref(false)
const loadFormatSuggestion = async () => {
  if (suggestionLoaded.value) return
  suggestionLoaded.value = true
  try {
    const res = await apiService.getThinkingFormatSuggestion(props.provider?.apiUrl || '')
    formatSuggestion.value = res?.suggestion ?? null
  } catch {
    formatSuggestion.value = null
  }
}

// ========== 拼法模板 + CEL 表达式 ==========
/** 模板列表（后端 /models/thinking-patch-templates；与内置拼法等价，矩阵测试锁定） */
const patchTemplates = ref<Array<{ format: string; expression: string; curated?: boolean; requiresCustomization?: boolean }>>([])
const patchTemplateVars = ref<Array<{ name: string; type: string }>>([])
const templatesLoaded = ref(false)
const loadPatchTemplates = async () => {
  if (templatesLoaded.value) return
  templatesLoaded.value = true
  try {
    const res = await apiService.getThinkingPatchTemplates()
    patchTemplates.value = Array.isArray(res?.templates) ? res.templates : []
    patchTemplateVars.value = Array.isArray(res?.variables) ? res.variables : []
  } catch {
    patchTemplates.value = []
    patchTemplateVars.value = []
  }
}

/** 表达式校验诊断（编辑器实时回传；保存前再校验一次兜底） */
const exprDiagnostic = ref<CelDiagnostic | null>(null)
const onExprDiagnostic = (diag: CelDiagnostic | null) => {
  exprDiagnostic.value = diag
}

/** 模板下拉数据源：仅预制 3 条（OpenAI / DeepSeek / enable_thinking 风格，覆盖主流场景） */
const curatedTemplates = computed(() => patchTemplates.value.filter((x) => x.curated))

/** 预制模板的风格名（i18n）；非预制格式回退技术名 */
const templateLabel = (format: string) => {
  const key = ({
    openai: 'thinkingTemplateOpenai',
    deepseek: 'thinkingTemplateDeepseek',
    qwen: 'thinkingTemplateQwen',
  } as Record<string, string>)[format]
  return key ? t(`settings.providerDetail.${key}`) : format
}

/** 模板下拉显示值 = 当前生效拼法：表达式命中预制模板 → 风格名；自定义表达式 → 自定义；
 *  空表达式 → 生效内置拼法直接回显为选中项（自定义态默认 openai / legacy 显式 format），
 *  所见即所发——下拉没有"未选择"态，想跟随类型卡拼法应切「自动判断」 */
const templateSelection = computed(() => {
  const expr = (editModelForm.value.thinkingPatchExpr || '').trim()
  if (expr) return matchPatchTemplate(expr, curatedTemplates.value)
  return formEffectiveFormat.value || 'openai'
})

/** 选模板 → 回填表达式；清除选择 = 清空回落默认 openai；自定义 = 保持文本不动（焦点交给编辑器） */
const onTemplateSelect = (value: string) => {
  if (value === PATCH_TEMPLATE_CUSTOM) return
  const tpl = patchTemplates.value.find((x) => x.format === value)
  editModelForm.value.thinkingPatchExpr = tpl ? tpl.expression : ''
}

const fillTemplate = (expression: string) => {
  editModelForm.value.thinkingPatchExpr = expression
}

/** 建议模板表达式（按 apiUrl 识别的 format → 模板） */
const suggestedTemplateExpr = computed(() => {
  const format = formatSuggestion.value?.format
  if (!format) return ''
  return patchTemplates.value.find((x) => x.format === format)?.expression || ''
})

/** 当前生效拼法的等价表达式（表达式为空时提示可一键填入） */
const inheritedTemplateExpr = computed(
  () => patchTemplates.value.find((x) => x.format === formEffectiveFormat.value)?.expression || ''
)

/** 表达式可用变量提示文本 */
const exprVariablesText = computed(() =>
  patchTemplateVars.value.map((v) => `${v.name}（${v.type}）`).join('、')
)

/**
 * 各档位输出预览：按当前勾选菜单 + 生效 wire 映射求值（与运行时同库同语义）。
 * - 表单未勾选任何档位（菜单走继承）→ 回落到模型生效菜单，避免预览空白
 * - wire 值输入已移出界面：改名映射来自模型既有 thinkingEffortsMap（旧数据），
 *   无映射时 wire 值 = 档位名，与运行时 resolveThinkingWireValue 一致
 */
const exprPreview = computed(() => {
  const expr = (editModelForm.value.thinkingPatchExpr || '').trim()
  if (!expr || exprDiagnostic.value) return []
  const checked = new Set(editModelForm.value.thinkingEffortsMenu as string[])
  const formMenu = THINKING_EFFORT_OPTIONS.filter((e) => checked.has(e))
  const menu = formMenu.length > 0
    ? formMenu
    : (Array.isArray(currentModel.value?.thinkingEfforts) ? currentModel.value.thinkingEfforts as string[] : [])
  if (menu.length === 0) return []
  const effectiveMap: Record<string, string | null> = currentModel.value?.thinkingEffortsMap || {}
  const map: Record<string, string> = {}
  for (const e of menu) map[e] = effectiveMap[e] || e
  return menu.map((level) => {
    try {
      const ctx = buildPatchExprContext(level, {
        mappedValue: level === 'none' || level === 'on' ? undefined : map[level],
        offWire: 'none' in map ? map['none'] : undefined,
      })
      return { level, json: JSON.stringify(evaluatePatchExpr(expr, ctx)) }
    } catch {
      return { level, json: '—' }
    }
  })
})

/** 旧版「档位 → JSON Patch」残留数据（界面已移除编辑器，仅提示 + 可显式清除） */
const clearLegacyPatchRequested = ref(false)
const legacyPatchLevels = computed(() => {
  if (clearLegacyPatchRequested.value) return ''
  const override = currentModel.value?.thinkingEffortsPatchOverride
  if (!override || typeof override !== 'object') return ''
  const levels = Object.keys(override)
  return levels.length > 0 ? levels.join(' / ') : ''
})

/** 旧版「wire 值映射」残留数据（界面已移除输入，仅提示 + 可显式清除） */
const clearLegacyMapRequested = ref(false)
const legacyMapLevels = computed(() => {
  if (clearLegacyMapRequested.value) return ''
  const override = currentModel.value?.thinkingEffortsMapOverride
  if (!override || typeof override !== 'object') return ''
  const levels = Object.keys(override).filter((k) => override[k] != null)
  return levels.length > 0 ? levels.join(' / ') : ''
})

const editModelForm = ref<any>({  modelName: '',
  modelType: 'text',
  thinkingMode: 'auto',
  thinkingEffortsMenu: [] as string[],
  thinkingPatchExpr: '',
  config: {
    inputCapabilities: ['text'],
    outputCapabilities: ['text'],
    features: [],
    contextWindow: null,
    maxOutputTokens: null,
    temperature: null,
    topP: null,
    frequencyPenalty: null,
    customParameters: {},
    vectorDimensions: null
  }
})

// 用于双向绑定自定义参数字符串
const customParamsStr = computed({
  get() {
    try {
      return JSON.stringify(editModelForm.value.config.customParameters, null, 2)
    } catch (e) {
      return ''
    }
  },
  set(val) {
    try {
      if (val.trim() === '') {
        editModelForm.value.config.customParameters = {}
      } else {
        editModelForm.value.config.customParameters = JSON.parse(val)
      }
    } catch (e) {
      // 解析失败时不更新，避免报错
    }
  }
})

// 检测当前输入的模型名是否匹配预设库
// 与后端 findModelPreset 同规则：逐 preset 先匹配完整名，再回退裸名
// （聚合站的 `vendor/model` 形式带前缀，`^` 锚定的模式否则永远匹配不上）
const matchedPreset = computed(() => {
  if (!editModelForm.value.modelName) return null
  const lower = editModelForm.value.modelName.toLowerCase()
  const bare = lower.split('/').pop() || lower
  return props.modelPresets.find((p) => {
    const patterns = p.patterns ?? []
    return patterns.some((src) => new RegExp(src).test(lower)) ||
      (bare !== lower && patterns.some((src) => new RegExp(src).test(bare)))
  }) || null
})

// 应用预设配置到表单
const applyPreset = (preset: ModelPreset) => {
  editModelForm.value.modelType = preset.modeType
  editModelForm.value.config = {
    inputCapabilities: preset.config.inputCapabilities || ['text'],
    outputCapabilities: preset.config.outputCapabilities || ['text'],
    features: preset.config.features || [],
    contextWindow: preset.config.contextWindow || null,
    maxOutputTokens: preset.config.maxOutputTokens || null,
    temperature: null,
    topP: null,
    frequencyPenalty: null,
    customParameters: {},
    vectorDimensions: preset.config.vectorDimensions || null
  }
}

const editModelRules = computed(() => ({
  modelName: { required: true, message: t('settings.providerDetail.modelNameRequired'), trigger: 'blur' },
  modelType: { required: true, message: t('settings.providerDetail.modelTypeRequired'), trigger: 'change' },
  'config.contextWindow': {
    required: false,
    type: 'number' as const,
    validator: (_rule: unknown, value: number | undefined) => !value || value > 0,
    message: t('settings.providerDetail.contextWindowInvalid'),
    trigger: 'blur' as const
  },
  'config.maxOutputTokens': {
    required: false,
    type: 'number' as const,
    validator: (_rule: any, value: any) => !value || value > 0,
    message: t('settings.providerDetail.maxOutputTokensInvalid'),
    trigger: 'blur' as const
  }
}))

const getLableName = (type: string) => {
  switch (type) {
    case 'visual':
      return t('settings.providerDetail.visual')
    case 'tools':
      return t('settings.providerDetail.toolCalling')
    case 'thinking':
      return t('settings.providerDetail.mixedThinking')
    default:
      return type
  }
}

// 获取模型头像路径
const getModelAvatarForSetting = (model: { modelName: string }) => {
  if (!model || !model.modelName) return undefined
  const providerName = props.provider?.name || undefined
  const avatarPath = getModelAvatarPath(model.modelName, providerName)
  return avatarPath || undefined
}

/** 「模型默认参数」折叠态：默认收起（不建议设置）；条目已有值时自动展开，不隐藏存量配置 */
const defaultParamsExpanded = ref(false)
const hasCustomDefaultParams = (config: Model['config']): boolean =>
  Boolean(
    config?.temperature != null ||
    config?.topP != null ||
    config?.frequencyPenalty != null ||
    (config?.customParameters && Object.keys(config.customParameters).length > 0)
  )

// 从获取列表中选择模型（预填充到编辑表单，不调用API）
const handleSelectFromFetch = (model: any) => {
  defaultParamsExpanded.value = hasCustomDefaultParams(model.config)
  editModelForm.value = {
    modelName: model.modelName || '',
    modelType: model.modelType || 'text',
    thinkingMode: 'auto',
    thinkingEffortsMenu: [],
    thinkingPatchExpr: '',
    config: {
      inputCapabilities: model.config?.inputCapabilities || ['text'],
      outputCapabilities: model.config?.outputCapabilities || ['text'],
      features: model.config?.features || [],
      contextWindow: model.config?.contextWindow || null,
      maxOutputTokens: model.config?.maxOutputTokens || null,
      temperature: model.config?.temperature ?? null,
      topP: model.config?.topP ?? null,
      frequencyPenalty: model.config?.frequencyPenalty ?? null,
      customParameters: model.config?.customParameters || {},
      vectorDimensions: model.config?.vectorDimensions || null
    }
  }
  showFetchModal.value = false
}

// 新增模型
const handleAddModel = () => {
  isEditMode.value = false
  currentEditModelId.value = null
  defaultParamsExpanded.value = false
  editModelForm.value = {
    modelName: '',
    modelType: 'text',
    thinkingMode: 'auto',
    thinkingEffortsMenu: [],
    thinkingPatchExpr: '',
    config: {
      inputCapabilities: ['text'],
      outputCapabilities: ['text'],
      features: [],
      contextWindow: null,
      maxOutputTokens: null,
      temperature: null,
      topP: null,
      frequencyPenalty: null,
      customParameters: {},
      vectorDimensions: null
    }
  }
  exprDiagnostic.value = null
  clearLegacyPatchRequested.value = false
  showEditModal.value = true
}

// 编辑模型
const handleEditClick = (model: any) => {
  isEditMode.value = true
  currentEditModelId.value = model.id
  const config = model.config || {}
  defaultParamsExpanded.value = hasCustomDefaultParams(config)
  editModelForm.value = {
    modelName: model.modelName || '',
    modelType: model.modelType || 'text',
    thinkingMode: thinkingModeFromModel(model),
    thinkingEffortsMenu: effortsMenuFromModel(model),
    // 仅回填条目级覆盖；继承链的表达式不回填（避免保存时误写覆盖）
    thinkingPatchExpr: model.thinkingPatchExprOverride || '',
    config: {
      inputCapabilities: config.inputCapabilities || ['text'],
      outputCapabilities: config.outputCapabilities || ['text'],
      features: config.features || [],
      contextWindow: config.contextWindow || null,
      maxOutputTokens: config.maxOutputTokens || null,
      temperature: config.temperature ?? null,
      topP: config.topP ?? null,
      frequencyPenalty: config.frequencyPenalty ?? null,
      customParameters: config.customParameters || {},
      vectorDimensions: config.vectorDimensions || null
    }
  }
  exprDiagnostic.value = null
  clearLegacyPatchRequested.value = false
  showEditModal.value = true
}

// 保存模型
const handleSaveModel = async () => {
  try {
    await editFormRef.value?.validate()

    // 显式"支持"态下的菜单约束：仅勾 none 等价于"不能思考"，与后端规则一致
    if (editModelForm.value.thinkingMode === 'true' && menuNeedsNonOff.value) {
      notify.error(t('common.operationFailed'), t('settings.providerDetail.thinkingMenuNeedsNonOff'), { duration: 2000 })
      return false
    }

    // 拼法表达式保存前兜底校验（编辑器实时诊断可能滞后；后端同样 fail-loud 400）
    if (editModelForm.value.thinkingMode === 'true') {
      const expr = (editModelForm.value.thinkingPatchExpr || '').trim()
      const diag = validatePatchExpr(expr)
      exprDiagnostic.value = diag
      if (diag) {
        notify.error(
          t('common.operationFailed'),
          t('settings.providerDetail.thinkingExprInvalid', { message: diag.message }),
          { duration: 3000 }
        )
        return false
      }
    }

    // 表单态字段（thinkingMode / thinkingEffortsMenu）不进 payload；
    // 思考域按三态 + null 清除语义由 buildThinkingPayload 组装
    const { thinkingMode, thinkingEffortsMenu, ...formRest } = editModelForm.value
    const body = { ...formRest, ...buildThinkingPayload() }

    if (isEditMode.value) {
      if (currentEditModelId.value) {
        await apiService.updateModel(currentEditModelId.value, body)
      }
      notify.success(t('common.saveSuccess'), t('settings.providerDetail.modelUpdated'))
    } else {
      await apiService.createModel({
        ...body,
        providerId: props.provider.id
      })
      notify.success(t('common.createSuccess'), t('settings.providerDetail.modelAdded'))
    }

    showEditModal.value = false
    emit('changed')
    return true
  } catch (errors) {
    // 验证失败，不关闭模态框
    return false
  }
}

// 删除模型
const handleDeleteClick = async (model: Model) => {
  const result = await confirm(t('settings.providerDetail.deleteModel'), t('settings.providerDetail.deleteModelConfirm'))
  if (!result) return
  await apiService.deleteModel(model.id)
  notify.success(t('common.deleteSuccess'), t('settings.providerDetail.modelDeleted'))
  emit('changed')
}

// 切换模型启用状态
const handleToggleModelActive = async (model: Model) => {
  try {
    const result = await apiService.toggleModelActive(model.id)
    model.isActive = result.isActive
    const statusText = result.isActive ? t('settings.providerDetail.modelEnabled') : t('settings.providerDetail.modelDisabled')
    notify.success(t('common.operationSuccess'), statusText, { duration: 2000 })
    emit('changed')
  } catch (error) {
    console.error('切换模型状态失败:', error)
    notify.error(t('common.operationFailed'), t('settings.providerDetail.toggleModelError'), { duration: 2000 })
    model.isActive = !model.isActive
  }
}

// ========== 获取模型列表 ==========
const showFetchModal = ref(false)
const fetchingModels = ref(false)
const fetchedModels = ref<any[]>([])
const searchModelName = ref('')

const handleSearchModel = useDebounceFn((_value) => {
  // 防抖处理，仅依赖 computed 过滤
}, 300)

const filteredFetchedModels = computed(() => {
  if (!searchModelName.value) {
    return fetchedModels.value
  }
  const searchTerm = searchModelName.value.toLowerCase()
  return fetchedModels.value.filter(model =>
    model.modelName.toLowerCase().includes(searchTerm)
  )
})

const handleFetchModels = async () => {
  if (!props.provider.apiUrl || !props.provider.apiKey) {
    notify.error(t('settings.providerDetail.configError'), t('settings.providerDetail.configApiError'), { duration: 2000 })
    return
  }

  fetchingModels.value = true
  showFetchModal.value = true

  try {
    const data = await apiService.fetchRemoteModels(props.provider.id)
    const apiModels = data.items || []
    // 从已添加的模型中继承config参数
    const enrichedModels = apiModels.map((apiModel: any) => {
      const existingModel = props.models.find(
        (model: any) => model.modelName === apiModel.modelName
      )
      if (existingModel) {
        return {
          ...apiModel,
          id: existingModel.id,
          config: { ...existingModel.config }
        }
      }
      return {
        ...apiModel,
        config: apiModel.config || { features: [] }
      }
    })
    fetchedModels.value = enrichedModels
    notify.success(t('common.operationSuccess'), t('settings.providerDetail.fetchSuccess', { n: enrichedModels.length }), { duration: 2000 })
  } catch (error) {
    fetchedModels.value = []
    notify.error(t('common.operationFailed'), t('settings.providerDetail.fetchFailed'), { duration: 2000 })
    console.error('获取模型列表失败:', error)
  } finally {
    fetchingModels.value = false
  }
}
</script>

<style scoped>
/* 统一输入框内容左对齐 */
:deep(.el-input__inner),
:deep(.el-textarea__inner),
:deep(.el-input-number__decrease),
:deep(.el-input-number__increase) {
  text-align: left !important;
}

/* el-divider 的文本自带一层实色背景（用来遮住分隔横线），底色是 Element 的
   --el-bg-color，暗色下与 GdDialog 表面色不一致，会显出一条异色带——
   对齐对话框底色（变量与 GdDialog.vue 的面板背景同源） */
:deep(.el-divider__text) {
  background-color: var(--gd-color-dialog-bg, var(--gd-color-bg));
}

/* ── 选项胶囊（模型类型 / 能力 / 思考调节）──────────────────────
   不用 Element 默认的"主色实心块"选中态：改为中性描边胶囊 + 前置指示器。
   克制原则：**主色只出现在指示器上**，胶囊本体（描边/底色）始终保持中性，
   选中仅表现为指示器填充 + 文字加深。这样一排选项不会出现大面积色块，
   也与"高亮色不要用黑色"的反馈一致（主色既做了强调，又不喧宾夺主）。
   固定项（必选的"文本"）外观与其它选中项一致，约束另由锁图标表达。 */

/* 组内胶囊用 flex + gap 排布：水平间距与换行行距统一 8px（原方案是相邻胶囊
   补 margin-left，胶囊换行后两行之间没有间距，且行首胶囊会被 margin 顶出缩进） */
:deep(.el-checkbox-group),
:deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:deep(.el-checkbox-button + .el-checkbox-button),
:deep(.el-radio-button + .el-radio-button) {
  margin-left: 0;
}

/* 中和 Element 的选中态变量：它的 is-checked / is-active 规则会据此上色，
   改写变量比用 !important 对抗基础规则更稳（后续加状态不会漏）。
   这里全部落成中性色——主色只在下面指示器规则里出现。 */
:deep(.el-checkbox-button) {
  --el-checkbox-button-checked-bg-color: var(--gd-color-input-bg);
  --el-checkbox-button-checked-text-color: var(--gd-color-text);
  --el-checkbox-button-checked-border-color: var(--gd-color-input-border);
  --el-checkbox-button-disabled-checked-fill: var(--gd-color-input-bg);
}

:deep(.el-radio-button) {
  --el-radio-button-checked-bg-color: var(--gd-color-input-bg);
  --el-radio-button-checked-text-color: var(--gd-color-text);
  --el-radio-button-checked-border-color: var(--gd-color-input-border);
}

:deep(.el-checkbox-button__inner),
:deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  /* 覆盖组内首尾元素的方角拼接 */
  border-radius: 8px !important;
  /* 不加 !important：Element 的选中态规则特异性更高，要让上面那组
     --el-*-button-checked-* 变量能覆盖到这里（现全为中性色） */
  background: var(--gd-color-input-bg);
  border: 1px solid var(--gd-color-input-border);
  outline: none;
  /* 未选中为次级灰，选中由 is-checked 规则加深 */
  color: var(--gd-color-text-gray);
  font-size: 13px;
  line-height: 1;
  font-weight: 400;
  /* Element 选中态会加 -1px 左投影（拼接按钮组的残留），这里统一抹掉 */
  box-shadow: none !important;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
}

/* 悬停：仅未选中项转深描边；选中项排除在外（选中态本就中性，
   压回灰也无妨，但保持一致便于后续调整） */
:deep(.el-checkbox-button:not(.is-checked) .el-checkbox-button__inner:hover),
:deep(.el-radio-button:not(.is-active) .el-radio-button__inner:hover) {
  color: var(--gd-color-text) !important;
  border-color: var(--gd-color-text-disabled);
}

:deep(.el-checkbox-button.is-checked .gd-option__label),
:deep(.el-radio-button.is-active .gd-option__label) {
  font-weight: 500;
}

/* 固定项（必选的"文本"）：它不是"禁用"而是"必选不可改"，所以外观与
   普通选中项一致（中性胶囊 + 主色指示器），仅去掉可点击手势；
   约束交给右侧锁图标表达。
   只覆盖 is-disabled.is-checked——将来若出现真正需要置灰的禁用项，
   它没有 is-checked，会保留 Element 的置灰样式。 */
:deep(.el-checkbox-button.is-disabled.is-checked .el-checkbox-button__inner) {
  color: var(--gd-color-text) !important;
  background: var(--gd-color-input-bg) !important;
  border-color: var(--gd-color-input-border) !important;
  cursor: default;
}

/* 禁用且未选中：压掉 Element 的 hover 变主色，明确"不可点" */
:deep(.el-checkbox-button.is-disabled:not(.is-checked) .el-checkbox-button__inner),
:deep(.el-checkbox-button.is-disabled:not(.is-checked) .el-checkbox-button__inner:hover) {
  cursor: default;
  color: var(--gd-color-text-disabled) !important;
  border-color: var(--gd-color-input-border) !important;
}

:deep(.el-checkbox-button.is-focus .el-checkbox-button__inner),
:deep(.el-radio-button__original-radio:focus-visible + .el-radio-button__inner) {
  border-color: var(--gd-color-primary) !important;
  box-shadow: 0 0 0 2px var(--gd-color-primary-100) !important;
}

.gd-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.gd-option__icon {
  font-size: 15px;
  color: var(--gd-color-text-gray);
  transition: color 0.15s ease;
}

/* 指示器：未选中 = 空心描边（勾/点透明）；选中 = 主色填充 + 白色对勾/圆点。
   勾色用 --el-color-white 而非 --gd-color-primary-text：后者暗色下是
   #d3d3d3，压在粉色上几乎看不清；前者亮暗色都是 #fff，与 Element
   原生 checkbox 的选中样式（primary 底 + color-white 勾）一致。
   未选中必须显式 transparent——不能靠"勾色=底色"取巧，那样暗色下会露出来。 */
.gd-option__mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--gd-color-input-bg);
  box-shadow: inset 0 0 0 1px var(--gd-color-input-border);
  color: transparent;
  transition: background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
}

.gd-option__mark::after {
  content: '';
  width: 4px;
  height: 8px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translate(-1px, -1px);
}

.gd-option__mark--radio {
  border-radius: 50%;
}

.gd-option__mark--radio::after {
  width: 6px;
  height: 6px;
  border: none;
  border-radius: 50%;
  background: currentColor;
  transform: none;
}

/* 选中态由 Element 的状态类驱动（整段包进 deep，匹配 slot 内的子元素） */
:deep(.el-checkbox-button.is-checked .gd-option__mark),
:deep(.el-radio-button.is-active .gd-option__mark) {
  background: var(--gd-color-primary);
  box-shadow: none;
  color: var(--el-color-white);
}

/* 选中项图标随文字一起加深为中性色——主色只留给指示器，
   避免一个选项里出现两处强调色 */
:deep(.el-checkbox-button.is-checked .gd-option__icon),
:deep(.el-radio-button.is-active .gd-option__icon) {
  color: var(--gd-color-text);
}

.gd-option__lock {
  font-size: 14px;
  color: var(--gd-color-text-disabled);
}

/* API Key 输入框和按钮布局 */
.api-key-input-wrapper {
  display: flex;
  gap: 8px;
  width: 100%;
}

.api-key-input-wrapper :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

/* 预设检测提示 */
.preset-hint {
  display: flex;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--gd-color-primary);
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.preset-hint:hover {
  opacity: 1;
}
</style>
