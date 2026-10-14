<template>
  <!-- 子代理列表面板：本会话全部子代理（活跃段 + 已结束段）。
       活跃 = 未冻结（运行中/已完成/失败），已结束 = 后端 closedAt 冻结（仅供回放，点击重开只读会话）。
       数据源：ChatPage 维护的 subSessions（含已冻结项）经 WorkspaceSidebar 下传；
       运行状态读 sessionStore.streamStatus（与标签运行点/输入区胶囊同源）。
       已结束回放的唯一入口——原概览面板「子代理」区迁出后由此承载。 -->
  <div class="subagent-list h-full w-full flex flex-col overflow-hidden">
    <div class="sl-toolbar shrink-0 flex items-center justify-between px-3 h-9">
      <span class="sl-title">{{ t('chat.workspace.subagents') }}</span>
      <span v-if="items.length" class="sl-count">{{ items.length }}</span>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
      <div v-if="!items.length" class="sl-empty">{{ t('chat.workspace.subagentListEmpty') }}</div>

      <!-- 活跃段（行不套 tooltip：面板宽度足够，名称截断极少见；套 GdTooltip 的
           inline 包装器还会把行压成内容宽、hover 底色铺不满，故行直接作为 flex 列子项铺满） -->
      <div v-if="active.length" class="sl-group">
        <div v-for="item in active" :key="item.id" class="sl-row"
          :class="{ 'sl-row--clickable': !!openSubAgent }" @click="openSubAgent?.(item.id)">
          <WorkflowStatusDot :status="dotStatus(item)" size="sm" />
          <img v-if="item.avatarUrl" :src="item.avatarUrl" class="sl-avatar" alt="" />
          <span class="sl-name">{{ item.title }}</span>
          <span class="sl-status">{{ statusText(item) }}</span>
        </div>
      </div>

      <!-- 已结束段：常显（本面板是独立标签、纵向空间充足，折叠只是多余的一次点击；
           原概览区块的默认收起是为窄条浮层防历史挤占首屏，此约束在这里不存在） -->
      <template v-if="frozen.length">
        <div class="sl-group-label">{{ t('chat.workspace.subagentsEnded', { count: frozen.length }) }}</div>
        <div class="sl-group">
          <div v-for="item in frozen" :key="item.id" class="sl-row sl-row--frozen"
            :class="{ 'sl-row--clickable': !!openSubAgent }" @click="openSubAgent?.(item.id)">
            <WorkflowStatusDot :status="dotStatus(item)" size="sm" />
            <img v-if="item.avatarUrl" :src="item.avatarUrl" class="sl-avatar" alt="" />
            <span class="sl-name">{{ item.title }}</span>
            <span class="sl-status">{{ statusText(item) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import WorkflowStatusDot from "@/components/chat/workflow/WorkflowStatusDot.vue";
import { useSessionStore } from "@/stores/session";
import { buildSubagentItems, splitSubagents, type SubagentItem } from "@/utils/subagentDisplay";
import type { Session } from "@/types/session";
import type { WorkflowMemberStatus } from "@/types/stream/workflow.types";

const props = defineProps<{
  sessionId: string;
  /** 子会话列表（ChatPage 维护：SSE sub_agent_create/closed 增改 + fetchSession 基线，含已冻结的） */
  subSessions?: Session[];
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();

const items = computed(() =>
  buildSubagentItems(props.subSessions, (id) => sessionStore.peekStreamStatus(id), t("chat.workspace.subagentTab")),
);
const active = computed(() => splitSubagents(items.value).active);
const frozen = computed(() => splitSubagents(items.value).frozen);

// 行点击 → 打开子代理标签（复用 ChatPage provide；无 provide 的宿主下不可点）
const openSubAgent = inject<((subSessionId: string) => void) | null>(
  "workspace:openSubAgentSession",
  null,
);

function dotStatus(item: SubagentItem): WorkflowMemberStatus {
  if (item.status === "error") return "failed";
  return item.status;
}

function statusText(item: SubagentItem): string {
  if (item.status === "error") return t("chat.workspace.wfFailed");
  if (item.status === "running") return t("chat.workspace.wfRunning");
  return t("chat.workspace.wfCompleted");
}
</script>

<style scoped>
/* ── 工具条（与工作流审阅面板同款骨架） ── */
.sl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sl-title {
  font-size: 12px;
  color: var(--gd-color-text-gray);
}
.sl-count {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}
.sl-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}

/* ── 分组 ── */
.sl-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
/* 已结束段不额外缩进：与工作流记录面板同款（分组靠标签与灰化区分，不靠缩进） */
.sl-group-label {
  margin: 6px 0 1px;
  /* 左内边距与行盒内边距对齐，标签文字与行内容同一起点 */
  padding: 1px 6px;
  font-size: 12px;
  line-height: 17px;
  color: var(--gd-color-text-gray);
}

/* ── 行 ── */
/* 内边距与圆角对齐工作流记录面板的 .wh-run-row：hover 底色内要有呼吸感，
   内容（状态点/头像）不能贴住底色左缘 */
.sl-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 5px;
  min-width: 0;
}
.sl-row--clickable {
  cursor: pointer;
}
.sl-row--clickable:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.sl-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.sl-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gd-size-text-base);
  color: var(--gd-color-text);
}
/* 已结束行弱化（名称转灰），点击仍可重开回放 */
.sl-row--frozen .sl-name {
  color: var(--gd-color-text-gray);
}
.sl-status {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}
</style>
