<template>
  <div class="flex items-center justify-center h-full min-h-[500px] py-10 px-5">
    <div class="max-w-[600px] w-full text-center p-10 rounded-2xl animate-fade-in-up">
      <!-- 头像区域 -->
      <div class="relative inline-block mb-5">
        <div
          class="w-24 h-24 rounded-full flex items-center justify-center mx-auto relative overflow-hidden p-0 animate-bounce-in"
        >
          <Avatar v-if="session" :src="session.character.avatarUrl" round />
          <div v-else class="text-4xl text-white">?</div>
        </div>
        <div
          class="absolute bottom-1 right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full"
        ></div>
      </div>

      <!-- 标题和描述 -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-4 text-[var(--color-primary)]">
          {{ session?.character.title || '' }}
        </h1>
        <h2 class="text-lg font-normal text-gray-600 leading-relaxed">
          {{ session?.character.description || '' }}
        </h2>

        <!-- 角色设定 -->
        <div
          v-if="session?.settings?.systemPrompt"
          class="mt-6 p-5 bg-gray-50 rounded-xl border-l-4 border-[var(--color-primary)] text-left"
        >
          <h3 class="text-base font-semibold text-gray-800 mb-2">角色设定</h3>
          <p class="text-sm text-gray-600 leading-6">
            {{ session?.settings.systemPrompt }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue'
import Avatar from '../ui/Avatar.vue'

defineProps<{
  session: any
}>()
</script>

<style scoped>
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes bounceIn {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-fade-in-up {
  animation: fadeInUp 0.8s ease-out;
}

.animate-bounce-in {
  animation: bounceIn 1s ease-out;
}
</style>
