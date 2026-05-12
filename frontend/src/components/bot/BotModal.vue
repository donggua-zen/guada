<template>
  <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑机器人' : '创建机器人'" width="600px" :close-on-click-modal="false"
    @close="handleClose" append-to-body>
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px" class="bot-form">

      <!-- 平台选择（仅创建时显示） -->
      <el-form-item v-if="!isEdit" label="选择平台" prop="platform">
        <el-select v-model="formData.platform" placeholder="请选择平台" style="width: 100%" @change="handlePlatformChange">
          <el-option v-for="platform in botStore.platforms" :key="platform.platform" :label="platform.displayName"
            :value="platform.platform">
            <span>{{ platform.displayName }}</span>
            <span class="text-gray-400 dark:text-[#6b6d75] text-xs ml-2">{{ platform.description }}</span>
          </el-option>
        </el-select>
      </el-form-item>

      <!-- 机器人名称 -->
      <el-form-item label="机器人名称" prop="name">
        <el-input v-model="formData.name" placeholder="请输入机器人名称" maxlength="50" show-word-limit />
      </el-form-item>

      <!-- 默认角色选择（必填） -->
      <el-form-item label="默认角色" prop="defaultCharacterId">
        <el-select v-model="formData.defaultCharacterId" placeholder="请选择默认角色" style="width: 100%" filterable>
          <el-option 
            v-for="character in characters" 
            :key="character.id" 
            :label="character.title" 
            :value="character.id">
            <div class="flex items-center gap-2">
              <img 
                v-if="character.avatarUrl" 
                :src="character.avatarUrl" 
                class="w-6 h-6 rounded object-cover" 
              />
              <span>{{ character.title }}</span>
            </div>
          </el-option>
        </el-select>
        <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1">
          机器人接收消息后使用该角色进行对话
        </div>
      </el-form-item>

      <!-- 模型选择（可选，不选则继承自角色/全局设置） -->
      <el-form-item label="模型选择">
        <el-select 
          v-model="formData.defaultModelId" 
          placeholder="继承自角色/全局设置" 
          style="width: 100%" 
          filterable
          clearable>
          <el-option 
            v-for="model in availableModels" 
            :key="model.id" 
            :label="model.modelName" 
            :value="model.id">
            <div class="flex items-center gap-2">
              <span>{{ model.modelName }}</span>
              <span class="text-gray-400 text-xs">{{ model.providerName }}</span>
            </div>
          </el-option>
        </el-select>
        <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1">
          不选择则使用角色的默认模型，如果角色未设置则使用全局默认模型
        </div>
      </el-form-item>

      <!-- 引用知识库选择（多选） -->
      <el-form-item label="引用知识库">
        <el-select 
          v-model="formData.knowledgeBaseIds" 
          placeholder="请选择知识库（可多选）" 
          style="width: 100%" 
          multiple
          filterable>
          <el-option 
            v-for="kb in knowledgeBases" 
            :key="kb.id" 
            :label="kb.name" 
            :value="kb.id">
            <div class="flex items-center gap-2">
              <span>{{ kb.name }}</span>
              <span v-if="kb.description" class="text-gray-400 text-xs">{{ kb.description }}</span>
            </div>
          </el-option>
        </el-select>
        <div class="text-xs text-gray-500 mt-1">
          AI回复时会引用这些知识库的内容
        </div>
      </el-form-item>

      <!-- 动态平台配置字段 -->
      <template v-if="selectedPlatform">
        <el-divider content-position="left">平台配置</el-divider>

        <el-form-item v-for="field in selectedPlatform.fields" :key="field.key" :label="field.label"
          :prop="`platformConfig.${field.key}`" :required="field.required">

          <!-- 文本输入 -->
          <el-input v-if="field.type === 'text'" v-model="formData.platformConfig[field.key]"
            :placeholder="field.placeholder" />

          <!-- 密码输入 -->
          <el-input v-else-if="field.type === 'password'" v-model="formData.platformConfig[field.key]" type="password"
            :placeholder="field.placeholder" show-password />

          <!-- 数字输入 -->
          <el-input-number v-else-if="field.type === 'number'" v-model="formData.platformConfig[field.key]"
            :placeholder="field.placeholder" style="width: 100%" />

          <!-- 下拉选择 -->
          <el-select v-else-if="field.type === 'select'" v-model="formData.platformConfig[field.key]"
            :placeholder="field.placeholder" style="width: 100%">
            <el-option v-for="option in field.options" :key="option.value" :label="option.label"
              :value="option.value" />
          </el-select>

          <!-- 开关 -->
          <el-switch v-else-if="field.type === 'boolean'" v-model="formData.platformConfig[field.key]" />

          <!-- 字段描述 -->
          <div v-if="field.description" class="text-xs text-gray-500 mt-1">
            {{ field.description }}
          </div>
        </el-form-item>
      </template>

      <!-- 高级配置（可折叠） -->
      <el-collapse v-model="activeCollapse">
        <el-collapse-item name="advanced">
          <template #title>
            <div class="flex items-center gap-2">
              <span>高级配置</span>
              <el-tag size="small" type="info">可选</el-tag>
            </div>
          </template>

          <!-- 重连配置 -->
          <el-form-item label="启用重连">
            <el-switch v-model="formData.reconnectConfig.enabled" />
          </el-form-item>

          <template v-if="formData.reconnectConfig.enabled">
            <el-form-item label="最大重试次数">
              <el-input-number v-model="formData.reconnectConfig.maxRetries" :min="1" :max="20" style="width: 100%" />
            </el-form-item>

            <el-form-item label="重试间隔(ms)">
              <el-input-number v-model="formData.reconnectConfig.retryInterval" :min="1000" :max="60000" :step="1000"
                style="width: 100%" />
            </el-form-item>
          </template>
        </el-collapse-item>
      </el-collapse>

      <!-- 自动启动（仅创建时） -->
      <el-form-item v-if="!isEdit" label="自动启动">
        <el-switch v-model="formData.autoStart" />
        <div class="text-xs text-gray-500 mt-1">
          创建后立即启动机器人
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ isEdit ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useBotStore } from '@/stores/bot'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { apiService } from '@/services/ApiService'
import type { BotInstance, PlatformMetadata } from '@/types/bot'
import type { KnowledgeBase } from '@/stores/knowledgeBase'
import type { ModelProvider, Model } from '@/types/api'

const props = defineProps<{
  modelValue: boolean
  bot?: BotInstance | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const botStore = useBotStore()
const knowledgeBaseStore = useKnowledgeBaseStore()
const formRef = ref<FormInstance>()
const submitting = ref(false)

// 折叠面板激活项（空数组表示默认全部折叠）
const activeCollapse = ref<string[]>([])

// 角色列表
const characters = ref<any[]>([])

// 知识库列表
const knowledgeBases = ref<KnowledgeBase[]>([])

// 模型提供商和模型列表
const modelProviders = ref<ModelProvider[]>([])
const allModels = ref<Model[]>([])

// 对话框可见性
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 是否编辑模式
const isEdit = computed(() => !!props.bot)

// 可用的模型列表（按提供商分组后的扁平列表）
const availableModels = computed(() => {
  return allModels.value.filter(model => model.isActive)
})
const selectedPlatform = computed<PlatformMetadata | undefined>(() => {
  if (!formData.value.platform) return undefined
  return botStore.platforms.find(p => p.platform === formData.value.platform)
})

// 表单数据
const formData = ref({
  platform: '',
  name: '',
  defaultCharacterId: '',
  defaultModelId: '' as string | null, // null 表示继承自角色/全局设置
  knowledgeBaseIds: [] as string[],
  platformConfig: {} as Record<string, any>,
  reconnectConfig: {
    enabled: true,
    maxRetries: 5,
    retryInterval: 5000
  },
  autoStart: false
})

// 表单验证规则
const formRules = computed<FormRules>(() => {
  const rules: FormRules = {
    name: [
      { required: true, message: '请输入机器人名称', trigger: 'blur' },
      { min: 2, max: 50, message: '长度在 2 到 50 个字符', trigger: 'blur' }
    ],
    defaultCharacterId: [
      { required: true, message: '请选择默认角色', trigger: 'change' }
    ]
  }

  // 添加平台字段的验证规则
  if (selectedPlatform.value) {
    selectedPlatform.value.fields.forEach(field => {
      if (field.required) {
        rules[`platformConfig.${field.key}`] = [
          { required: true, message: `请输入${field.label}`, trigger: 'blur' }
        ]
      }
    })
  }

  if (!isEdit.value) {
    rules.platform = [
      { required: true, message: '请选择平台', trigger: 'change' }
    ]
  }

  return rules
})

// 监听对话框打开，初始化表单
watch(dialogVisible, (visible) => {
  if (visible) {
    if (isEdit.value && props.bot) {
      // 编辑模式：填充现有数据
      const bot = props.bot // 创建局部变量以进行类型收窄
      const platformConfig = { ...bot.platformConfig }
      
      // 对于未设置的字段，使用平台元数据中的默认值
      const metadata = botStore.platforms.find(p => p.platform === bot.platform)
      if (metadata) {
        metadata.fields.forEach(field => {
          // 如果字段值为 undefined、null 或空字符串，且有默认值，则使用默认值
          if (
            (platformConfig[field.key] === undefined || 
             platformConfig[field.key] === null || 
             platformConfig[field.key] === '') &&
            field.defaultValue !== undefined
          ) {
            platformConfig[field.key] = field.defaultValue
          }
        })
      }
      
      formData.value = {
        platform: bot.platform,
        name: bot.name,
        defaultCharacterId: bot.defaultCharacterId || '',
        defaultModelId: bot.defaultModelId || null, // null 表示继承自角色/全局设置
        knowledgeBaseIds: bot.additionalKwargs?.knowledgeBaseIds || [],
        platformConfig: platformConfig,
        reconnectConfig: {
          enabled: bot.reconnectEnabled,
          maxRetries: bot.maxRetries,
          retryInterval: bot.retryInterval
        },
        autoStart: false
      }
    } else {
      // 创建模式：重置表单（resetForm 内部会清除验证）
      resetForm()
      return
    }
    
    // 编辑模式填充数据后，等待 DOM 更新再清除验证
    nextTick(() => {
      formRef.value?.clearValidate()
    })
  }
})

// 平台改变时，初始化默认配置
const handlePlatformChange = async (platform: string) => {
  const metadata = botStore.platforms.find(p => p.platform === platform)
  if (metadata) {
    formData.value.platformConfig = {}
    // 设置默认值
    metadata.fields.forEach(field => {
      if (field.defaultValue !== undefined) {
        formData.value.platformConfig[field.key] = field.defaultValue
      }
    })
    
    // 等待 DOM 更新后清除验证状态，避免切换平台时爆红
    await nextTick()
    formRef.value?.clearValidate()
  }
}

// 重置表单
const resetForm = () => {
  // 先清除验证状态，再重置数据，避免触发验证
  formRef.value?.clearValidate()
  
  formData.value = {
    platform: '',
    name: '',
    defaultCharacterId: '',
    defaultModelId: null, // null 表示继承自角色/全局设置
    knowledgeBaseIds: [],
    platformConfig: {},
    reconnectConfig: {
      enabled: true,
      maxRetries: 5,
      retryInterval: 5000
    },
    autoStart: false
  }
}

// 关闭对话框
const handleClose = () => {
  dialogVisible.value = false
  resetForm()
}

// 加载角色列表
const loadCharacters = async () => {
  try {
    const response = await apiService.fetchCharacters()
    characters.value = response.items || []
  } catch (error) {
    console.error('获取角色列表失败:', error)
    ElMessage.error('获取角色列表失败')
  }
}

// 加载知识库列表
const loadKnowledgeBases = async () => {
  try {
    await knowledgeBaseStore.fetchKnowledgeBases()
    knowledgeBases.value = knowledgeBaseStore.knowledgeBases
  } catch (error) {
    console.error('获取知识库列表失败:', error)
    ElMessage.error('获取知识库列表失败')
  }
}

// 加载模型列表
const loadModels = async () => {
  try {
    const response = await apiService.fetchModels()
    modelProviders.value = response.items || []
    // 扁平化所有模型
    allModels.value = modelProviders.value.flatMap(provider => 
      (provider.models || []).map(model => ({
        ...model,
        providerName: provider.name
      }))
    )
  } catch (error) {
    console.error('获取模型列表失败:', error)
    ElMessage.error('获取模型列表失败')
  }
}

// 组件挂载时加载角色列表、知识库列表和模型列表
onMounted(() => {
  loadCharacters()
  loadKnowledgeBases()
  loadModels()
})

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    submitting.value = true
    try {
      if (isEdit.value && props.bot) {
        // 编辑模式
        const updateData = {
          name: formData.value.name,
          defaultCharacterId: formData.value.defaultCharacterId,
          defaultModelId: formData.value.defaultModelId || undefined, // null 转为 undefined
          platformConfig: formData.value.platformConfig,
          reconnectConfig: formData.value.reconnectConfig,
          additionalKwargs: {
            knowledgeBaseIds: formData.value.knowledgeBaseIds.length > 0 ? formData.value.knowledgeBaseIds : undefined
          }
        }
        await botStore.updateBot(props.bot.id, updateData)
      } else {
        // 创建模式
        const createData = {
          platform: formData.value.platform,
          name: formData.value.name,
          defaultCharacterId: formData.value.defaultCharacterId,
          defaultModelId: formData.value.defaultModelId || undefined, // null 转为 undefined
          platformConfig: formData.value.platformConfig,
          reconnectConfig: formData.value.reconnectConfig,
          autoStart: formData.value.autoStart,
          additionalKwargs: {
            knowledgeBaseIds: formData.value.knowledgeBaseIds.length > 0 ? formData.value.knowledgeBaseIds : undefined
          }
        }
        await botStore.createBot(createData)
      }

      emit('saved')
      handleClose()
    } catch (error) {
      console.error('提交失败:', error)
    } finally {
      submitting.value = false
    }
  })
}
</script>

<style scoped>
.bot-form {
  max-height: 60vh;
  overflow-y: auto;
}
</style>
