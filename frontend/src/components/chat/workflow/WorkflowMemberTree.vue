<template>
  <!-- 工作流成员紧凑树（run 展开后的成员列表）：状态点 + 标签 + 次行摘要 · 状态；
       有 subSessionId 且宿主提供入口时点击跳子代理会话。
       单一来源：对话流内联卡片与工作流审阅面板共用（原概览/审阅两份 scoped 拷贝收口于此）。 -->
  <div v-if="agents.length" class="wf-agents">
    <GdTooltip v-for="agent in agents" :key="agent.callId" :content="agent.label" placement="bottom">
      <div class="wf-agent w-full" :class="{ 'wf-agent--clickable': isClickable(agent) }"
        @click="onClick(agent)">
        <div class="wf-agent-row">
          <WorkflowStatusDot :status="agent.status" size="sm" />
          <span class="wf-agent-label">{{ agent.label }}</span>
        </div>
        <div class="wf-agent-sub">{{ subText(agent) }}</div>
      </div>
    </GdTooltip>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import WorkflowStatusDot from "./WorkflowStatusDot.vue";
import { workflowAgentSubText } from "@/utils/workflowDisplay";
import type { WorkflowAgentState } from "@/types/stream/workflow.types";

const props = defineProps<{
  agents: WorkflowAgentState[];
  /** 宿主是否有子代理面板入口（无入口时成员行不可点） */
  canOpen?: boolean;
}>();

const emit = defineEmits<{ (e: "open", subSessionId: string): void }>();

const { t } = useI18n();
const tr = (key: string) => t(key);

function isClickable(agent: WorkflowAgentState): boolean {
  return !!props.canOpen && !!agent.subSessionId;
}

function onClick(agent: WorkflowAgentState): void {
  if (isClickable(agent)) emit("open", agent.subSessionId!);
}

function subText(agent: WorkflowAgentState): string {
  return workflowAgentSubText(tr, agent);
}
</script>

<style scoped>
.wf-agents {
  margin: 2px 0 0 0;
  display: flex;
  flex-direction: column;
}
.wf-agent {
  position: relative;
  /* 与标题行同宽同起点；左内边距容纳树形线列（线对齐标题行圆点下方） */
  padding: 2px 2px 2px 24px;
  border-radius: 4px;
}
/* GdTooltip 渲染 inline trigger 包装器：撑满行宽，hover 背景才铺满而非仅包内容 */
.wf-agents > .l-tooltip__trigger {
  display: block;
  width: 100%;
}
/* 成员行树形线（对齐 DSH 任务管理）：竖线画在行盒内部（hover 含线列），
   横肘线连到圆点；末成员竖线止于横肘。
   注意 :last-child 须取在 GdTooltip 包装层上（每个 .wf-agent 都是其包装器的唯一子元素） */
.wf-agent::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  border-left: 1px solid var(--gd-color-border, #e5e7eb);
}
.wf-agents > :last-child .wf-agent::before {
  bottom: auto;
  height: 12px;
}
.wf-agent::after {
  content: '';
  position: absolute;
  top: 12px;
  left: 8px;
  width: 13px;
  border-top: 1px solid var(--gd-color-border, #e5e7eb);
}
.wf-agent--clickable {
  cursor: pointer;
}
.wf-agent--clickable:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.wf-agent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wf-agent-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gd-size-text-base);
  color: var(--gd-color-text);
}
.wf-agent-sub {
  margin: 1px 0 0 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  /* 整数行高：11px 继承 html 的 1.5 会得到 16.5px 小数行盒 */
  line-height: 16px;
  color: var(--gd-color-text-gray);
}
</style>
