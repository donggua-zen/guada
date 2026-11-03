<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- 详情标题区（固定不滚动） -->
    <div class="shrink-0 flex items-center justify-between gap-4 mb-8 mt-2 px-4 w-full md:max-w-220 md:mx-auto">
      <div class="flex items-center gap-3 min-w-0">
        <GdButton link @click="$emit('back')"
          class="flex items-center gap-1 text-gray-900 dark:text-[#e8e9ed] hover:text-(--gd-color-primary) font-medium shrink-0">
          <ChevronLeft20Regular class="w-5 h-5"  />
          <span>{{ t('settings.providerDetail.back') }}</span>
        </GdButton>
        <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed] truncate">{{ provider?.name }}</h1>
      </div>
      <GdButton @click="handleAddModel">
        <template #icon><Add16Regular class="size-4" /></template>
        {{ t('settings.providerDetail.addModel') }}
      </GdButton>
    </div>

    <!-- 内容区（独立滚动，满屏宽度） -->
    <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable both-edges;">
      <div class="px-4 pb-4 w-full md:max-w-220 md:mx-auto">
        <!-- 空状态 -->
        <div v-if="models.length === 0" class="rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface) p-12 text-center">
          
            <Box16Regular class="text-gray-300 dark:text-[#3e4046] mb-3 w-12 h-12 mx-auto"  />
          
          <p class="text-lg text-gray-500 dark:text-[#8b8d95]">{{ t('settings.providerDetail.noModels') }}</p>
          <p class="text-sm mt-1 text-gray-400 dark:text-[#6b6d75]">{{ t('settings.providerDetail.noModelsDesc') }}</p>
          <div class="flex justify-center gap-3 mt-6">
            <GdButton type="primary" @click="handleAddModel">
              <template #icon><Add16Regular class="size-4" /></template>
              {{ t('settings.providerDetail.addModel') }}
            </GdButton>
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
                            <span class="hover:text-primary transition-colors w-4 h-4"><TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else-if="cap === 'image'" /></span>
                          </GdTooltip>
                        </template>
                      </div>
                      
                        <ArrowRight24Regular class="text-gray-300 dark:text-[#3e4046] mx-0.5 w-3 h-3"  />
                      
                      <div class="flex items-center gap-0.5">
                        <template v-for="cap in (model.config?.outputCapabilities || [])" :key="'out-' + cap">
                          <GdTooltip :content="t('settings.providerDetail.output') + (cap === 'text' ? t('settings.providerDetail.text') : t('settings.providerDetail.image'))" placement="top">
                            <span class="hover:text-primary transition-colors w-4 h-4"><TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else-if="cap === 'image'" /></span>
                          </GdTooltip>
                        </template>
                      </div>
                      <template v-if="(model.config?.features || []).length > 0 || (model.thinkingEfforts?.length ?? 0) > 0">
                        <span class="w-px h-3 bg-gray-200 dark:bg-[#2e3035] mx-1"></span>
                        <template v-for="feature in (model.config?.features || [])" :key="feature">
                          <GdTooltip :content="getLableName(feature)" placement="top">
                            <span class="hover:text-primary transition-colors w-4 h-4"><WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                              <Beaker16Regular v-else /></span>
                          </GdTooltip>
                        </template>
                        <!-- 思考能力判据是档位菜单（空 = 不能思考） -->
                        <GdTooltip v-if="(model.thinkingEfforts?.length ?? 0) > 0" :content="getLableName('thinking')"
                          placement="top">
                          
                            <LightbulbFilament24Regular class="hover:text-primary transition-colors w-4 h-4"  />
                          
                        </GdTooltip>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity shrink-0">
                <GdSwitch v-model="model.isActive" :active-text="t('common.enabled')" :inactive-text="t('common.disabled')"
                  @change="handleToggleModelActive(model)" inline-prompt size="small" />
                <GdButton link style="font-size: 18px; color: var(--gd-color-text-gray)"
                  @click="handleEditClick(model)">
                  <Settings16Regular class="size-4"  />
                </GdButton>
                <GdButton type="danger" link style="font-size: 18px" @click="handleDeleteClick(model)">
                  <SubtractCircle16Regular class="size-4"  />
                </GdButton>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 编辑/新增模型信息的模态框 -->
    <GdDialog v-model="showEditModal" :title="isEditMode ? t('settings.providerDetail.editModelInfo') : t('settings.providerDetail.newModel')" size="md" align-center
      class="model-edit-dialog dialog-with-scroll" append-to-body>
      <div class="dialog-content">
        <!-- 行距统一由容器 gap 提供：GdFormField 自身无外边距，
             之前靠各字段手写 mb-3/mb-4，漏写的（模型名称/模型类型、上下文长度/最大输出长度）就贴在一起了 -->
        <div class="flex flex-col gap-3">

          <div class="form-section flex flex-col gap-3">
            <GdFormField :label="t('settings.providerDetail.modelName')" label-width="120px" :error="errors.modelName">
              <div class="api-key-input-wrapper">
                <GdInput v-model="editModelForm.modelName" :placeholder="t('settings.providerDetail.modelNamePlaceholder')" clearable
                  :disabled="isEditMode" />
                <GdButton v-if="!isEditMode" type="primary" @click="handleFetchModels"
                  :loading="fetchingModels">
                  <template #icon>
                    <ArrowDownload16Regular />
                  </template>
                  {{ t('settings.providerDetail.fetchFromProvider') }}
                </GdButton>
              </div>
              <!-- 预设检测提示 -->
              <div v-if="!isEditMode && matchedPreset" class="preset-hint" @click="applyPreset(matchedPreset)">
                <Wand16Regular class="mr-1 size-4"  />
                {{ t('settings.providerDetail.presetDetected', { label: matchedPreset.label }) }}
              </div>
            </GdFormField>

            <GdFormField :label="t('settings.providerDetail.modelType')" label-width="120px" :error="errors.modelType">
              <GdSegmented v-model="editModelForm.modelType" :options="modelTypeOptions" />
            </GdFormField>
          </div>

          <!-- 对话模型配置 -->
          <div v-if="editModelForm.modelType === 'text'" class="transition-all flex flex-col gap-3">
            <GdFormField :label="t('settings.providerDetail.inputCapabilities')" label-width="120px" :error="errors.config_inputCapabilities">
              <GdCheckboxGroup v-model="editModelForm.config.inputCapabilities">
                <GdCheckbox :model-value="editModelForm.config.inputCapabilities?.includes('text')" disabled>
                  <span class="flex items-center gap-2">
                    <TextT24Regular class="size-4"  />
                    <span class="text-[13px] leading-none">{{ t('settings.providerDetail.text') }}</span>
                    <GdTooltip :content="t('settings.providerDetail.capabilityLocked')" placement="top">
                      <LockClosed16Regular class="size-4 text-[var(--gd-color-text-disabled)]"  />
                    </GdTooltip>
                  </span>
                </GdCheckbox>
                <GdCheckbox :model-value="editModelForm.config.inputCapabilities?.includes('image')">
                  <span class="flex items-center gap-2">
                    <Image24Regular class="size-4"  />
                    <span class="text-[13px] leading-none">{{ t('settings.providerDetail.image') }}</span>
                  </span>
                </GdCheckbox>
              </GdCheckboxGroup>
            </GdFormField>

            <GdFormField :label="t('settings.providerDetail.outputCapabilities')" label-width="120px" :error="errors.config_outputCapabilities">
              <GdCheckboxGroup v-model="editModelForm.config.outputCapabilities">
                <GdCheckbox :model-value="editModelForm.config.outputCapabilities?.includes('text')" disabled>
                  <span class="flex items-center gap-2">
                    <TextT24Regular class="size-4"  />
                    <span class="text-[13px] leading-none">{{ t('settings.providerDetail.text') }}</span>
                    <GdTooltip :content="t('settings.providerDetail.capabilityLocked')" placement="top">
                      <LockClosed16Regular class="size-4 text-[var(--gd-color-text-disabled)]"  />
                    </GdTooltip>
                  </span>
                </GdCheckbox>
                <GdCheckbox :model-value="editModelForm.config.outputCapabilities?.includes('image')">
                  <span class="flex items-center gap-2">
                    <Image24Regular class="size-4"  />
                    <span class="text-[13px] leading-none">{{ t('settings.providerDetail.image') }}</span>
                  </span>
                </GdCheckbox>
              </GdCheckboxGroup>
            </GdFormField>

            <GdFormField :label="t('settings.providerDetail.advancedFeatures')" label-width="120px" :error="errors.config_features">
              <GdCheckboxGroup v-model="editModelForm.config.features">
                <GdCheckbox :model-value="editModelForm.config.features?.includes('tools')">
                  <span class="flex items-center gap-2">
                    <WrenchScrewdriver24Regular class="size-4"  />
                    <span class="text-[13px] leading-none">{{ t('settings.providerDetail.toolCalling') }}</span>
                  </span>
                </GdCheckbox>
              </GdCheckboxGroup>
            </GdFormField>

            <!-- 思考调节：自动判断（跟随继承链）/ 不支持 / 支持。
                 只声明能力，不勾档位——档位由类型卡 / preset / 通用兜底决定 -->
            <GdFormField :label="t('settings.providerDetail.thinkingTuning')" label-width="120px">
              <div class="w-full">
                <GdSegmented v-model="editModelForm.thinkingMode" :options="thinkingModeOptions" />

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
                    <GdCheckboxGroup v-model="editModelForm.thinkingEffortsMenu">
                      <GdCheckbox v-for="effort in THINKING_EFFORT_OPTIONS" :key="effort"
                        :model-value="editModelForm.thinkingEffortsMenu?.includes(effort)">
                        <span class="ml-0.5 flex items-center gap-2">
                          <span class="text-[13px] leading-none">{{ getThinkingEffortLabelWithKey(effort) }}</span>
                        </span>
                      </GdCheckbox>
                    </GdCheckboxGroup>
                    <div class="mt-1.5 text-xs text-gray-400">{{ t('settings.providerDetail.thinkingEffortMenuHint') }}</div>
                    <div v-if="menuNeedsNonOff" class="mt-1 text-xs text-red-500">
                      {{ t('settings.providerDetail.thinkingMenuNeedsNonOff') }}
                    </div>

                    <div class="text-xs font-medium text-gray-500 dark:text-[#8b8d95] mt-3 mb-2">
                      {{ t('settings.providerDetail.thinkingTemplateLabel') }}
                    </div>
                    <GdSelect v-model="templateSelection" filterable
                      :placeholder="t('settings.providerDetail.thinkingTemplateDefault')"
                      style="max-width: 240px;" @change="onTemplateSelect">
                      <GdOption v-for="tpl in curatedTemplates" :key="tpl.format"
                        :label="templateLabel(tpl.format)" :value="tpl.format" />
                      <GdOption :label="t('settings.providerDetail.thinkingTemplateCustom')"
                        :value="PATCH_TEMPLATE_CUSTOM" />
                    </GdSelect>
                    <div v-if="formatSuggestion" class="preset-hint">
                      <Wand16Regular class="mr-1 size-4"  />
                      {{ t('settings.providerDetail.thinkingTemplateSuggested', formatSuggestion) }}
                      <GdButton v-if="suggestedTemplateExpr" link type="primary" class="!text-xs !px-1"
                        @click="fillTemplate(suggestedTemplateExpr)">
                        {{ t('settings.providerDetail.thinkingExprFill') }}
                      </GdButton>
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
                      <Wand16Regular class="mr-1 size-4"  />
                      {{ t('settings.providerDetail.thinkingExprEmptyHint', { format: formEffectiveFormat }) }}
                      <GdButton v-if="inheritedTemplateExpr" link type="primary" class="!text-xs !px-1"
                        @click="fillTemplate(inheritedTemplateExpr)">
                        {{ t('settings.providerDetail.thinkingExprFill') }}
                      </GdButton>
                    </div>
                    <div v-else-if="!effectiveFormatSupportsEffort" class="mt-1.5 text-xs text-amber-500">
                      {{ t('settings.providerDetail.thinkingOnNoEffortHint') }}
                    </div>

                    <!-- 旧版「档位 → JSON Patch」数据：界面已由表达式取代，运行时继续生效；
                         有残留数据时提示，可显式清除（不随保存隐式清除） -->
                    <div v-if="legacyPatchLevels" class="mt-1.5 text-xs text-amber-500">
                      {{ t('settings.providerDetail.thinkingLegacyPatch', { levels: legacyPatchLevels }) }}
                      <GdButton link type="primary" class="!text-xs !px-1" @click="clearLegacyPatchRequested = true">
                        {{ t('settings.providerDetail.thinkingLegacyPatchClear') }}
                      </GdButton>
                    </div>
                    <div v-else-if="clearLegacyPatchRequested" class="mt-1 text-xs text-gray-400">
                      {{ t('settings.providerDetail.thinkingLegacyPatchCleared') }}
                    </div>

                    <!-- 旧版「wire 值映射」数据：界面已由表达式取代，运行时继续生效
                         （且会优先于档位勾选决定菜单）；有残留时提示，可显式清除 -->
                    <div v-if="legacyMapLevels" class="mt-1.5 text-xs text-amber-500">
                      {{ t('settings.providerDetail.thinkingLegacyMap', { levels: legacyMapLevels }) }}
                      <GdButton link type="primary" class="!text-xs !px-1" @click="clearLegacyMapRequested = true">
                        {{ t('settings.providerDetail.thinkingLegacyPatchClear') }}
                      </GdButton>
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
            </GdFormField>

            <GdFormField :label="t('settings.providerDetail.contextWindow')" label-width="120px" :error="errors.config_contextWindow">
              <GdInputNumber v-model="editModelForm.config.contextWindow" placeholder="128000" style="width: 240px;">
                <template #suffix><span class="text-gray-400 text-xs ml-1">Tokens</span></template>
              </GdInputNumber>
            </GdFormField>

            <GdFormField :label="t('settings.providerDetail.maxOutputTokens')" label-width="120px" :error="errors.config_maxOutputTokens">
              <GdInputNumber v-model="editModelForm.config.maxOutputTokens" placeholder="4096" style="width: 240px;">
                <template #suffix><span class="text-gray-400 text-xs ml-1">Tokens</span></template>
              </GdInputNumber>
            </GdFormField>

            <!-- 间距由父级 gap-3 提供（GdDivider 本身无外边距，不要再加 my） -->
            <GdDivider content-position="left" class="text-xs text-gray-400">
              <button type="button"
                class="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap hover:text-gray-600 dark:hover:text-[#b8bac1]"
                @click="defaultParamsExpanded = !defaultParamsExpanded">
                
                  <ChevronRight16Regular class="transition-transform w-3 h-3" :class="defaultParamsExpanded ? 'rotate-90' : ''"  />
                
                {{ t('settings.providerDetail.defaultParamsDesc') }}
              </button>
            </GdDivider>

            <!-- 默认折叠：这些参数绝大多数情况不需要设置；条目已有值时自动展开，不隐藏存量配置 -->
            <div v-show="defaultParamsExpanded" class="flex flex-col gap-3">
              <GdFormField :label="t('settings.providerDetail.temperature')" label-width="120px" :error="errors.config_temperature">
                <GdInputNumber v-model="editModelForm.config.temperature" :min="0" :max="2" :step="0.1"
                  :placeholder="t('settings.providerDetail.modelDefault')" style="width: 240px;" />
              </GdFormField>

              <GdFormField label="Top P" label-width="120px" :error="errors.config_topP">
                <GdInputNumber v-model="editModelForm.config.topP" :min="0" :max="1" :step="0.05"
                  :placeholder="t('settings.providerDetail.modelDefault')" style="width: 240px;" />
              </GdFormField>

              <GdFormField :label="t('settings.providerDetail.frequencyPenalty')" label-width="120px" :error="errors.config_frequencyPenalty">
                <GdInputNumber v-model="editModelForm.config.frequencyPenalty" :min="-2" :max="2" :step="0.1"
                  :placeholder="t('settings.providerDetail.modelDefault')" style="width: 240px;" />
              </GdFormField>

              <GdFormField :label="t('settings.providerDetail.customParameters')" label-width="120px" :error="errors.config_customParameters">
                <GdInput v-model="customParamsStr" type="textarea" :rows="3"
                  placeholder='{ "temperature": 0.7, "top_p": 1 }' class="font-mono text-xs" />
              </GdFormField>
            </div>
          </div>

          <!-- 嵌入模型配置 -->
          <div v-else-if="editModelForm.modelType === 'embedding'" class="transition-all">
            <GdFormField :label="t('settings.providerDetail.vectorDimensions')" label-width="120px" :error="errors.config_vectorDimensions">
              <GdInputNumber v-model="editModelForm.config.vectorDimensions" :placeholder="t('settings.providerDetail.vectorDimensionsPlaceholder')"
                style="width: 240px;" />
              <div class="text-xs text-gray-400 mt-1">{{ t('settings.providerDetail.vectorDimensionsDesc') }}</div>
            </GdFormField>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer flex justify-end gap-3">
          <GdButton @click="showEditModal = false">{{ t('common.cancel') }}</GdButton>
          <GdButton type="primary" @click="handleSaveModel" :loading="saving">{{ t('settings.providerDetail.saveChanges') }}</GdButton>
        </div>
      </template>
    </GdDialog>

    <!-- 获取模型列表的模态框 -->
    <GdDialog v-model="showFetchModal" :title="t('settings.providerDetail.fetchModelsTitle')" size="md" align-center
      class="model-fetch-dialog dialog-with-scroll" append-to-body>
      <div class="dialog-content">
        <div class="mb-2 sticky top-0 bg-white dark:bg-[#232428] z-10">
          <GdInput v-model="searchModelName" :placeholder="t('settings.providerDetail.searchModelName')" clearable @input="handleSearchModel">
            <template #prefix>
              
                <Search16Regular class="size-4"  />
              
            </template>
          </GdInput>
        </div>

        <div v-if="fetchingModels" class="flex justify-center items-center py-12">
          
            <ArrowSync16Regular class="text-primary w-8 h-8 animate-spin" />
          
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
                      <span class="hover:text-primary transition-colors w-3.5 h-3.5"><WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                        <Beaker16Regular v-else /></span>
                    </GdTooltip>
                  </template>
                  <GdTooltip v-if="(model.thinkingEfforts?.length ?? 0) > 0" :content="getLableName('thinking')"
                    placement="top">
                    
                      <LightbulbFilament24Regular class="hover:text-primary transition-colors w-3.5 h-3.5"  />
                    
                  </GdTooltip>
                </div>
                <GdButton link type="primary" size="small" @click="handleSelectFromFetch(model)">
                  {{ t('settings.providerDetail.select') }}
                </GdButton>
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
import GdButton from '@/components/ui/GdButton.vue';
import GdCheckbox from '@/components/ui/GdCheckbox.vue';
import GdDivider from '@/components/ui/GdDivider.vue';
import GdInputNumber from '@/components/ui/GdInputNumber.vue';
import GdSelect from '@/components/ui/GdSelect.vue';
import GdOption from '@/components/ui/GdSelectOption';
import GdInput from '@/components/ui/GdInput.vue';
import GdFormField from '@/components/ui/GdFormField.vue';
import GdSwitch from '@/components/ui/GdSwitch.vue';
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { confirm } = usePopup()

const props = defineProps<{
  provider: ModelProvider
  models: Model[]
  modelPresets: ModelPreset[]
}>()

const currentEditModelId = ref<string | null>(null)

const showEditModal = ref(false)

const emit = defineEmits<{
  back: []
  changed: []
}>()
import { useDebounceFn } from '@vueuse/core'
import Avatar from '../ui/Avatar.vue'
import GdTooltip from '../ui/GdTooltip.vue'
import {
  TextT24Regular, LightbulbFilament24Regular, Image24Regular, WrenchScrewdriver24Regular, Group24Regular, ArrowRight24Regular, Box16Regular, LockClosed16Regular, ChevronRight16Regular, ArrowSync16Regular,
  Settings16Regular, SubtractCircle16Regular, Search16Regular, ChevronLeft20Regular, Add16Regular, ArrowDownload16Regular, Beaker16Regular, Wand16Regular
} from '@vicons/fluent'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { useFormValidation } from '@/composables/useFormValidation'
import { notify } from '@/components/ui/toastService';
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
import type { ThinkingPatchPayload } from '../../services/modules/model.api'
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
const onTemplateSelect = (value: string | number | (string | number)[]) => {
  const v = String(value)
  if (v === PATCH_TEMPLATE_CUSTOM) return
  const tpl = patchTemplates.value.find((x) => x.format === v)
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

/** 编辑弹窗表单（thinkingMode / thinkingEffortsMenu 为表单态字段，保存时不进 payload） */
interface EditModelFormData {
  modelName: string
  modelType: string
  thinkingMode: 'auto' | 'true' | 'false'
  thinkingEffortsMenu: string[]
  thinkingPatchExpr: string
  /** 与 Model.config 同构（customParameters 为动态 JSON 元数据，沿用项目既有类型） */
  config: NonNullable<Model['config']>
}

// GdSegmented 选项（模型类型 / 思考模式）：图标走组件 icon prop
const modelTypeOptions = [
  { label: t('settings.providerDetail.chatModel'), value: 'text', icon: TextT24Regular },
  { label: t('settings.providerDetail.embeddingModel'), value: 'embedding', icon: Group24Regular },
];
const thinkingModeOptions = [
  { label: t('settings.providerDetail.thinkingAuto'), value: 'auto' },
  { label: t('settings.providerDetail.thinkingUnsupported'), value: 'false' },
  { label: t('settings.providerDetail.thinkingSupported'), value: 'true' },
];

const editModelForm = ref<EditModelFormData>({  modelName: '',
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

// 校验（el-form :rules → useFormValidation；dot-path 键转为下划线，与模板 errors.xxx 对齐）
const { errors: editFormErrors, validate: validateEditForm } = useFormValidation({
  modelName: [{ validator: (v: unknown) => (String(v ?? '') ? null : t('settings.providerDetail.modelNameRequired')) }],
  modelType: [{ validator: (v: unknown) => (String(v ?? '') ? null : t('settings.providerDetail.modelTypeRequired')) }],
  config_contextWindow: [{ validator: (v: unknown) => (!v || Number(v) > 0) ? null : t('settings.providerDetail.contextWindowInvalid') }],
  config_maxOutputTokens: [{ validator: (v: unknown) => (!v || Number(v) > 0) ? null : t('settings.providerDetail.maxOutputTokensInvalid') }],
}, () => {
  // 键名用下划线是为对齐模板 errors.config_xxx；这里把嵌套路径摊平成同名键
  const form = editModelForm.value;
  return {
    modelName: form.modelName,
    modelType: form.modelType,
    config_contextWindow: form.config.contextWindow,
    config_maxOutputTokens: form.config.maxOutputTokens,
  };
});
// 模板里 errors.xxx 直接读（GdFormField :error）
const errors = editFormErrors;

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
const handleSelectFromFetch = (model: Model) => {
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
const handleEditClick = (model: Model) => {
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
    const valid = await validateEditForm()
    if (!valid) return

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
const fetchedModels = ref<Model[]>([])
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
    const enrichedModels = apiModels.map((apiModel) => {
      const existingModel = props.models.find(
        (model) => model.modelName === apiModel.modelName
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

const saving = ref(false)

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

const buildThinkingPayload = (): ThinkingPatchPayload => {
  const mode = editModelForm.value.thinkingMode
  const model = props.models?.find((x) => x.id === currentEditModelId.value)
  if (mode === 'false') return { supportsThinking: false }
  if (mode === 'auto') {
    const payload: ThinkingPatchPayload = {}
    if (model?.supportsThinkingOverride !== undefined) payload.supportsThinking = null
    if (model?.thinkingEffortsOverride !== undefined) payload.thinkingEfforts = null
    if (model?.thinkingEffortsMapOverride !== undefined) payload.thinkingEffortsMap = null
    if (model?.thinkingPatchExprOverride !== undefined) payload.thinkingPatchExpr = null
    if (model?.compatOverride !== undefined) payload.compat = null
    return payload
  }

  const payload: ThinkingPatchPayload = { supportsThinking: true }
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
</script>

<style scoped>
/* API Key 输入框和按钮布局 */
.api-key-input-wrapper {
  display: flex;
  gap: 8px;
  width: 100%;
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
