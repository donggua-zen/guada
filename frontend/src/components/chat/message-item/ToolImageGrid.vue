<template>
  <div v-if="images.length" class="tool-image-grid" :class="{ 'tool-image-grid--after': after }">
    <img v-for="(img, index) in images" :key="img.url || img.previewUrl || index"
      :src="toResourceUrl(img.previewUrl || img.url)" :alt="img.name || 'image'"
      class="tool-image-thumb" loading="lazy" @click="open(index)" />
    <el-image-viewer v-if="showViewer" v-model:visible="showViewer" :url-list="viewerList"
      :initial-index="viewerIndex" :teleported="true" @close="showViewer = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElImageViewer } from 'element-plus';
import { toResourceUrl } from '@/utils/url';
import type { FileRef } from '@/types/stream/content-block.types';

/**
 * 工具产出图片缩略图（tool-result.images）。
 * 由调用方决定位置：通用 IO 行放在"输出"段内；定制卡片行放在卡片之后。
 * 点击缩略图打开大图预览（原图优先，缺失时回退缩略图）。
 */
const props = defineProps<{
  images: FileRef[];
  /** 挂在定制卡片之后时补上间距（通用 IO 输出区内不需要） */
  after?: boolean;
}>();

const showViewer = ref(false);
const viewerList = ref<string[]>([]);
const viewerIndex = ref(0);

const open = (index: number): void => {
  viewerList.value = props.images
    .map((image) => toResourceUrl(image.url || image.previewUrl))
    .filter((url) => !!url);
  if (viewerList.value.length === 0) return;
  viewerIndex.value = Math.min(
    Math.max(index, 0),
    viewerList.value.length - 1,
  );
  showViewer.value = true;
};
</script>

<style scoped>
.tool-image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 8px;
  max-height: 320px;
  overflow-y: auto;
}

.tool-image-grid--after {
  margin-top: 8px;
}

.tool-image-thumb {
  display: block;
  max-width: 160px;
  max-height: 120px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  object-fit: cover;
  cursor: zoom-in;
}
</style>
