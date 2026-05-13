<template>
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
                  <el-option v-for="group in characterGroups" :key="group.id" :label="group.name" :value="group.id" />
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
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">为此助手指定专用的 AI 模型，留空则使用默认模型</span>
                  </div>
                </template>
                <el-select v-model="characterForm.modelId" :options="modelOptions" placeholder="请选择模型" clearable
                  class="w-full max-w-md">
                </el-select>
              </el-form-item>

              <!-- 模型参数设置 (折叠面板) -->
              <el-collapse v-model="activeModelParams" class="mb-6">
                <el-collapse-item name="params">
                  <template #title>
                    <div class="flex items-center gap-2 text-base font-medium">
                      <el-icon>
                        <SettingOutlined />
                      </el-icon>
                      <span>模型参数设置</span>
                    </div>
                  </template>
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
                </el-collapse-item>
              </el-collapse>
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
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">控制对话历史的最大消息数量，影响模型的长期记忆能力</span>
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
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">当已用 Token 达到最大窗口的此比例时触发压缩</span>
                  </div>
                </template>
                <el-slider v-model="characterForm.compressionTriggerRatio" :min="0.5" :max="0.95" :step="0.05"
                  show-input format-tooltip="(val) => `${Math.round(val * 100)}%`" class="w-full max-w-md" />
              </el-form-item>

              <el-form-item label="保留目标" prop="compressionTargetRatio">
                <template #label>
                  <div class="flex flex-col gap-1">
                    <span class="text-base text-gray-900 dark:text-gray-100 font-medium">保留目标</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">压缩后保留至最大窗口的此比例</span>
                  </div>
                </template>
                <el-slider v-model="characterForm.compressionTargetRatio" :min="0.2" :max="0.8" :step="0.05" show-input
                  format-tooltip="(val) => `${Math.round(val * 100)}%`" class="w-full max-w-md" />
              </el-form-item>

              <el-form-item label="启用摘要生成" prop="summaryMode">
                <template #label>
                  <div class="flex flex-col gap-1">
                    <span class="text-base text-gray-900 dark:text-gray-100 font-medium">摘要模式</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">选择摘要生成方式：关闭、快速或迭代优化</span>
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
                    <el-option label="迭代摘要" value="iterative">
                      <span class="flex items-center gap-2">
                        <el-icon>
                          <SyncOutlined />
                        </el-icon>
                        <span>迭代摘要 - 多轮优化，质量最高但耗时较长</span>
                      </span>
                    </el-option>
                  </el-select>
                </div>
              </el-form-item>

              <el-alert title="提示" type="info" :closable="false" show-icon class="mb-6">
                <p class="text-sm">• 触发阈值：控制何时启动压缩（建议 70%-85%）</p>
                <p class="text-sm">• 保留目标：控制压缩后的 Token 占用（建议 40%-60%）</p>
                <p class="text-sm">• 启用摘要：关闭后将仅裁剪工具结果，不生成语义摘要</p>
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
              <!-- 全局开关 -->
              <el-form-item label="自动启用全部工具" label-position="left">
                <div class="flex items-center gap-2">
                  <el-tooltip content="开启后，角色将自动使用所有全局启用的工具，无需逐个选择" placement="top">
                    <el-icon class="cursor-help text-gray-400 hover:text-gray-600" size="16">
                      <QuestionCircleOutlined />
                    </el-icon>
                  </el-tooltip>
                  <el-switch :model-value="allToolsEnabled" @update:model-value="handleAllToolsToggle" inline-prompt
                    active-text="开" inactive-text="关" />
                </div>
              </el-form-item>

              <el-alert title="工具说明" type="info" :closable="false" class="mb-4" show-icon>
                <p class="text-sm" v-if="allToolsEnabled">
                  当前已启用所有全局允许的工具，下方列表仅供参考
                </p>
                <p class="text-sm" v-else>
                  只有在全局设置中启用的工具才会显示在这里。您可以进一步选择启用或禁用这些工具。
                </p>
              </el-alert>

              <div v-if="loadingTools" class="text-center py-8">
                <el-icon class="is-loading" size="24">
                  <LoadingOutlined />
                </el-icon>
                <div class="text-sm text-gray-500 mt-2">加载中...</div>
              </div>

              <div v-else-if="localTools.length === 0" class="text-center text-gray-500 py-8">
                <el-icon size="48" class="mb-2">
                  <InfoCircleOutlined />
                </el-icon>
                <div>暂无可用的本地工具</div>
                <div class="text-sm mt-2">请先到"插件 > 本地工具"中启用工具</div>
              </div>

              <div v-else>
                <!-- 网格布局：每行3列 -->
                <div class="grid grid-cols-3 gap-3">
                  <div v-for="tool in localTools" :key="tool.namespace" class="tool-item p-3 border rounded relative">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="font-medium text-sm flex-1 truncate">{{ tool.displayName }}</div>
                      <div class="flex items-center gap-2">
                        <!-- 设置按钮 -->
                        <el-tooltip content="配置子工具" placement="top">
                          <el-icon class="cursor-pointer text-gray-400 hover:text-blue-500 transition-colors" size="16"
                            @click="openToolConfig(tool)">
                            <SettingOutlined />
                          </el-icon>
                        </el-tooltip>
                        <el-switch v-if="!allToolsEnabled" :model-value="isToolProviderEnabled(tool.namespace)"
                          @update:model-value="handleLocalToolToggle(tool.namespace, $event)" inline-prompt
                          active-text="启动" inactive-text="禁用" size="default" />
                        <el-tag v-else type="primary" size="small">已启用</el-tag>
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem] mb-2">{{ tool.description }}</p>
                    <div v-if="allToolsEnabled" class="text-xs text-blue-500">
                      ✓ 已自动启用
                    </div>
                    <div v-else class="text-xs text-gray-400">
                      <el-tag size="small" type="info" effect="plain">
                        {{ tool.tools?.length || 0 }} 个工具
                      </el-tag>
                    </div>
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
              <!-- MCP 全局开关 -->
              <el-form-item label="自动启用全部MCP服务器" label-position="left">
                <div class="flex items-center gap-2">
                  <el-tooltip content="开启后，角色将自动使用所有已启用的MCP服务器及其工具，无需逐个选择" placement="top">
                    <el-icon class="cursor-help text-gray-400 hover:text-gray-600" size="16">
                      <QuestionCircleOutlined />
                    </el-icon>
                  </el-tooltip>
                  <el-switch :model-value="characterForm.enabledMcpServers === true"
                    @update:model-value="handleMcpGlobalToggle" inline-prompt active-text="开" inactive-text="关" />
                </div>
              </el-form-item>

              <el-alert title="MCP 服务说明" type="info" :closable="false" class="mb-4" show-icon>
                <p class="text-sm" v-if="characterForm.enabledMcpServers === true">
                  当前已启用所有MCP服务器，下方列表仅供参考
                </p>
                <p class="text-sm" v-else>
                  启用表示此角色可以使用该 MCP 服务，禁用不会影响其他角色或全局 MCP 服务
                </p>
              </el-alert>

              <div v-if="mcpServers.length === 0" class="text-center text-gray-500 py-8">
                <el-icon size="48" class="mb-2">
                  <InfoCircleOutlined />
                </el-icon>
                <div>暂无已启动的 MCP 服务器</div>
              </div>

              <div v-else>
                <div v-for="server in mcpServers" :key="server.id" class="mcp-server-item p-3 border rounded mb-3">
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
                        <el-tag v-if="characterForm.enabledMcpServers === true" type="primary" size="small"
                          class="ml-2">
                          已自动启用
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
                    <el-switch v-if="characterForm.enabledMcpServers !== true"
                      :model-value="Array.isArray(characterForm.enabledMcpServers) && characterForm.enabledMcpServers.includes(server.id)"
                      @update:model-value="handleMcpServerToggle(server.id, $event)" :disabled="!server.enabled" />
                  </div>
                </div>
              </div>
            </el-form>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>

  <!-- 工具配置对话框 -->
  <el-dialog v-model="toolConfigDialogVisible" :title="`${currentToolConfig?.displayName || ''} - 子工具配置`" width="600px"
    destroy-on-close class="tool-config-dialog">
    <div v-if="currentToolConfig" class="py-2">
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-gray-600">启动全部工具</span>
        <el-switch :model-value="isUsingGlobalToggle" @update:model-value="handleAllSubToolsToggle" inline-prompt
          active-text="启用" inactive-text="禁用" />
      </div>

      <div v-if="!currentToolConfig.tools || currentToolConfig.tools.length === 0"
        class="text-center text-gray-500 py-8">
        暂无子工具配置
      </div>

      <div v-else class="tool-config-list">
        <div v-for="subTool in currentToolConfig.tools" :key="subTool.name" class="tool-config-item">
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-1 flex-1 min-w-0">
              <span class="font-medium text-sm break-words">{{ getToolDisplayName(subTool.name) }}</span>
              <span v-if="subTool.description" class="text-xs text-gray-500 break-words whitespace-normal">{{
                subTool.description }}</span>
            </div>
            <el-switch v-if="!isUsingGlobalToggle"
              :model-value="selectedSubTools.includes(getToolDisplayName(subTool.name))"
              @update:model-value="handleSubToolToggle(getToolDisplayName(subTool.name), $event)" inline-prompt
              active-text="启用" inactive-text="禁用" />
            <el-tag v-else type="success" size="small">已启用</el-tag>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="toolConfigDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveToolConfig">确定</el-button>
      </div>
    </template>
  </el-dialog>

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
  SettingOutlined,
  CloseOutlined,
  ThunderboltOutlined,
  SyncOutlined
} from '@vicons/antd'

import { apiService } from '../../services/ApiService'


import { usePopup } from '../../composables/usePopup'
import AvatarPreview from '../ui/AvatarPreview.vue'
import ElSliderOptional from '../ui/ElSliderOptional.vue'

const { toast, notify } = usePopup()

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
        modelId: null,
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
const activeModelParams = ref([]) // 默认折叠模型参数

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
  maxMemoryLength: null,
  useUserPrompt: false,
  enabledTools: [],  // 启用的本地工具
  enabledMcpServers: [],  // 启用的 MCP 服务器 ID 数组
  compressionTriggerRatio: 0.8, // 触发阈值
  compressionTargetRatio: 0.5, // 保留目标
  summaryMode: 'fast', // 摘要模式：'disabled' | 'fast' | 'iterative'
  maxTokensLimit: null, // Token 上限（null 表示不限制）
})

// 验证规则
const basicRules = {
  title: [
    { required: true, message: '请输入角色标题', trigger: ['input', 'blur'] },
    { min: 2, max: 20, message: '标题长度在2-20个字符之间', trigger: ['input', 'blur'] }
  ]
}

const promptRules = {
  systemPrompt: [
    { min: 2, max: 8000, message: '详细设定长度在8000个字符之间', trigger: ['input', 'blur'] }
  ]
}

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
    value: null,
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

// MCP 服务器数据
const mcpServers = ref([]);

// 角色分组数据
const characterGroups = ref([]);

// 本地工具数据
const localTools = ref([]);
const loadingTools = ref(false);

// 角色工具设置（namespace -> boolean | 'all'）
const characterToolSettings = ref({});

// Token 上限显示值（用于格式化显示）
const maxTokensLimitDisplay = ref('');

// 工具配置对话框
const toolConfigDialogVisible = ref(false);
const currentToolConfig = ref<any>(null);
const selectedSubTools = ref<string[]>([]);
// 标记是否通过“启动全部”开关启用（用于区分手动选择和全局启用）
const isUsingGlobalToggle = ref(false);

// 是否自动启用全部工具
const allToolsEnabled = computed(() => {
  // 如果角色工具配置为 true，则认为启用了全部工具
  return characterToolSettings.value === true;
});

// 判断某个工具提供者是否启用（用于 Switch 显示）
const isToolProviderEnabled = (namespace) => {
  // 如果 characterToolSettings 是布尔值，直接返回
  if (typeof characterToolSettings.value === 'boolean') {
    return characterToolSettings.value;
  }

  const config = characterToolSettings.value[namespace];

  // true 表示全部启用
  if (config === true) return true;

  // false 表示全部禁用
  if (config === false) return false;

  // 数组表示部分启用，数组长度 > 0 表示启用
  if (Array.isArray(config)) return config.length > 0;

  // 默认禁用（当配置为对象但某个 namespace 未配置时）
  return false;
};

// 监听 props.data 变化
watch(() => props.data, (newVal) => {
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
  characterForm.modelId = newVal.modelId || null;

  characterForm.assistantName = newVal.settings?.assistantName || '';
  characterForm.assistantIdentity = newVal.settings?.assistantIdentity || '';
  characterForm.systemPrompt = newVal.settings?.systemPrompt || '';
  characterForm.memoryType = newVal.settings?.memoryType || 'sliding_window';
  characterForm.modelTemperature = newVal.settings?.modelTemperature || null;
  characterForm.modelTopP = newVal.settings?.modelTopP || null;
  characterForm.modelFrequencyPenalty = newVal.settings?.modelFrequencyPenalty || null;
  characterForm.useUserPrompt = newVal.settings?.useUserPrompt || false;

  // 从 memory 分组加载记忆与压缩配置
  const memoryConfig = newVal.settings?.memory || {};
  characterForm.maxMemoryLength = memoryConfig.maxMemoryLength ?? newVal.settings?.maxMemoryLength ?? null;
  characterForm.compressionTriggerRatio = memoryConfig.compressionTriggerRatio ?? newVal.settings?.compressionTriggerRatio ?? 0.8;
  characterForm.compressionTargetRatio = memoryConfig.compressionTargetRatio ?? newVal.settings?.compressionTargetRatio ?? 0.5;
  characterForm.summaryMode = memoryConfig.summaryMode ?? 'fast'; // 默认快速模式
  characterForm.maxTokensLimit = memoryConfig.maxTokensLimit ?? newVal.settings?.maxTokensLimit ?? null;
  // 同步更新显示值
  maxTokensLimitDisplay.value = formatTokenValue(characterForm.maxTokensLimit);
  // 加载已启用的工具
  characterForm.enabledTools = newVal.settings?.tools || [];
  // 加载角色工具设置
  const toolsConfig = newVal.settings?.tools;
  if (toolsConfig === true || toolsConfig === false) {
    // 整体开关模式
    characterToolSettings.value = toolsConfig;
  } else if (typeof toolsConfig === 'object' && !Array.isArray(toolsConfig)) {
    // 单独控制模式
    characterToolSettings.value = { ...toolsConfig };
  } else {
    // 默认关闭全部
    characterToolSettings.value = false;
  }
  // 加载已启用的 MCP 服务器 (支持 boolean 或 array)
  const mcpServersConfig = newVal.settings?.mcpServers;
  if (typeof mcpServersConfig === 'boolean') {
    characterForm.enabledMcpServers = mcpServersConfig;
  } else if (Array.isArray(mcpServersConfig)) {
    characterForm.enabledMcpServers = mcpServersConfig;
  } else {
    characterForm.enabledMcpServers = [];
  }

}, { immediate: true })

const handleAvatarChanged = (file) => {
  characterForm.avatarFile = file
}

// MCP 服务器开关切换处理
const handleMcpServerToggle = (serverId, enabled) => {
  // 如果当前是全局启用模式，不允许单独切换
  if (characterForm.enabledMcpServers === true) {
    console.warn('当前为全局启用模式，无法单独切换服务器');
    return;
  }

  const index = characterForm.enabledMcpServers.indexOf(serverId);
  if (enabled && index === -1) {
    // 启用：添加到数组
    characterForm.enabledMcpServers.push(serverId);
  } else if (!enabled && index !== -1) {
    // 禁用：从数组移除
    characterForm.enabledMcpServers.splice(index, 1);
  }
  console.log(`MCP 服务器 ${serverId} ${enabled ? '启用' : '禁用'}, 当前列表:`, characterForm.enabledMcpServers);
}

// MCP 全局开关切换处理
const handleMcpGlobalToggle = (enabled) => {
  if (enabled) {
    // 开启全局启用
    characterForm.enabledMcpServers = true;
    console.log('MCP 全局启用已开启');
  } else {
    // 关闭全局启用，初始化为空数组
    characterForm.enabledMcpServers = [];
    console.log('MCP 全局启用已关闭，需要手动选择服务器');
  }
}

// 加载本地工具列表
const loadLocalTools = async () => {
  if (!props.data?.id) {
    return;
  }

  loadingTools.value = true;
  try {
    const response = await apiService.fetchCharacterTools(props.data.id);
    // 只显示全局启用的工具
    localTools.value = (response.tools || []).filter(tool => tool.enabled);

    // 初始化角色工具设置
    const toolsConfig = response.characterTools;
    if (toolsConfig === true || toolsConfig === false) {
      // 整体开关模式
      characterToolSettings.value = toolsConfig;
    } else if (typeof toolsConfig === 'object') {
      // 单独控制模式
      characterToolSettings.value = { ...toolsConfig };
    } else {
      // 默认启用全部
      characterToolSettings.value = false;
    }
  } catch (error) {
    console.error('加载本地工具失败:', error);
    toast.error('加载本地工具失败');
  } finally {
    loadingTools.value = false;
  }
}

// 全部工具开关切换处理
const handleAllToolsToggle = (enabled) => {
  // 直接设置为布尔值，保存到数据库时也是布尔值
  characterToolSettings.value = enabled;
  console.log(`角色工具整体${enabled ? '启用' : '禁用'}`);
}

// 本地工具开关切换处理
const handleLocalToolToggle = (namespace, enabled) => {
  // 只更新本地状态，不立即调用 API
  if (typeof characterToolSettings.value !== 'object') {
    // 如果之前是整体开关模式，转换为对象模式
    characterToolSettings.value = {};
  }
  characterToolSettings.value[namespace] = enabled;
  console.log(`本地工具 ${namespace} ${enabled ? '启用' : '禁用'}`);
}

// 打开工具配置对话框
const openToolConfig = (tool) => {
  currentToolConfig.value = tool;

  // 获取当前配置
  let config;
  if (typeof characterToolSettings.value === 'boolean') {
    // 整体开关模式：所有工具都使用同一个配置
    config = characterToolSettings.value;
  } else if (typeof characterToolSettings.value === 'object') {
    // 单独控制模式：取对应 namespace 的配置
    config = characterToolSettings.value[tool.namespace];
  } else {
    // 其他情况：默认为 undefined
    config = undefined;
  }

  // 初始化选中的子工具列表（使用去除前缀后的名称）
  if (config === true) {
    // 明确设置为 true：全部启用，标记为使用全局开关
    selectedSubTools.value = (tool.tools || []).map(t => getToolDisplayName(t.name));
    isUsingGlobalToggle.value = true;
  } else if (config === undefined) {
    // 未配置：默认全部启用，但不标记为使用全局开关（保持灵活性）
    selectedSubTools.value = (tool.tools || []).map(t => getToolDisplayName(t.name));
    isUsingGlobalToggle.value = false;
  } else if (config === false) {
    // 全部禁用：不选中任何工具
    selectedSubTools.value = [];
    isUsingGlobalToggle.value = false;
  } else if (Array.isArray(config)) {
    // 数组模式：直接使用数组中的工具名（已经是去除前缀的）
    selectedSubTools.value = [...config];
    isUsingGlobalToggle.value = false;
  } else if (typeof config === 'object') {
    // 对象模式：提取值为 true 的工具（需要去除前缀）
    selectedSubTools.value = Object.entries(config)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => getToolDisplayName(name));
    isUsingGlobalToggle.value = false;
  } else {
    // 其他情况：默认全部选中
    selectedSubTools.value = (tool.tools || []).map(t => getToolDisplayName(t.name));
    isUsingGlobalToggle.value = false;
  }

  toolConfigDialogVisible.value = true;
};

// 保存工具配置
const saveToolConfig = () => {
  if (!currentToolConfig.value) return;

  const namespace = currentToolConfig.value.namespace;
  const allTools = (currentToolConfig.value.tools || []).map(t => t.name);

  // 确保是对象模式
  if (typeof characterToolSettings.value !== 'object' || Array.isArray(characterToolSettings.value)) {
    characterToolSettings.value = {};
  }

  // 判断是否全部选中
  if (selectedSubTools.value.length === 0) {
    // 全部未选中：设置为 false
    characterToolSettings.value[namespace] = false;
  } else if (selectedSubTools.value.length === allTools.length && selectedSubTools.value.length > 0) {
    // 全部选中：根据是否使用全局开关决定保存方式
    if (isUsingGlobalToggle.value) {
      // 通过"启动全部"开关启用：设置为 true，新增工具自动启用
      characterToolSettings.value[namespace] = true;
    } else {
      // 手动逐个选择全部：保持数组形式，新增工具默认禁用
      characterToolSettings.value[namespace] = [...selectedSubTools.value];
    }
  } else {
    // 部分选中：保存为数组
    characterToolSettings.value[namespace] = [...selectedSubTools.value];
  }

  toolConfigDialogVisible.value = false;
};

// 处理单个子工具开关切换
const handleSubToolToggle = (toolName, enabled) => {
  const index = selectedSubTools.value.indexOf(toolName);

  if (enabled && index === -1) {
    // 启用：添加到数组
    selectedSubTools.value.push(toolName);
  } else if (!enabled && index !== -1) {
    // 禁用：从数组移除
    selectedSubTools.value.splice(index, 1);
  }

  // 如果用户手动调整了单个工具，取消全局开关标记
  isUsingGlobalToggle.value = false;
};

// 判断是否所有子工具都被选中
const isAllSubToolsSelected = computed(() => {
  if (!currentToolConfig.value || !currentToolConfig.value.tools) return false;
  const allTools = currentToolConfig.value.tools.map(t => t.name);
  return selectedSubTools.value.length === allTools.length && allTools.length > 0;
});

// 处理全部子工具开关切换
const handleAllSubToolsToggle = (enabled) => {
  if (!currentToolConfig.value || !currentToolConfig.value.tools) return;

  // 使用去除前缀后的工具名称
  const allTools = currentToolConfig.value.tools.map(t => getToolDisplayName(t.name));

  if (enabled) {
    // 启用全部：选中所有工具，并标记为使用全局开关
    selectedSubTools.value = [...allTools];
    isUsingGlobalToggle.value = true;
  } else {
    // 禁用全部：清空选择
    selectedSubTools.value = [];
    isUsingGlobalToggle.value = false;
  }
};

// 获取工具的显示名称（去除 namespace 前缀）
const getToolDisplayName = (toolName) => {
  if (!toolName) return '';
  // 检查是否包含 __ 前缀（如 shell__execute_command）
  const parts = toolName.split('__');
  // 如果有前缀且前缀长度 > 1，返回第二部分
  if (parts.length > 1 && parts[0].length > 0) {
    return parts.slice(1).join('__');
  }
  // 否则直接返回原名称
  return toolName;
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

// 监听 props.data.id 变化，重新加载工具列表
watch(() => props.data?.id, async (newVal, oldVal) => {
  if (newVal && newVal !== oldVal) {
    console.log('角色ID变化，重新加载工具列表:', newVal);
    await loadLocalTools();
  }
}, { immediate: true });

// 生命周期
onMounted(async () => {
  // if (!isSimpleStyle.value)
  loadModels();
  loadMCPServers();
  loadCharacterGroups();  // 加载分组列表
  // 注意：工具列表由 watch 自动加载（immediate: true）
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
    'modelId': characterForm.modelId,
    'settings': {
      'assistantName': characterForm.assistantName,
      'assistantIdentity': characterForm.assistantIdentity,
      'systemPrompt': characterForm.systemPrompt,
      'memoryType': characterForm.memoryType,
      'modelTemperature': characterForm.modelTemperature,
      'modelTopP': characterForm.modelTopP,
      'modelFrequencyPenalty': characterForm.modelFrequencyPenalty,
      'useUserPrompt': characterForm.useUserPrompt,
      // 记忆与压缩配置分组
      'memory': {
        'maxMemoryLength': characterForm.maxMemoryLength,
        'compressionTriggerRatio': characterForm.compressionTriggerRatio,
        'compressionTargetRatio': characterForm.compressionTargetRatio,
        'summaryMode': characterForm.summaryMode,
        'maxTokensLimit': characterForm.maxTokensLimit,
      },
      'tools': characterToolSettings.value,
      'mcpServers': characterForm.enabledMcpServers,
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
  background-color: #f5f7fa;
}

/* 工具配置对话框样式 */
.tool-config-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
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