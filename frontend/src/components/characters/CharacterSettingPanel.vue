<template>
  <div class="character-setting-panel-root">
    <div class="flex flex-col flex-1 character-setting-panel">
      <el-tabs ref="tabsInstRef" v-model="tabsValue" class="flex-1 flex flex-col character-tabs">
        <!-- 基础设置 -->
        <el-tab-pane name="basic" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <UserOutlined />
              </el-icon>
              <span>基础</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form ref="basicFormRef" :model="characterForm" :rules="basicRules" label-position="left"
                label-width="50%" size="large">
                <!-- 头像设置 -->
                <el-form-item prop="avatarUrl">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">角色头像</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">点击头像可以更换新的头像，支持上传图片文件</span>
                    </div>
                  </template>
                  <div class="avatar-upload-container">
                    <AvatarPreview :src="characterForm.avatarUrl" type="assistant" class="w-10"
                      :name="characterForm.title" @avatar-changed="handleAvatarChanged">
                    </AvatarPreview>
                  </div>
                </el-form-item>

                <!-- 角色标题 -->
                <el-form-item prop="title">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">角色标题</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">助手的显示名称，在对话列表中展示</span>
                    </div>
                  </template>
                  <el-input v-model="characterForm.title" placeholder="请输入角色标题" class="w-full max-w-md" />
                </el-form-item>

                <!-- 角色描述 -->
                <el-form-item prop="description">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">角色描述</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">简要描述助手的用途、特点或背景信息</span>
                    </div>
                  </template>
                  <el-input v-model="characterForm.description" type="textarea" placeholder="请输入角色描述"
                    :autosize="{ minRows: 3, maxRows: 5 }" class="w-full max-w-md" />
                </el-form-item>

                <!-- 分组设置 -->
                <el-form-item prop="groupId">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">分组设置</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">将助手归类到不同分组，便于管理和查找</span>
                    </div>
                  </template>
                  <el-select v-model="characterForm.groupId" placeholder="请选择分组" clearable class="w-full max-w-md">
                    <el-option label="未分组" value="" />
                    <el-option v-for="group in characterGroups" :key="group.id" :label="group.name"
                      :value="group.id ?? ''" />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>
          </div>
        </el-tab-pane>

        <!-- 提示词 -->
        <el-tab-pane name="prompt" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <MessageOutlined />
              </el-icon>
              <span>提示词</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full flex flex-col flex-1">
            <div class="px-0 flex-1 flex flex-col min-h-0">
              <el-form ref="promptFormRef" :model="characterForm" :rules="promptRules" label-position="top"
                label-width="80px" size="large" class="flex-1 flex flex-col min-h-0">
                <el-form-item :show-label="false" :show-feedback="false" style="flex-shrink: 0;" class="no-border-item">
                  <div class="flex items-center w-full justify-between">
                    <span>系统系提示(角色设定)</span>
                    <div class="flex items-center">
                      <el-checkbox v-model="characterForm.useUserPrompt" class="ml-2">
                        使用User Role
                      </el-checkbox>
                      <el-tooltip content="启用后，系统将使用User角色而非System发送设定提示词，以优化部分模型的表现（如DeepSeek）" placement="top">
                        <el-icon class="cursor-help text-gray-400 hover:text-gray-600" size="16">
                          <QuestionCircleOutlined />
                        </el-icon>
                      </el-tooltip>
                    </div>

                  </div>
                </el-form-item>

                <!-- 详细设定 -->
                <el-form-item prop="systemPrompt" :show-label="false"
                  class="flex-1 min-h-40 prompt-form-item no-border-item">
                  <el-input v-model="characterForm.systemPrompt" type="textarea" placeholder="请输入详细设定" resize="none" />
                </el-form-item>

              </el-form>
            </div>
          </div>
        </el-tab-pane>

        <!-- 模型设置 -->
        <el-tab-pane name="model" v-if="!isSimpleStyle || true" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <RobotOutlined />
              </el-icon>
              <span>模型</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form ref="modelFormRef" :model="characterForm" :rules="modelRules" label-position="left"
                label-width="50%" size="large">
                <!-- 模型选择 -->
                <el-form-item prop="modelId">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">模型选择</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">为此助手指定专用的 AI
                        模型，留空则使用默认模型</span>
                    </div>
                  </template>
                  <el-select v-model="characterForm.modelId" :options="modelOptions" placeholder="请选择模型" clearable
                    class="w-full max-w-md">
                  </el-select>
                </el-form-item>

                <!-- 模型参数设置 -->
                <!-- 覆盖模型参数开关 -->
                <el-form-item prop="overrideModelParams">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">覆盖模型参数</span>
                      <span
                        class="text-xs text-gray-500 dark:text-gray-400 font-normal">关闭后使用模型本身的默认参数。除非你明确知道自己在干什么，否则保持默认关闭</span>
                    </div>
                  </template>
                  <el-switch v-model="characterForm.overrideModelParams" inline-prompt active-text="开启"
                    inactive-text="关闭" />
                </el-form-item>
                <template v-if="characterForm.overrideModelParams">
                  <!-- 温度设置 -->
                  <el-form-item prop="modelTemperature">
                    <template #label>
                      <div class="flex flex-col gap-1">
                        <span class="text-base text-gray-900 dark:text-gray-100 font-medium">温度</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">控制输出的随机性和创造性，值越高越富有创意</span>
                      </div>
                    </template>
                    <el-slider-optional v-model="characterForm.modelTemperature" :min="0" :max="1.9" :step="0.1"
                      show-input optional-direction="max" optional-text="Auto" class="w-full max-w-md" />
                  </el-form-item>

                  <!-- Top P -->
                  <el-form-item prop="modelTopP">
                    <template #label>
                      <div class="flex flex-col gap-1">
                        <span class="text-base text-gray-900 dark:text-gray-100 font-medium">Top P</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">核采样参数，控制输出词汇的多样性范围</span>
                      </div>
                    </template>
                    <el-slider-optional v-model="characterForm.modelTopP" :min="0" :max="1" :step="0.1" show-input
                      optional-direction="max" optional-text="Auto" class="w-full max-w-md" />
                  </el-form-item>

                  <!-- 频率惩罚 -->
                  <el-form-item prop="modelFrequencyPenalty">
                    <template #label>
                      <div class="flex flex-col gap-1">
                        <span class="text-base text-gray-900 dark:text-gray-100 font-medium">频率惩罚</span>
                        <span
                          class="text-xs text-gray-500 dark:text-gray-400 font-normal">降低重复内容的出现概率，正值减少重复，负值鼓励重复</span>
                      </div>
                    </template>
                    <el-slider-optional v-model="characterForm.modelFrequencyPenalty" :min="-1.9" :max="1.9" :step="0.1"
                      show-input optional-direction="max" optional-text="Auto" class="w-full max-w-md" />
                  </el-form-item>
                </template>
                <el-alert title="提示" type="warning" :closable="false" show-icon class="mb-4">
                  修改模型配置不会同步修改已经创建的会话。新会话将自动继承当前配置。
                </el-alert>
              </el-form>
            </div>
          </div>
        </el-tab-pane>

        <!-- 记忆与压缩 -->
        <el-tab-pane name="memory" v-if="!isSimpleStyle || true" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <DatabaseOutlined />
              </el-icon>
              <span>记忆</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form ref="memoryFormRef" :model="characterForm" label-position="left" label-width="50%" size="large">
                <!-- 上下文条数 -->
                <el-form-item prop="maxMemoryLength">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">上下文条数</span>
                      <span
                        class="text-xs text-gray-500 dark:text-gray-400 font-normal">控制对话历史的最大消息数量，影响模型的长期记忆能力</span>
                    </div>
                  </template>
                  <el-slider-optional v-model="characterForm.maxMemoryLength" :min="2" :max="500" :step="1" show-input
                    optional-direction="max" optional-text="No Limit" class="w-full max-w-md" />
                </el-form-item>

                <!-- Token 上限 -->
                <el-form-item prop="maxTokensLimit">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">Token 上限</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">设置 Token
                        使用上限，与模型上下文窗口取最小值作为压缩判断基准</span>
                    </div>
                  </template>
                  <div class="w-full max-w-md">
                    <el-input v-model="maxTokensLimitDisplay" placeholder="不限制" clearable @input="handleMaxTokensInput"
                      @blur="formatMaxTokensDisplay">
                      <template #suffix>
                        <span class="text-gray-400 text-sm">Tokens</span>
                      </template>
                    </el-input>
                    <div class="text-xs text-gray-400 mt-1">支持输入数字或带K/M后缀（如 128K、1M），留空表示不限制</div>
                  </div>
                </el-form-item>

                <!-- 压缩配置 -->
                <el-form-item label="触发阈值" prop="compressionTriggerRatio">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">触发阈值</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">当已用 Token
                        达到最大窗口的此比例时触发压缩</span>
                    </div>
                  </template>
                  <el-slider v-model="characterForm.compressionTriggerRatio" :min="0.5" :max="0.95" :step="0.05"
                    show-input :format-tooltip="formatSliderTooltip" class="w-full max-w-md" />
                </el-form-item>

                <el-form-item label="保留目标" prop="compressionTargetRatio">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">保留目标</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">压缩后保留至最大窗口的此比例</span>
                    </div>
                  </template>
                  <el-slider v-model="characterForm.compressionTargetRatio" :min="0.2" :max="0.8" :step="0.05"
                    show-input :format-tooltip="(val) => `${Math.round(val * 100)}%`" class="w-full max-w-md" />
                </el-form-item>

                <el-form-item label="启用摘要生成" prop="summaryMode">
                  <template #label>
                    <div class="flex flex-col gap-1">
                      <span class="text-base text-gray-900 dark:text-gray-100 font-medium">摘要模式</span>
                      <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">选择摘要生成方式：关闭、快速或记忆同步</span>
                    </div>
                  </template>
                  <div class="w-full max-w-md">
                    <el-select v-model="characterForm.summaryMode" placeholder="请选择摘要模式" class="w-full">
                      <el-option label="关闭摘要" value="disabled">
                        <span class="flex items-center gap-2">
                          <el-icon>
                            <CloseOutlined />
                          </el-icon>
                          <span>关闭摘要 - 仅裁剪工具结果，不生成语义摘要</span>
                        </span>
                      </el-option>
                      <el-option label="快速摘要" value="fast">
                        <span class="flex items-center gap-2">
                          <el-icon>
                            <ThunderboltOutlined />
                          </el-icon>
                          <span>快速摘要 - 单次调用生成，速度快</span>
                        </span>
                      </el-option>
                      <el-option label="记忆同步" value="memory_sync">
                        <span class="flex items-center gap-2">
                          <el-icon>
                            <FolderOutlined />
                          </el-icon>
                          <span>记忆同步 - 将历史对话压缩为结构化记忆，保持长期一致性</span>
                        </span>
                      </el-option>
                    </el-select>
                  </div>
                </el-form-item>

                <el-alert title="提示" type="info" :closable="false" show-icon class="mb-6">
                  <p class="text-sm">• 触发阈值：控制何时启动压缩（建议 70%-85%）</p>
                  <p class="text-sm">• 保留目标：控制压缩后的 Token 占用（建议 40%-60%）</p>
                  <p class="text-sm">• 记忆同步：开启后将历史对话压缩为结构化记忆，保持长期一致性；关闭后仅裁剪工具结果</p>
                </el-alert>
              </el-form>
            </div>
          </div>
        </el-tab-pane>

        <!-- 本地工具 -->
        <el-tab-pane name="local_tools" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <ToolOutlined />
              </el-icon>
              <span>本地工具</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top" size="large">
                <!-- 全部禁用与白名单模式 同一行左对齐 + 右对齐 -->
                <el-form-item>
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <el-switch :model-value="allDisabled" @update:model-value="handleAllDisabledToggle" inline-prompt
                        active-text="全部禁用" inactive-text="自定义" />
                      <span class="text-sm text-gray-500">禁用全部插件</span>
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allDisabled }]">
                      <span class="text-sm text-gray-500">新增插件默认开启</span>
                      <el-switch :model-value="!allowlistMode" @update:model-value="(v) => allowlistMode = !v"
                        :disabled="allDisabled" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="localTools.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>暂无可用的本地工具</div>
                  <div class="text-sm mt-2">请先到"插件 > 本地工具"中启用工具</div>
                </div>

                <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));">
                  <div v-for="tool in localTools" :key="tool.pluginId"
                    class="tool-item p-3 border rounded dark:border-[#232428]"
                    :class="{ 'opacity-50 pointer-events-none': allDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="font-medium text-sm flex-1 truncate">{{ tool.displayName }}</div>
                      <div class="flex items-center gap-2">
                        <el-switch :model-value="isToolProviderEnabled(tool.pluginId)"
                          @update:model-value="(val) => handleLocalToolToggle(tool.pluginId, val)"
                          :disabled="allDisabled" inline-prompt active-text="启动" inactive-text="禁用" size="default" />
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem] mb-2">{{ tool.description }}</p>
                    <div class="text-xs text-gray-400">
                      <el-tag size="small" type="info" effect="plain">
                        {{ tool.tools?.length || 0 }} 个工具
                      </el-tag>
                    </div>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </el-tab-pane>

        <!-- MCP 工具 -->
        <el-tab-pane name="mcp_tools" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <ApiOutlined />
              </el-icon>
              <span>MCP 工具</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top" size="large">
                <!-- MCP 全部禁用与白名单模式 同一行 -->
                <el-form-item>
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <el-switch :model-value="allMcpDisabled" @update:model-value="handleAllMcpDisabledToggle"
                        inline-prompt active-text="全部禁用" inactive-text="自定义" />
                      <span class="text-sm text-gray-500">禁用全部 MCP 工具</span>
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allMcpDisabled }]">
                      <span class="text-sm text-gray-500">新服务器默认启动</span>
                      <el-switch :model-value="!mcpAllowlistMode" @update:model-value="(v) => mcpAllowlistMode = !v"
                        :disabled="allMcpDisabled" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="mcpServers.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>暂无已启动的 MCP 服务器</div>
                </div>

                <div v-else>
                  <div v-for="server in mcpServers" :key="server.id"
                    class="mcp-server-item p-3 border rounded mb-3 dark:border-[#232428]"
                    :class="{ 'opacity-50': allMcpDisabled }">
                    <div class="flex items-start justify-between">
                      <div class="flex-1 mr-4">
                        <div class="font-medium text-base mb-1">
                          {{ server.name }}
                          <el-tag v-if="server.enabled" type="success" size="small" class="ml-2">
                            运行中
                          </el-tag>
                          <el-tag v-else type="info" size="small" class="ml-2">
                            未运行
                          </el-tag>
                        </div>
                        <div v-if="server.description" class="text-sm text-gray-600 line-clamp-2">
                          {{ server.description }}
                        </div>
                        <div v-if="server.tools && Object.keys(server.tools).length > 0"
                          class="text-sm text-gray-500 mt-2">
                          可用工具：{{ Object.keys(server.tools).length }} 个
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
        </el-tab-pane>

        <!-- Skills 技能 -->
        <el-tab-pane name="skills" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <Code24Regular />
              </el-icon>
              <span>Skills</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top" size="large">
                <!-- Skills 全部禁用与白名单模式 同一行 -->
                <el-form-item>
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <el-switch :model-value="allSkillsDisabled" @update:model-value="handleAllSkillsDisabledToggle"
                        inline-prompt active-text="全部禁用" inactive-text="自定义" />
                      <span class="text-sm text-gray-500">禁用全部 Skills</span>
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allSkillsDisabled }]">
                      <span class="text-sm text-gray-500">新技能默认启动</span>
                      <el-switch :model-value="!skillsAllowlistMode" @update:model-value="(v) => skillsAllowlistMode = !v"
                        :disabled="allSkillsDisabled" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="loadingSkills" class="text-center py-8">
                  <el-icon class="is-loading" size="24">
                    <LoadingOutlined />
                  </el-icon>
                  <div class="text-sm text-gray-500 mt-2">加载中...</div>
                </div>

                <div v-else-if="visibleSkills.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>暂无可用的 Skills</div>
                  <div class="text-sm mt-2">请先到"插件 > Skills"中安装技能</div>
                </div>

                <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
                  <div v-for="skill in visibleSkills" :key="skill.id"
                    class="skill-item p-3 border rounded dark:border-[#232428]"
                    :class="{ 'opacity-50 pointer-events-none': allSkillsDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="font-medium text-sm flex-1 truncate">{{ skill.manifest?.name || skill.id }}</div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <el-switch :model-value="getSkillEffectiveEnabled(skill)"
                          :loading="updatingSkills.has(skill.id)"
                          @update:model-value="(val) => handleSkillToggle(skill.id, val)" :disabled="allSkillsDisabled"
                          size="small" inline-prompt active-text="启用" inactive-text="禁用" />
                        <el-tag v-if="skill.source === 'system'" type="success" size="small" effect="light">内置</el-tag>
                        <el-tag v-if="skill.manifest?.version" type="info" size="small" effect="plain">v{{
                          skill.manifest.version }}</el-tag>
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{{ skill.manifest?.description || '暂无描述'
                      }}</p>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </el-tab-pane>

        <!-- 预设 Agent -->
        <el-tab-pane name="agent_presets" class="flex-1 overflow-hidden">
          <template #label>
            <div class="tab-label">
              <el-icon :size="18">
                <Bot24Regular />
              </el-icon>
              <span>预设 Agent</span>
            </div>
          </template>
          <div class="px-0 py-6 h-full overflow-y-auto">
            <div class="px-0">
              <el-form label-position="top" size="large">
                <!-- 全部禁用与白名单模式 同一行 -->
                <el-form-item>
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <el-switch :model-value="allAgentsDisabled" @update:model-value="handleAllAgentsDisabledToggle"
                        inline-prompt active-text="全部禁用" inactive-text="自定义" />
                      <span class="text-sm text-gray-500">禁用全部预设 Agent</span>
                    </div>
                    <div :class="['flex items-center gap-2', { 'opacity-50 pointer-events-none': allAgentsDisabled }]">
                      <span class="text-sm text-gray-500">新 Agent 默认启动</span>
                      <el-switch :model-value="!agentsAllowlistMode" @update:model-value="(v) => agentsAllowlistMode = !v"
                        :disabled="allAgentsDisabled" />
                    </div>
                  </div>
                </el-form-item>

                <div v-if="loadingAgents" class="text-center py-8">
                  <el-icon class="is-loading" size="24">
                    <LoadingOutlined />
                  </el-icon>
                  <div class="text-sm text-gray-500 mt-2">加载中...</div>
                </div>

                <div v-else-if="visibleAgents.length === 0" class="text-center text-gray-500 py-8">
                  <el-icon size="48" class="mb-2">
                    <InfoCircleOutlined />
                  </el-icon>
                  <div>暂无可用的预设 Agent</div>
                  <div class="text-sm mt-2">在 data/agents/ 目录中放入 .md 文件即可创建</div>
                </div>

                <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
                  <div v-for="agent in visibleAgents" :key="agent.id"
                    class="agent-item p-3 border rounded dark:border-[#232428]"
                    :class="{ 'opacity-50 pointer-events-none': allAgentsDisabled }">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="font-medium text-sm flex-1 truncate">{{ agent.emoji }} {{ agent.name }}</div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <el-switch :model-value="getAgentEffectiveEnabled(agent)"
                          @update:model-value="(val) => handleAgentToggle(agent.id, val)" :disabled="allAgentsDisabled"
                          size="small" inline-prompt active-text="启用" inactive-text="禁用" />
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{{ agent.description || '暂无描述' }}</p>
                  </div>
                </div>
              </el-form>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck - CharacterSettingPanel 组件复杂度高，临时使用@ts-nocheck
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import {
  ElTabs,
  ElTabPane,
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
  ElSwitch,
  ElDialog
} from 'element-plus'
import {
  QuestionCircleOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  UserOutlined,
  MessageOutlined,
  RobotOutlined,
  DatabaseOutlined,
  ToolOutlined,
  ApiOutlined,
  CloseOutlined,
  FolderOutlined,
  ThunderboltOutlined,
  SyncOutlined
} from '@vicons/antd'

import { Code24Regular, Bot24Regular } from '@vicons/fluent'

import { apiService } from '../../services/ApiService'


import { usePopup } from '../../composables/usePopup'
import AvatarPreview from '../ui/AvatarPreview.vue'
import ElSliderOptional from '../ui/ElSliderOptional.vue'
import { DEFAULT_SUMMARY_MODE } from '@/constants'

const { toast, notify } = usePopup()

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
        memoryType: null,
        modelTemperature: null,
        modelTopP: null,
        modelFrequencyPenalty: null,
        maxMemoryLength: null,
        useUserPrompt: false
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
const loading = ref(false)

// 模型数据
const models = ref([]);
const providers = ref([]);

// 表单引用
const basicFormRef = ref(null)
const promptFormRef = ref(null)
const modelFormRef = ref(null)
const memoryFormRef = ref(null)

const tabsValue = ref(props.tab)

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
  modelTemperature: null,
  modelTopP: null,
  modelFrequencyPenalty: null,
  overrideModelParams: false,
  maxMemoryLength: null,
  useUserPrompt: false,
  enabledTools: [],  // 启用的本地工具
  toolsMode: 'inherit',
  enabledSkills: {},       // 按角色启用的技能 { skillId: true/false }
  skillsMode: 'inherit',  // Skills 模式: 'inherit' | 'custom' | 'disabled'
  compressionTriggerRatio: 0.8, // 触发阈值
  compressionTargetRatio: 0.5, // 保留目标
  summaryMode: DEFAULT_SUMMARY_MODE, // 摘要模式：'disabled' | 'fast' | 'memory_sync'
  maxTokensLimit: null, // Token 上限（null 表示不限制）
})

// 验证规则
const basicRules = {
  title: [
    { required: true, message: '请输入角色标题', trigger: ['input', 'blur'] },
    { min: 2, max: 20, message: '标题长度在2-20个字符之间', trigger: ['input', 'blur'] }
  ]
}

const promptRules = {}

const modelRules = {
  // 模型改为可选项，移除必填验证
}

// 选项数据
// const modelOptions = [
//     { label: '默认/不设置', value: '' },
//     { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
//     { label: 'GPT-4', value: 'gpt-4' },
//     { label: 'Claude 2', value: 'claude-2' },
//     { label: 'Llama 2', value: 'llama-2' }
// ]

const memoryOptions = [
  { label: '滑动窗口', value: 'sliding_window' },
  { label: '摘要增强', value: 'summary_augmented_sliding_window' },
  { label: '滑动窗口+记忆检索', value: 'sliding_window_with_rag' },
  { label: '无记忆', value: 'memoryless' }
];

// 模型选择选项（按供应商分组）
const modelOptions = computed(() => {
  if (!models.value.length || !providers.value.length) return []

  const options = []

  // 添加"使用默认模型"选项
  options.push({
    label: '使用默认模型',
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
const loadingTools = ref(false);

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
// 是否全部禁用预设 Agent
const allAgentsDisabled = ref(false);
// Agent 白名单模式
const agentsAllowlistMode = ref(false);
// Agent 列表
const agentsList = ref([]);
const loadingAgents = ref(false);
// Agent 偏好 { agentId: true/false }
const enabledAgents = reactive<Record<string, boolean>>({});
// 面板可见的 Agent（过滤全局不可见的）
const visibleAgents = computed(() => {
  void agentsAllowlistMode.value;
  return agentsList.value.filter(agent => {
    if (!agent.visible) {
      if ((enabledAgents as any)[agent.id] === true) return true;
      return false;
    }
    return true;
  });
});
const maxTokensLimitDisplay = ref('');

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
  // 全部禁用时 switch 不改变原值，仅展示原状态，由后端策略控制
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
  characterForm.modelTemperature = newVal.settings?.modelTemperature ?? null;
  characterForm.modelTopP = newVal.settings?.modelTopP ?? null;
  characterForm.modelFrequencyPenalty = newVal.settings?.modelFrequencyPenalty ?? null;
  characterForm.overrideModelParams = newVal.settings?.overrideModelParams ?? false;
  characterForm.useUserPrompt = newVal.settings?.useUserPrompt || false;

  // 从 memory 分组加载记忆与压缩配置
  const memoryConfig = newVal.settings?.memory || {};
  characterForm.maxMemoryLength = memoryConfig.maxMemoryLength ?? newVal.settings?.maxMemoryLength ?? null;
  characterForm.compressionTriggerRatio = memoryConfig.compressionTriggerRatio ?? newVal.settings?.compressionTriggerRatio ?? 0.8;
  characterForm.compressionTargetRatio = memoryConfig.compressionTargetRatio ?? newVal.settings?.compressionTargetRatio ?? 0.5;
  characterForm.summaryMode = memoryConfig.summaryMode ?? DEFAULT_SUMMARY_MODE; // 默认记忆同步模式
  characterForm.maxTokensLimit = memoryConfig.maxTokensLimit ?? newVal.settings?.maxTokensLimit ?? null;
  // 同步更新显示值
  maxTokensLimitDisplay.value = formatTokenValue(characterForm.maxTokensLimit);
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
        characterToolSettings.value[pluginId] = (cfg as any).enabled !== false;
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

  // 加载预设 Agent 偏好
  allAgentsDisabled.value = newVal.settings?.plugins?.agent_presets?.enabled === false;
  const agentsConfig = newVal.settings?.agents;
  agentsAllowlistMode.value = agentsConfig?.__default === false;
  // 重建 enabledAgents
  for (const key of Object.keys(enabledAgents)) delete (enabledAgents as any)[key];
  if (typeof agentsConfig === 'object' && !Array.isArray(agentsConfig)) {
    for (const [agentId, val] of Object.entries(agentsConfig)) {
      if (agentId === '__default') continue;
      (enabledAgents as any)[agentId] = val;
    }
  }

  // 加载本地工具列表
  // 新角色：立即 query（immediate）；编辑角色：数据从未加载 → 已加载时 query；弹窗重开：immediate 时已有数据 → query
  if (props.isNew || (newVal?.id && !oldVal?.id)) {
    loadLocalTools();
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

// ── 预设 Agent ──
const getAgentEffectiveEnabled = (agent) => {
  if (agent.id in enabledAgents) return (enabledAgents as any)[agent.id];
  return agent.visible !== false;
};
const handleAgentToggle = (agentId, enabled) => {
  (enabledAgents as any)[agentId] = enabled;
};
const handleAllAgentsDisabledToggle = async (val) => {
  allAgentsDisabled.value = val;
};
const loadAgents = async () => {
  loadingAgents.value = true;
  try {
    const response = await apiService.fetchAgents();
    agentsList.value = Array.isArray(response) ? response : (response.agents || []);
    // 白名单模式：未配置的 agent 初始化为关闭
    if (agentsAllowlistMode.value) {
      for (const agent of agentsList.value) {
        if (!(agent.id in enabledAgents)) {
          (enabledAgents as any)[agent.id] = false;
        }
      }
    }
  } catch (err) {
    console.error('加载预设 Agent 失败:', err);
  } finally {
    loadingAgents.value = false;
  }
};

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
    toast.error('加载本地工具失败');
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

const loadSkills = async () => {
  loadingSkills.value = true;
  try {
    const response = await apiService.fetchSkills();
    skillsList.value = Array.isArray(response?.items)
      ? response.items.filter(s => s.enabled !== false)
      : [];
    // 白名单模式：未在 enabledSkills 中的技能初始化显示为关闭
    if (skillsAllowlistMode.value) {
      for (const skill of skillsList.value) {
        if (!(skill.id in characterForm.enabledSkills)) {
          characterForm.enabledSkills[skill.id] = false;
        }
      }
    }
  } catch (err) {
    console.error('加载 Skills 失败:', err);
  } finally {
    loadingSkills.value = false;
  }
};

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
    notify.error('获取模型列表失败', error)
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

// 加载角色分组列表
const loadCharacterGroups = async () => {
  try {
    characterGroups.value = await apiService.fetchCharacterGroups()
  } catch (error) {
    console.error('获取角色分组列表失败:', error)
  }
}

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
  // if (!isSimpleStyle.value)
  loadModels();
  loadMCPServers();
  loadSkills();
  loadAgents();
  loadCharacterGroups();  // 加载分组列表
  // query 由 watch 统一接管（immediate + isNew 判断）
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
      'modelTemperature': characterForm.modelTemperature,
      'modelTopP': characterForm.modelTopP,
      'modelFrequencyPenalty': characterForm.modelFrequencyPenalty,
      'overrideModelParams': characterForm.overrideModelParams,
      'useUserPrompt': characterForm.useUserPrompt,
      // 记忆与压缩配置分组
      'memory': {
        'maxMemoryLength': characterForm.maxMemoryLength,
        'compressionTriggerRatio': characterForm.compressionTriggerRatio,
        'compressionTargetRatio': characterForm.compressionTargetRatio,
        'summaryMode': characterForm.summaryMode,
        'maxTokensLimit': characterForm.maxTokensLimit,
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
          result.agent_presets = { enabled: !allAgentsDisabled.value };
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
      // 预设 Agent 配置（按模式保存）
      'agents': (() => {
        const agentsOut: Record<string, any> = {};
        for (const agent of visibleAgents.value) {
          const effectiveEnabled = (enabledAgents as any)[agent.id] ?? agent.visible !== false;
          if (agentsAllowlistMode.value) {
            if (effectiveEnabled) agentsOut[agent.id] = true;
          } else {
            if (!effectiveEnabled) agentsOut[agent.id] = false;
          }
        }
        if (agentsAllowlistMode.value) {
          agentsOut.__default = false;
        }
        return Object.keys(agentsOut).length > 0 ? agentsOut : undefined;
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
      modelFormRef.value?.validate(),
      memoryFormRef.value?.validate(),
    ]
    const validationResults = await Promise.allSettled(formValidates)
    const hasError = validationResults.some(result => result.status === 'rejected')

    if (hasError) {
      const firstErrorIndex = validationResults.findIndex(result => result.status === 'rejected')
      if (firstErrorIndex !== -1) {
        const tabNames = ['basic', 'prompt', 'model', 'memory']
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

function format(value) {
  if (value === null || value === "")
    return "不限制";
  return value.toLocaleString("en-US");
}

/**
 * 格式化 Token 值为显示字符串
 * @param value - Token 数值或 null
 * @returns 格式化后的字符串（如 "128K"、"1M" 或 "50,000"）
 */
function formatTokenValue(value) {
  if (!value) return '';
  const num = Number(value);
  if (isNaN(num)) return '';

  // 如果大于等于 1,000,000 且是整百万，使用 M 后缀
  if (num >= 1000000 && num % 1000000 === 0) {
    return (num / 1000000) + 'M';
  }
  // 如果大于等于 1000 且是整千，使用 K 后缀
  if (num >= 1000 && num % 1000 === 0) {
    return (num / 1000) + 'K';
  }
  // 否则使用千位分隔符
  return num.toLocaleString();
}

/**
 * 解析用户输入的 Token 值
 * @param input - 用户输入的字符串
 * @returns 解析后的数字或 null
 */
function parseTokenValue(input) {
  if (!input || input.trim() === '') return null;

  const trimmed = input.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  // 支持 M/m 后缀（百万）
  if (lowerTrimmed.endsWith('m')) {
    const numStr = trimmed.slice(0, -1).replace(/,/g, '');
    const num = Number(numStr);
    if (isNaN(num)) return null;
    return Math.round(num * 1000000);
  }

  // 支持 K/k 后缀（千）
  if (lowerTrimmed.endsWith('k')) {
    const numStr = trimmed.slice(0, -1).replace(/,/g, '');
    const num = Number(numStr);
    if (isNaN(num)) return null;
    return Math.round(num * 1000);
  }

  // 普通数字（可能带逗号）
  const cleanStr = trimmed.replace(/,/g, '');
  const num = Number(cleanStr);
  return isNaN(num) ? null : num;
}

/**
 * 处理 Token 上限输入
 */
function handleMaxTokensInput(value) {
  const parsed = parseTokenValue(value);
  characterForm.maxTokensLimit = parsed;
}

/**
 * 失焦时格式化显示
 */
function formatMaxTokensDisplay() {
  maxTokensLimitDisplay.value = formatTokenValue(characterForm.maxTokensLimit);
}

// 清除头像文件（上传成功后由父组件调用）
const clearAvatarFile = () => {
  characterForm.avatarFile = null;
}

// 暴露方法给父组件
defineExpose({
  clearAvatarFile,
  validate,
  getFormData
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

.tool-item:hover {
  border-color: var(--el-color-primary);
  background-color: var(--el-fill-color-lighter);
}

.skill-item {
  transition: all 0.2s;
}

.skill-item:hover {
  border-color: var(--el-color-primary-light-5);
  background-color: var(--el-fill-color-lighter);
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

/* 工具配置对话框样式优化 */
:deep(.tool-config-dialog .el-dialog__body) {
  max-height: 60vh;
  overflow-y: auto;
}

:deep(.tool-config-dialog .el-dialog__header) {
  padding-right: 40px;
}

.mcp-server-item {
  transition: all 0.2s;
}

.mcp-server-item:hover {
  border-color: var(--el-color-primary-light-5);
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

/* Tab 内容区域优化 - 使用 flex 布局而不是固定高度 */
:deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  /* 关键：允许 flex 子项正确收缩 */
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
}

:deep(.el-tab-pane) {
  height: 100%;
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

/* 提示词Tab去除表单项分隔线 */
.el-tab-pane[name="prompt"] .el-form-item {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 16px !important;
}

/* 无横线表单项(用于提示词Tab) */
.no-border-item {
  border-bottom: none !important;
  padding-bottom: 0 !important;
}

/* 表单项之间的分隔线 */
.el-form-item {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 20px;
  margin-bottom: 20px !important;
}

/* 最后一个表单项去除底边框 */
.el-form>.el-form-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0 !important;
}

/* Tab 标签样式优化 */
.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
}

.character-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  padding: 0 20px;
  height: 48px;
  line-height: 48px;
}

.character-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
  border-bottom: 1px solid var(--el-border-color-light);
}

.character-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 0;
}
</style>