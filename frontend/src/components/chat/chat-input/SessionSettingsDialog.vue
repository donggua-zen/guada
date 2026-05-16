<template>
  <el-dialog :model-value="visible" @update:model-value="$emit('update:visible', $event)" title="会话记忆与压缩配置" width="600px" max-width="80vw" append-to-body
    :close-on-click-modal="false" class="session-settings-dialog">
    <el-form label-position="left" label-width="50%" size="large">
      <!-- 自定义配置开关 -->
      <el-form-item>
        <template #label>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <span class="text-base text-gray-900 dark:text-gray-100 font-medium">自定义记忆配置</span>
            <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">开启后将覆盖角色默认的记忆与压缩设置</span>
          </div>
        </template>
        <div class="w-full max-w-md">
          <el-switch v-model="tempConfig.useCustom" inline-prompt active-text="开启" inactive-text="关闭" />
        </div>
      </el-form-item>

      <!-- 仅在开启自定义时显示详细配置 -->
      <template v-if="tempConfig.useCustom">
        <!-- 上下文条数 -->
        <el-form-item>
          <template #label>
            <div class="flex flex-col gap-1">
              <span class="text-base text-gray-900 dark:text-gray-100 font-medium">上下文条数</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">控制对话历史的最大消息数量，影响模型的长期记忆能力</span>
            </div>
          </template>
          <el-slider-optional v-model="tempConfig.maxMemoryLength" :min="2" :max="100" :step="1" show-input
            optional-direction="max" optional-text="No Limit" class="w-full max-w-md" />
        </el-form-item>

        <!-- Token 上限 -->
        <el-form-item>
          <template #label>
            <div class="flex flex-col gap-1">
              <span class="text-base text-gray-900 dark:text-gray-100 font-medium">Token 上限</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">设置 Token
                使用上限，与模型上下文窗口取最小值作为压缩判断基准</span>
            </div>
          </template>
          <div class="w-full max-w-md">
            <el-input v-model="displayMaxTokens" placeholder="不限制" clearable @input="handleMaxTokensInput"
              @blur="formatDisplayMaxTokens">
              <template #suffix>
                <span class="text-gray-400 text-sm">Tokens</span>
              </template>
            </el-input>
            <div class="text-xs text-gray-400 mt-1">支持输入数字或带K/M后缀（如 128K、1M），留空表示不限制</div>
          </div>
        </el-form-item>

        <!-- 触发阈值 -->
        <el-form-item>
          <template #label>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <span class="text-base text-gray-900 dark:text-gray-100 font-medium">触发阈值</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">当已用 Token
                达到最大窗口的此比例时触发压缩</span>
            </div>
          </template>
          <el-slider v-model="tempConfig.triggerRatio" :min="0.5" :max="0.95" :step="0.05" show-input
            :format-tooltip="formatSliderTooltip" class="w-full max-w-md" />
        </el-form-item>

        <!-- 保留目标 -->
        <el-form-item>
          <template #label>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <span class="text-base text-gray-900 dark:text-gray-100 font-medium">保留目标</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">压缩后保留至最大窗口的此比例</span>
            </div>
          </template>
          <el-slider v-model="tempConfig.targetRatio" :min="0.2" :max="0.8" :step="0.05" show-input
            :format-tooltip="formatSliderTooltip" class="w-full max-w-md" />
        </el-form-item>

        <!-- 摘要模式 -->
        <el-form-item>
          <template #label>
            <div class="flex flex-col gap-1">
              <span class="text-base text-gray-900 dark:text-gray-100 font-medium">摘要模式</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">选择摘要生成方式：关闭、快速或迭代优化</span>
            </div>
          </template>
          <div class="w-full max-w-md">
            <el-select v-model="tempConfig.summaryMode" placeholder="请选择摘要模式" class="w-full">
              <el-option label="关闭摘要" value="disabled">
                <span class="flex items-center gap-2">
                  <el-icon>
                    <CloseOutlined />
                  </el-icon>
                  <span>关闭摘要 - 仅裁剪工具结果</span>
                </span>
              </el-option>
              <el-option label="快速摘要" value="fast">
                <span class="flex items-center gap-2">
                  <el-icon>
                    <ThunderboltOutlined />
                  </el-icon>
                  <span>快速摘要 - 单次调用生成</span>
                </span>
              </el-option>
              <el-option label="迭代摘要" value="iterative">
                <span class="flex items-center gap-2">
                  <el-icon>
                    <SyncOutlined />
                  </el-icon>
                  <span>迭代摘要 - 多轮优化，质量最高</span>
                </span>
              </el-option>
            </el-select>
          </div>
        </el-form-item>

        <el-alert title="提示" type="info" :closable="false" show-icon class="mb-6">
          <p class="text-sm">• 触发阈值：控制何时启动压缩（建议 70%-85%）</p>
          <p class="text-sm">• 保留目标：控制压缩后的 Token 占用（建议 40%-60%）</p>
          <p class="text-sm">• 摘要模式：关闭仅裁剪工具结果，快速适合日常使用，迭代质量最高但耗时较长</p>
        </el-alert>
      </template>
    </el-form>
    <template #footer>
      <span class="dialog-footer flex justify-end gap-2">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleConfirm">确定</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElDialog, ElForm, ElFormItem, ElSwitch, ElInput, ElSlider, ElSelect, ElOption, ElAlert, ElButton, ElIcon } from 'element-plus'
import ElSliderOptional from '../../ui/ElSliderOptional.vue'
import { CloseOutlined } from '@vicons/material'
import { ThunderboltOutlined, SyncOutlined } from '@vicons/antd'

interface MemoryConfig {
  useCustom?: boolean
  maxMemoryLength?: number | null
  compressionTriggerRatio?: number
  compressionTargetRatio?: number
  summaryMode?: string
  maxTokensLimit?: number | null
}

const props = defineProps<{
  visible: boolean
  config?: MemoryConfig
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'confirm': [config: any]
  'cancel': []
}>()

// 临时配置（内部使用的简化版本）
interface TempConfig {
  useCustom: boolean
  maxMemoryLength: number | null
  triggerRatio: number
  targetRatio: number
  summaryMode: string
  maxTokensLimit: number | null
}

const tempConfig = reactive<TempConfig>({
  useCustom: true,
  maxMemoryLength: null,
  triggerRatio: 0.8,
  targetRatio: 0.5,
  summaryMode: 'fast',
  maxTokensLimit: null,
})

// Token 上限显示值
const displayMaxTokens = ref('')

/**
 * 格式化 Token 值为显示字符串
 */
function formatTokenValue(value: number | null): string {
  if (!value) return ''
  const num = Number(value)
  if (isNaN(num)) return ''

  // 如果大于等于 1,000,000 且是整百万，使用 M 后缀
  if (num >= 1000000 && num % 1000000 === 0) {
    return (num / 1000000) + 'M'
  }
  // 如果大于等于 1000 且是整千，使用 K 后缀
  if (num >= 1000 && num % 1000 === 0) {
    return (num / 1000) + 'K'
  }
  // 否则使用千位分隔符
  return num.toLocaleString()
}

/**
 * 解析用户输入的 Token 值
 */
function parseTokenValue(input: string): number | null {
  if (!input || input.trim() === '') return null

  const trimmed = input.trim()
  const lowerTrimmed = trimmed.toLowerCase()

  // 支持 M/m 后缀（百万）
  if (lowerTrimmed.endsWith('m')) {
    const numStr = trimmed.slice(0, -1).replace(/,/g, '')
    const num = Number(numStr)
    if (isNaN(num)) return null
    return Math.round(num * 1000000)
  }

  // 支持 K/k 后缀（千）
  if (lowerTrimmed.endsWith('k')) {
    const numStr = trimmed.slice(0, -1).replace(/,/g, '')
    const num = Number(numStr)
    if (isNaN(num)) return null
    return Math.round(num * 1000)
  }

  // 普通数字（可能带逗号）
  const cleanStr = trimmed.replace(/,/g, '')
  const num = Number(cleanStr)
  return isNaN(num) ? null : num
}

/**
 * 处理 Token 上限输入
 */
function handleMaxTokensInput(val: string) {
  const parsed = parseTokenValue(val)
  tempConfig.maxTokensLimit = parsed
}

/**
 * 格式化 Token 上限显示
 */
function formatDisplayMaxTokens() {
  displayMaxTokens.value = formatTokenValue(tempConfig.maxTokensLimit)
}

/**
 * Slider 格式化函数
 */
function formatSliderTooltip(val: number): string {
  return `${Math.round(val * 100)}%`
}

/**
 * 初始化临时配置
 */
function initTempConfig() {
  const settings = props.config || {}
  
  tempConfig.useCustom = settings.useCustom ?? true
  tempConfig.maxMemoryLength = settings.maxMemoryLength ?? null
  tempConfig.triggerRatio = settings.compressionTriggerRatio ?? 0.8
  tempConfig.targetRatio = settings.compressionTargetRatio ?? 0.5
  tempConfig.summaryMode = settings.summaryMode ?? 'fast'
  tempConfig.maxTokensLimit = settings.maxTokensLimit || null
  
  // 同步更新显示值
  displayMaxTokens.value = formatTokenValue(tempConfig.maxTokensLimit)
}

/**
 * 处理确认
 */
function handleConfirm() {
  const configChanges: any = {
    memoryEnabled: tempConfig.useCustom,
  }

  // 只有当开启自定义配置时，才保存具体的数值
  if (tempConfig.useCustom) {
    configChanges.memory = {
      maxMemoryLength: tempConfig.maxMemoryLength,
      compressionTriggerRatio: tempConfig.triggerRatio,
      compressionTargetRatio: tempConfig.targetRatio,
      summaryMode: tempConfig.summaryMode,
      maxTokensLimit: tempConfig.maxTokensLimit,
    }
  }

  emit('confirm', configChanges)
}

/**
 * 处理取消
 */
function handleCancel() {
  emit('cancel')
  emit('update:visible', false)
}

// 监听 visible 变化，初始化配置
watch(() => props.visible, (newVal) => {
  if (newVal) {
    initTempConfig()
  }
})
</script>

<style scoped>
/* 会话设置模态框 - 强制Label区域高度自适应 */
.session-settings-dialog :deep(.el-form-item__label-wrap) {
  height: auto !important;
  min-height: auto !important;
  max-height: none !important;
}

.session-settings-dialog :deep(.el-form-item__label) {
  height: auto !important;
  min-height: auto !important;
  line-height: 1.5 !important;
  overflow: visible !important;
}
</style>

<style>
/* 会话设置模态框 - 全局样式强制覆盖 Element Plus 默认高度 */
.session-settings-dialog .el-form-item__label-wrap {
  height: auto !important;
  min-height: auto !important;
  max-height: none !important;
  display: flex !important;
  align-items: flex-start !important;
}

.session-settings-dialog .el-form-item__label {
  height: auto !important;
  min-height: auto !important;
  line-height: 1.5 !important;
  overflow: visible !important;
  white-space: normal !important;
}
</style>
