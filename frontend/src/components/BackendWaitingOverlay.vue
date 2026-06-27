<template>
  <div class="backend-waiting-overlay">
    <!-- 加载状态 -->
    <div v-if="!error" class="waiting-content">
      <div class="logo-container">
        <svg class="logo-spin" viewBox="0 0 100 100" width="80" height="80">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="3"
            stroke-dasharray="283" stroke-dashoffset="200" class="spinner-ring" />
          <text x="50" y="62" text-anchor="middle" font-size="32" fill="currentColor"
            class="logo-text">⚡</text>
        </svg>
      </div>
      <h2 class="loading-title">正在启动后端服务</h2>
      <p class="loading-desc">首次启动需初始化数据库，请稍候…</p>
    </div>

    <!-- 错误状态 -->
    <div v-else class="error-content">
      <div class="error-icon">⚠</div>
      <h2 class="error-title">启动失败</h2>
      <p class="error-text">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  error: string | null;
}>();
</script>

<style scoped>
.backend-waiting-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  height: 100%;
}

.waiting-content,
.error-content {
  text-align: center;
  max-width: 360px;
}

.logo-container {
  margin-bottom: 24px;
}

.logo-spin {
  color: var(--color-primary, #409eff);
}

.spinner-ring {
  transform-origin: center;
  animation: spin 1.5s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.logo-text {
  user-select: none;
}

.loading-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text, #303133);
  margin: 0 0 8px;
}

.loading-desc {
  font-size: 14px;
  color: var(--color-text-secondary, #909399);
  margin: 0;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-danger, #f56c6c);
  margin: 0 0 8px;
}

.error-text {
  font-size: 14px;
  color: var(--color-text-secondary, #909399);
  margin: 0;
  line-height: 1.6;
}
</style>
