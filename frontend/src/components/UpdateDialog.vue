<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="onVisibleChange"
    width="480px"
    :close-on-click-modal="false"
    class="update-dialog"
    append-to-body
    destroy-on-close
  >
    <template #header>
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-blue-500" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
            <path d="M512 128c-211.744 0-384 172.256-384 384 0 211.744 172.256 384 384 384 211.744 0 384-172.256 384-384 0-211.744-172.256-384-384-384z m0 704c-176.448 0-320-143.552-320-320 0-176.448 143.552-320 320-320 176.448 0 320 143.552 320 320 0 176.448-143.552 320-320 320z" fill="currentColor"/>
            <path d="M512 320c-17.664 0-32 14.336-32 32v160c0 17.664 14.336 32 32 32s32-14.336 32-32v-160c0-17.664-14.336-32-32-32z" fill="currentColor"/>
            <path d="M480 608a32 32 0 1 0 64 0 32 32 0 1 0-64 0z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h3 class="text-base font-semibold text-(--color-text-primary)">发现新版本</h3>
          <p class="text-xs text-(--color-text-secondary)">当前版本 {{ updateInfo?.clientVersion }} → 新版本 {{ updateInfo?.version }}</p>
        </div>
      </div>
    </template>

    <!-- 内容区 -->
    <div class="space-y-4">
      <!-- 发布日期 -->
      <div class="flex items-center gap-2 text-xs text-(--color-text-secondary)">
        <svg class="w-3.5 h-3.5" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
          <path d="M512 64C264.576 64 64 264.576 64 512s200.576 448 448 448 448-200.576 448-448S759.424 64 512 64z m0 832c-211.744 0-384-172.256-384-384S300.256 128 512 128s384 172.256 384 384-172.256 384-384 384z" fill="currentColor"/>
          <path d="M672 352H352c-17.664 0-32 14.336-32 32v256c0 17.664 14.336 32 32 32h320c17.664 0 32-14.336 32-32V384c0-17.664-14.336-32-32-32z m-32 256H384V416h256v192z" fill="currentColor"/>
          <path d="M480 480h64v64h-64z" fill="currentColor"/>
        </svg>
        <span>发布日期：{{ updateInfo?.publishDate || '未知' }}</span>
      </div>

      <!-- 更新描述 -->
      <div>
        <h4 class="text-sm font-medium text-(--color-text-primary) mb-2">更新内容</h4>
        <p class="text-sm text-(--color-text-secondary) leading-relaxed whitespace-pre-wrap">{{ updateInfo?.description || '暂无更新说明' }}</p>
      </div>

      <!-- 强制更新提示 -->
      <div v-if="updateInfo?.mandatory" class="flex items-center gap-2 text-xs text-orange-500 bg-orange-500/10 rounded-lg px-3 py-2">
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
          <path d="M512 64C264.576 64 64 264.576 64 512s200.576 448 448 448 448-200.576 448-448S759.424 64 512 64z m0 832c-211.744 0-384-172.256-384-384S300.256 128 512 128s384 172.256 384 384-172.256 384-384 384z" fill="currentColor"/>
          <path d="M512 256c-17.664 0-32 14.336-32 32v288c0 17.664 14.336 32 32 32s32-14.336 32-32V288c0-17.664-14.336-32-32-32z" fill="currentColor"/>
          <path d="M480 608a32 32 0 1 0 64 0 32 32 0 1 0-64 0z" fill="currentColor"/>
        </svg>
        <span>此版本为强制更新，建议尽快升级以获得最佳体验</span>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <el-checkbox v-model="dontRemind" size="small" class="text-xs">
          不再弹窗提醒
        </el-checkbox>
        <div class="flex items-center gap-3">
          <el-button @click="handleViewChangelog">
            查看更新日志
          </el-button>
          <el-button type="primary" @click="handleDownload">
            下载更新包
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElDialog, ElButton, ElCheckbox } from 'element-plus'

const props = defineProps<{
  visible: boolean
  updateInfo: any
  isSkipped?: boolean
}>()

const emit = defineEmits(['update:visible', 'dont-remind', 'cancel-skip'])

const dontRemind = ref(props.isSkipped ?? false)

// 当弹窗打开时，同步父组件传入的跳过状态
watch(() => props.visible, (val: boolean) => {
  if (val) {
    dontRemind.value = props.isSkipped ?? false
  }
})

const handleClose = () => {
  if (dontRemind.value && !props.isSkipped) {
    emit('dont-remind')
  } else if (!dontRemind.value && props.isSkipped) {
    emit('cancel-skip')
  }
  emit('update:visible', false)
}

const onVisibleChange = (val: boolean) => {
  if (!val) {
    if (dontRemind.value && !props.isSkipped) {
      emit('dont-remind')
    } else if (!dontRemind.value && props.isSkipped) {
      emit('cancel-skip')
    }
  }
  emit('update:visible', val)
}

const handleDownload = () => {
  if (props.updateInfo?.downloadUrl && window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(props.updateInfo.downloadUrl)
  }
  handleClose()
}

const handleViewChangelog = () => {
  if (props.updateInfo?.releaseNotes && window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(props.updateInfo.releaseNotes)
  }
  handleClose()
}
</script>

<style scoped>
.update-dialog :deep(.el-dialog__header) {
  margin-right: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.update-dialog :deep(.el-dialog__body) {
  padding: 16px 20px;
}

.update-dialog :deep(.el-dialog__footer) {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
}
</style>
