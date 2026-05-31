<template>
  <div class="message-skeleton">
    <!-- 模拟交错排列的消息：奇数索引为用户消息，偶数索引为 AI 消息 -->
    <template v-for="i in (count || 3)" :key="i">
      <!-- 用户消息（奇数） -->
      <div v-if="i % 2 === 1" class="skeleton-item skeleton-item--user">
        <div class="skeleton-wrapper">
          <div class="skeleton-content skeleton-content--user">
            <div class="skeleton-line skeleton-line--short"></div>
            <div class="skeleton-line skeleton-line--medium"></div>
          </div>
        </div>
      </div>

      <!-- AI 消息（偶数） -->
      <div v-else class="skeleton-item skeleton-item--assistant">
        <div class="skeleton-wrapper">
          <!-- 模型名称行：头像 + 名称 -->
          <div class="skeleton-meta">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-line skeleton-line--meta"></div>
          </div>
          <!-- 消息内容区 -->
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-line--long"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line skeleton-line--medium"></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  count?: number;
}>();
</script>

<style scoped>
.message-skeleton {
  padding: 16px 0;
}

/* 消息项基础样式，对齐 MessageItem */
.skeleton-item {
  display: flex;
  width: 100%;
  margin-top: 20px;
  margin-bottom: 25px;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* AI 消息布局 */
.skeleton-item--assistant {
  justify-content: flex-start;
}

/* 用户消息布局（右对齐） */
.skeleton-item--user {
  justify-content: flex-end;
}

/* 内容包装器 */
.skeleton-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.skeleton-item--user .skeleton-wrapper {
  align-items: flex-end;
}

/* 元信息行（模型名称 + 头像） */
.skeleton-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

/* 头像占位（仅 AI 消息有，22px 对齐 Avatar 组件） */
.skeleton-avatar {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background-color: var(--el-fill-color-darker);
  flex-shrink: 0;
}

/* 消息内容区 */
.skeleton-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 85%;
}

/* 用户消息内容区（右对齐，宽度更窄） */
.skeleton-content--user {
  align-items: flex-end;
  width: 50%;
}

/* 占位线条 */
.skeleton-line {
  height: 16px;
  border-radius: 4px;
  background-color: var(--el-fill-color-darker);
  width: 100%;
}

.skeleton-line--meta {
  width: 120px;
  height: 14px;
}

.skeleton-line--short {
  width: 60%;
}

.skeleton-line--medium {
  width: 80%;
}

.skeleton-line--long {
  width: 100%;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

/* 暗色模式适配 */
:global(html.dark) .skeleton-avatar,
:global(html.dark) .skeleton-line {
  background-color: var(--el-fill-color-dark);
}
</style>
