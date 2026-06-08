<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
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

      <!-- 重置按钮 -->
      <div class="flex justify-end">
        <el-button @click="handleReset">恢复默认设置</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { ElMessage, ElUpload, ElSlider, ElSwitch, ElButton, ElIcon } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { useLayoutStore } from '@/stores/layout'

const layoutStore = useLayoutStore()

// 表单数据
const settingsForm = reactive({
  sidebarOpacity: 100,
  contentOpacity: 100,
  acrylicEnabled: true,
  blurRadius: 20,
})

const previewUrl = ref<string | null>(null)
const uploadRef = ref<InstanceType<typeof ElUpload> | null>(null)

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
    previewUrl.value = response.wallpaperUrl || null

    // 同步到 layout store
    syncToLayoutStore()
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
}

// 保存设置
const handleSave = async () => {
  try {
    const dataToSave = {
      sidebarOpacity: settingsForm.sidebarOpacity,
      contentOpacity: settingsForm.contentOpacity,
      acrylicEnabled: settingsForm.acrylicEnabled,
      blurRadius: settingsForm.blurRadius,
      wallpaperUrl: previewUrl.value,
    }

    await apiService.updateGroupSettings('appearance', dataToSave)

    // 同步到 layout store
    syncToLayoutStore()
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
    previewUrl.value = response.url
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

// 恢复默认设置
const handleReset = async () => {
  settingsForm.sidebarOpacity = 100
  settingsForm.contentOpacity = 100
  settingsForm.acrylicEnabled = true
  settingsForm.blurRadius = 20

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
