<template>
  <div class="h-full overflow-hidden">
    <BotChatPage />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BotChatPage from './BotChatPage.vue'

const route = useRoute()
const router = useRouter()

/** 机器人管理已经并进对话页，旧的 /bots/management、/bots/sessions 落回 /bots */
onMounted(() => {
  if (route.params.tab) {
    router.replace({ name: 'Bots' })
  }
})
</script>
