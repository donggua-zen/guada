<template>
  <!-- 侧边栏子代理会话标签：托管一个只读 ChatPanel 实例（与中央主会话同屏并存）。
       历史加载/流式跟随/滚动均为 ChatPanel 实例内部状态；消息数据来自按 sessionId
       键控的 session store（后台子代理事件已由常驻 subscribeAll 链路持续投影）。 -->
  <div class="h-full w-full flex flex-col overflow-hidden">
    <ChatPanel :session="session ?? null" :session-id="subSessionId" readonly hide-header />
  </div>
</template>

<script setup lang="ts">
import ChatPanel from '../ChatPanel.vue';
import type { Session } from '@/types/session';

defineProps<{
  /** 子代理会话 ID（标签 key `subagent:<id>` 的 id 部分） */
  subSessionId: string;
  /** 子代理会话元数据（ChatPage 的 subSessions 解析；历史回放等场景可能暂缺，ChatPanel 按 sessionId 兜底加载） */
  session?: Session | null;
}>();
</script>
