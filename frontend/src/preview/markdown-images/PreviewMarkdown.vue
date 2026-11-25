<script setup lang="ts">
/**
 * 临时预览页的图片渲染 = 正式链路组件。
 *
 * 这里不再维护第二份 Markdown 渲染实现：直接复用 `MarkdownContent`（含 token 阶段分组、
 * 卡片、失败重试、事件委托），只通过 `resolveImage` 注入演示图片 / 真实会话来源。
 * 因此本页看到的效果就是接入聊天后的效果。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Image20Regular, ArrowExpand20Regular } from '@vicons/fluent'
import MarkdownContent from '@/components/ui/MarkdownContent.vue'
import GdImageViewer from '@/components/ui/GdImageViewer.vue'
import { resolvePreviewImage, type Workspace } from './imageSource'

const props = defineProps<{
  content: string
  workspace: Workspace
  sessionId: string
  workspacePath: string
}>()
const emit = defineEmits<{
  retry: [source: string]
}>()

const preview = ref(false)
const urls = ref<string[]>([])
const index = ref(0)
/** 已点过「重试」的图片：演示页用它模拟「文件稍后生成」，按图分别记录 */
const retried = ref(new Set<string>())

/** 预览页把「演示工作目录 / 真实会话」统一成一个解析器，交给正式卡片渲染 */
const resolveImage = (src: string) => {
  const resolved = resolvePreviewImage(src, {
    workspace: props.workspace,
    sessionId: props.sessionId,
    workspacePath: props.workspacePath,
    recovered: retried.value.has(src),
  })
  return {
    url: resolved.url,
    fileName: src.split(/[\\/]/).pop() || src,
    rejectedReason: resolved.blocked ? resolved.target : undefined,
  }
}

// 工作目录/会话切换时重建卡片，避免沿用旧的加载状态
const imageContextKey = computed(() => `${props.workspace}:${props.sessionId}`)
const renderKey = ref(0)
watch(imageContextKey, () => {
  retried.value = new Set()
  renderKey.value += 1
})

function openPreview(list: string[], start: number) {
  urls.value = list
  index.value = start
  preview.value = true
}

/** 点重试：记录该图「已生成」，再让组件换地址重新请求 */
function handleRetry(src: string) {
  retried.value = new Set(retried.value).add(src)
  emit('retry', src)
}

onBeforeUnmount(() => { preview.value = false })
</script>

<template>
  <div class="preview-markdown">
    <MarkdownContent
      :key="renderKey"
      :content="content"
      :streaming="false"
      :resolve-image="resolveImage"
      @preview-image="openPreview"
      @retry-image="handleRetry"
    />
    <div class="image-hint"><Image20Regular /> 图片按工作目录解析 · 点击查看完整图片 <ArrowExpand20Regular /></div>
  </div>
  <GdImageViewer :visible="preview" :urls="urls" :initial-index="index" @update:visible="preview = $event" />
</template>

<style>
.preview-markdown .image-hint { display: flex; align-items: center; gap: 6px; color: var(--gd-color-text-gray); font-size: 12px; line-height: 20px; margin: 18px 0; }
.preview-markdown .image-hint svg { width: 16px; height: 16px; }
</style>
