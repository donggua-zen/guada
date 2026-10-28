<template>
  <span
    class="shrink-0 flex items-center justify-center overflow-hidden rounded-full bg-gray-50 dark:bg-[#2a2c30]"
    :class="sizeClass"
    :title="name || undefined"
  >
    <img
      v-if="showUserAvatar"
      :src="avatarUrl || ''"
      :alt="name || ''"
      class="w-full h-full object-cover"
      @error="failed = true"
    />
    <img
      v-else
      :src="getBotPlatformAvatar(platform)"
      :alt="name || ''"
      class="w-full h-full object-contain p-[18%]"
      @error="handleBotAvatarError"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getBotPlatformAvatar, handleBotAvatarError } from '@/utils/botAvatar'

const props = withDefaults(
  defineProps<{
    /** 平台提供的真实用户头像 */
    avatarUrl?: string | null
    /** 无头像时回退的 IM 平台 */
    platform?: string | null
    name?: string | null
    size?: 'sm' | 'md'
  }>(),
  {
    avatarUrl: null,
    platform: null,
    name: null,
    size: 'sm',
  },
)

const failed = ref(false)

watch(
  () => props.avatarUrl,
  () => {
    // 切换会话/拿到新头像时给新 URL 一次加载机会
    failed.value = false
  },
)

const showUserAvatar = computed(() => Boolean(props.avatarUrl) && !failed.value)

const sizeClass = computed(() =>
  props.size === 'md' ? 'w-9 h-9' : 'w-7 h-7',
)
</script>
