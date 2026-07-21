<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 主题模式分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">主题模式</h3>
        <div
          class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden"
        >
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">显示模式</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                选择浅色、深色或跟随系统主题
              </span>
            </div>
            <div class="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-[#1a1b1e] shrink-0">
              <button
                v-for="option in themeOptions"
                :key="option.value"
                @click="setTheme(option.value)"
                class="px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5"
                :class="themeMode === option.value
                  ? 'bg-white dark:bg-[#3a3b3f] text-gray-900 dark:text-[#e8e9ed] shadow-sm'
                  : 'text-gray-500 dark:text-[#8b8d95] hover:text-gray-700 dark:hover:text-[#c0c1c5]'"
              >
                <component :is="option.icon" class="w-4 h-4" />
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 壁纸设置分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">背景壁纸</h3>
        <div
          class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden"
        >
          <!-- 壁纸预览与上传 -->
          <div class="px-4 py-3.5 flex flex-col gap-4">
            <div class="flex items-center justify-between gap-4">
              <div class="flex flex-col gap-1 min-w-0">
                <span class="text-base text-gray-900 dark:text-[#e8e9ed]">自定义壁纸</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                  上传一张图片作为应用背景，支持 JPG、PNG、WebP 格式
                </span>
              </div>
            </div>

            <!-- 壁纸预览区域 -->
            <div
              v-if="previewUrl"
              class="relative w-full h-40 rounded-lg overflow-hidden border border-gray-200 dark:border-[#2e3035]"
            >
              <img :src="previewUrl" class="w-full h-full object-cover" />
              <div
                class="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
              >
                <el-button type="danger" size="small" @click="handleRemoveWallpaper">
                  <el-icon class="mr-1">
                    <Delete />
                  </el-icon>
                  删除
                </el-button>
              </div>
            </div>

            <!-- 上传按钮 -->
            <div v-else class="w-full">
              <el-upload
                ref="uploadRef"
                class="wallpaper-uploader"
                :auto-upload="false"
                :show-file-list="false"
                :on-change="handleFileChange"
                accept="image/jpeg,image/png,image/webp"
              >
                <div
                  class="w-full h-40 rounded-lg border-2 border-dashed border-gray-300 dark:border-[#2e3035] flex flex-col items-center justify-center cursor-pointer hover:border-(--color-primary) transition-colors"
                >
                  <el-icon class="text-3xl text-gray-400 mb-2">
                    <Plus />
                  </el-icon>
                  <span class="text-sm text-gray-500 dark:text-[#8b8d95]">
                    点击或拖拽上传壁纸
                  </span>
                </div>
              </el-upload>
            </div>
          </div>
        </div>
      </div>

      <!-- 透明度设置分组（仅在有壁纸时显示） -->
      <div v-if="previewUrl">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">透明度调节</h3>
        <div
          class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden"
        >
          <!-- 侧边栏透明度 -->
          <div
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]"
          >
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">侧边栏透明度</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                调节侧边栏背景的不透明度
              </span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <el-slider
                v-model="settingsForm.sidebarOpacity"
                :min="0"
                :max="100"
                :step="1"
                class="flex-1"
                @change="handleOpacityChange"
              />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">
                {{ settingsForm.sidebarOpacity }}%
              </span>
            </div>
          </div>

          <!-- 内容区透明度 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">内容区透明度</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                调节主内容区域背景的不透明度
              </span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <el-slider
                v-model="settingsForm.contentOpacity"
                :min="0"
                :max="100"
                :step="1"
                class="flex-1"
                @change="handleOpacityChange"
              />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">
                {{ settingsForm.contentOpacity }}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 毛玻璃效果分组（仅在有壁纸时显示） -->
      <div v-if="previewUrl">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">毛玻璃效果</h3>
        <div
          class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden"
        >
          <!-- 毛玻璃开关 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">启用毛玻璃效果</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                为背景添加毛玻璃模糊效果
              </span>
            </div>
            <el-switch v-model="settingsForm.acrylicEnabled" size="large" @change="handleAcrylicChange" />
          </div>

          <!-- 模糊程度 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">模糊程度</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                调节背景壁纸的模糊半径
              </span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <el-slider
                v-model="settingsForm.blurRadius"
                :min="0"
                :max="50"
                :step="1"
                class="flex-1"
                @change="handleBlurChange"
              />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">
                {{ settingsForm.blurRadius }}px
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 悬浮任务状态分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">悬浮任务状态</h3>
        <div
          class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden"
        >
          <!-- 显隐开关 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">显示悬浮窗</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                最小化到托盘时显示任务运行和未读统计
              </span>
            </div>
            <el-switch v-model="settingsForm.floatWidgetEnabled" size="large" @change="handleFloatWidgetChange" />
          </div>

          <!-- 透明度调节 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">悬浮窗透明度</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                调节悬浮窗卡片的不透明度
              </span>
            </div>
            <div class="flex items-center gap-3 shrink-0 w-48">
              <el-slider
                v-model="settingsForm.floatWidgetOpacity"
                :min="30"
                :max="100"
                :step="1"
                class="flex-1"
                @change="handleFloatWidgetChange"
              />
              <span class="text-sm text-gray-600 dark:text-[#8b8d95] w-10 text-right">
                {{ settingsForm.floatWidgetOpacity }}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 重置按钮 -->
      <div class="flex justify-end">
        <el-button @click="handleReset">恢复默认设置</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch, markRaw } from 'vue'
import { ElMessage, ElUpload, ElSlider, ElSwitch, ElButton, ElIcon } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { WeatherSunny20Regular, WeatherMoon20Filled, Desktop16Regular } from '@vicons/fluent'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { useLayoutStore } from '@/stores/layout'
import { useTheme, type ThemeMode } from '@/composables/useTheme'

const layoutStore = useLayoutStore()
const { themeMode, setTheme } = useTheme()

const themeOptions = [
  { label: '浅色', value: 'light' as ThemeMode, icon: markRaw(WeatherSunny20Regular) },
  { label: '深色', value: 'dark' as ThemeMode, icon: markRaw(WeatherMoon20Filled) },
  { label: '系统', value: 'system' as ThemeMode, icon: markRaw(Desktop16Regular) },
]

// 表单数据
const settingsForm = reactive({
  sidebarOpacity: 100,
  contentOpacity: 100,
  acrylicEnabled: true,
  blurRadius: 20,
  floatWidgetEnabled: false,
  floatWidgetOpacity: 95,
})

const previewUrl = ref<string | null>(null)
const uploadRef = ref<InstanceType<typeof ElUpload> | null>(null)

/**
 * 将相对路径拼接为完整 URL（用于预览和显示）
 * 根据当前 apiService.baseURL 动态拼接，适配 Electron 随机端口
 */
const resolveWallpaperUrl = (storedUrl: string | null): string | null => {
  if (!storedUrl) return null
  if (storedUrl.startsWith('http://') || storedUrl.startsWith('https://')) {
    return storedUrl
  }
  const baseUrl = apiService.baseURL.replace(/\/api\/v1$/, '')
  return `${baseUrl}${storedUrl.startsWith('/') ? '' : '/'}${storedUrl}`
}

/**
 * 从完整 URL 中提取相对路径（用于保存到后端）
 */
const extractRelativePath = (fullUrl: string | null): string | null => {
  if (!fullUrl) return null
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    return fullUrl
  }
  try {
    const url = new URL(fullUrl)
    return url.pathname
  } catch {
    return fullUrl
  }
}

// 防抖保存（300ms）
const debouncedSave = useDebounceFn(async () => {
  await handleSave()
}, 300)

// 监听透明度/模糊程度变化自动保存（仅在有壁纸时生效）
watch(
  () => [settingsForm.sidebarOpacity, settingsForm.contentOpacity, settingsForm.blurRadius],
  () => {
    if (previewUrl.value) {
      debouncedSave()
    }
  },
)

// 加载外观设置
const loadSettings = async () => {
  try {
    const response = await apiService.fetchGroupSettings('appearance')

    settingsForm.sidebarOpacity = response.sidebarOpacity ?? 100
    settingsForm.contentOpacity = response.contentOpacity ?? 100
    settingsForm.acrylicEnabled = response.acrylicEnabled !== false
    settingsForm.blurRadius = response.blurRadius ?? 20
    settingsForm.floatWidgetEnabled = response.floatWidgetEnabled === true
    settingsForm.floatWidgetOpacity = response.floatWidgetOpacity ?? 95
    previewUrl.value = resolveWallpaperUrl(response.wallpaperUrl || null)

    // 同步到 layout store
    syncToLayoutStore()
    // 同步到 Electron 主进程
    pushFloatWidgetSettings()
  } catch (error) {
    console.error('获取外观设置失败:', error)
    // 使用默认值
  }
}

// 同步表单数据到 layout store
const syncToLayoutStore = () => {
  layoutStore.setSidebarOpacity(settingsForm.sidebarOpacity)
  layoutStore.setContentOpacity(settingsForm.contentOpacity)
  layoutStore.setAcrylicEnabled(settingsForm.acrylicEnabled)
  layoutStore.setBlurRadius(settingsForm.blurRadius)
  layoutStore.setWallpaperUrl(previewUrl.value)
  layoutStore.setFloatWidgetEnabled(settingsForm.floatWidgetEnabled)
  layoutStore.setFloatWidgetOpacity(settingsForm.floatWidgetOpacity)
}

// 保存设置
const handleSave = async () => {
  try {
    const dataToSave = {
      sidebarOpacity: settingsForm.sidebarOpacity,
      contentOpacity: settingsForm.contentOpacity,
      acrylicEnabled: settingsForm.acrylicEnabled,
      blurRadius: settingsForm.blurRadius,
      wallpaperUrl: extractRelativePath(previewUrl.value),
      floatWidgetEnabled: settingsForm.floatWidgetEnabled,
      floatWidgetOpacity: settingsForm.floatWidgetOpacity,
    }

    await apiService.updateGroupSettings('appearance', dataToSave)

    // 同步到 layout store
    syncToLayoutStore()
    // 同步到 Electron 主进程
    pushFloatWidgetSettings()
  } catch (error: any) {
    console.error('保存外观设置失败:', error)
    ElMessage.error('保存失败: ' + (error.message || '未知错误'))
  }
}

// 处理文件选择
const handleFileChange = async (uploadFile: any) => {
  const file = uploadFile.raw as File
  if (!file) return

  // 验证文件类型
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    ElMessage.error('不支持的文件类型，请上传 JPG、PNG 或 WebP 格式图片')
    return
  }

  // 验证文件大小（最大 10MB）
  const maxSize = 10 * 1024 * 1024
  if (file.size > maxSize) {
    ElMessage.error('图片大小不能超过 10MB')
    return
  }

  try {
    const response = await apiService.uploadWallpaper(file)
    previewUrl.value = resolveWallpaperUrl(extractRelativePath(response.url))
    await handleSave()
    ElMessage.success('壁纸上传成功')
  } catch (error: any) {
    console.error('壁纸上传失败:', error)
    ElMessage.error('壁纸上传失败: ' + (error.message || '未知错误'))
  }
}

// 删除壁纸
const handleRemoveWallpaper = async () => {
  try {
    await apiService.deleteWallpaper()
    previewUrl.value = null
    await handleSave()
    ElMessage.success('壁纸已删除')
  } catch (error: any) {
    console.error('壁纸删除失败:', error)
    ElMessage.error('壁纸删除失败: ' + (error.message || '未知错误'))
  }
}

// 透明度变化实时同步到 layout store
const handleOpacityChange = () => {
  layoutStore.setSidebarOpacity(settingsForm.sidebarOpacity)
  layoutStore.setContentOpacity(settingsForm.contentOpacity)
}

// 毛玻璃开关变化
const handleAcrylicChange = () => {
  layoutStore.setAcrylicEnabled(settingsForm.acrylicEnabled)
  handleSave()
}

// 模糊程度变化
const handleBlurChange = () => {
  layoutStore.setBlurRadius(settingsForm.blurRadius)
}

/**
 * 推送悬浮窗设置到 Electron 主进程
 */
const pushFloatWidgetSettings = () => {
  window.electronAPI?.updateTraySettings({
    enabled: settingsForm.floatWidgetEnabled,
    opacity: settingsForm.floatWidgetOpacity,
  })
}

/**
 * 悬浮任务窗设置变化（开关 / 透明度）
 */
const handleFloatWidgetChange = () => {
  layoutStore.setFloatWidgetEnabled(settingsForm.floatWidgetEnabled)
  layoutStore.setFloatWidgetOpacity(settingsForm.floatWidgetOpacity)
  handleSave()
}

// 恢复默认设置
const handleReset = async () => {
  settingsForm.sidebarOpacity = 100
  settingsForm.contentOpacity = 100
  settingsForm.acrylicEnabled = true
  settingsForm.blurRadius = 20
  settingsForm.floatWidgetEnabled = false
  settingsForm.floatWidgetOpacity = 95

  if (previewUrl.value) {
    try {
      await apiService.deleteWallpaper()
    } catch (error) {
      console.error('删除壁纸失败:', error)
    }
    previewUrl.value = null
  }

  await handleSave()
  ElMessage.success('已恢复默认设置')
}

// 生命周期
onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.wallpaper-uploader :deep(.el-upload) {
  width: 100%;
}
</style>
