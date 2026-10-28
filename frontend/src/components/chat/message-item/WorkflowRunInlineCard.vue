<template>
  <!-- workflow_run 工具调用处原地渲染（独立渲染行：无通用工具头/折叠箭头）：
       头行＝状态点 + 名称 + 进度/耗时 + 详情入口（点击折叠整卡）；
       正文＝描述 + 成员树 + 日志折叠 + 失败错误行/返回值折叠。
       整行由本卡承担——通用 IO 区（输入脚本 + 最长 30k 字符的返回值）不再渲染，
       脚本不展示，返回值收进下方默认收起的折叠，避免摊开刷屏。 -->
  <div class="wf-card">
    <div class="wf-card-head" @click="collapsed = !collapsed">
      <WorkflowStatusDot :status="status" />
      <svg class="wf-card-chevron" :class="{ 'is-open': !collapsed }" width="11" height="11" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
      <span class="wf-card-name" :class="{ 'is-shimmer': starting }" :title="title">{{ title }}</span>
      <span class="wf-card-meta">{{ metaText }}</span>
      <GdTooltip v-if="openWorkflowTab" :content="t('chat.workspace.workflowTab')" placement="bottom">
        <button class="wf-card-detail" @click.stop="openWorkflowTab?.(props.sessionId)">
          <el-icon :size="14">
            <Flowchart20Regular />
          </el-icon>
        </button>
      </GdTooltip>
    </div>
    <div v-if="!collapsed" class="wf-card-body">
      <p v-if="description" class="wf-card-desc">{{ description }}</p>
      <WorkflowMemberTree :agents="agents" :can-open="!!openSubAgent"
        @open="(subSessionId: string) => openSubAgent?.(subSessionId)" />
      <!-- 日志（编排脚本 log() 播报）：默认收起，运行中是想看"在做什么"时的第二视图 -->
      <button v-if="logs.length" class="wf-card-fold" @click="logsExpanded = !logsExpanded">
        <el-icon :size="10" class="wf-card-fold-chevron" :class="{ 'is-open': logsExpanded }">
          <ArrowDown />
        </el-icon>
        <span>{{ t('chat.workspace.workflowLogs', { count: logs.length }) }}</span>
      </button>
      <div v-if="logsExpanded" class="wf-card-logs">
        <div v-for="(line, i) in logs" :key="i" class="wf-card-log-line">{{ line }}</div>
      </div>
      <!-- 失败就地给原因：调用处是用户找失败原因的第一落点（详情/返回值为第二落点） -->
      <div v-if="run?.errorMessage" class="wf-card-error">
        <div class="wf-card-error-title">{{ t('chat.workspace.workflowError') }}</div>
        <pre class="wf-card-error-pre">{{ run.errorMessage }}</pre>
      </div>
      <!-- 返回值（脚本 return）：优先快照 result（干净 JSON），回落工具结果文本
           （绑不到 run 的历史归档只有后者）。默认收起——返回值可能很长 -->
      <template v-else-if="resultText">
        <button class="wf-card-fold" @click="resultExpanded = !resultExpanded">
          <el-icon :size="10" class="wf-card-fold-chevron" :class="{ 'is-open': resultExpanded }">
            <ArrowDown />
          </el-icon>
          <span>{{ t('chat.workspace.workflowResult') }}</span>
        </button>
        <pre v-if="resultExpanded" class="wf-card-pre">{{ resultText }}</pre>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElIcon } from "element-plus";
import { ArrowDown } from "@element-plus/icons-vue";
import { Flowchart20Regular } from "@vicons/fluent";
import { parse as partialParse } from "partial-json";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import WorkflowStatusDot from "@/components/chat/workflow/WorkflowStatusDot.vue";
import WorkflowMemberTree from "@/components/chat/workflow/WorkflowMemberTree.vue";
import { useWorkflowRunsStore } from "@/stores/workflowRuns";
import { getToolArgs, getToolConfig, type ToolCall } from "@/utils/toolDisplay";
import { extractResultContent } from "@/utils/toolResult";
import { formatWorkflowResult, workflowRunMetaText, workflowStatusText } from "@/utils/workflowDisplay";
import type { ToolCallResponseEntry } from "@/types/message";
import type { WorkflowMemberStatus, WorkflowRunState } from "@/types/stream/workflow.types";

const props = defineProps<{
  /** 工具调用（id 是 run 的关联键；流式期间 arguments 为半截 JSON） */
  tool: ToolCall;
  /** 工具结果条目（返回值折叠用；运行中为空） */
  response?: ToolCallResponseEntry;
  /** 工具执行中（run 尚未产出快照时先按参数渲染「启动中」头） */
  executing?: boolean;
  /** 会话 id（基线加载用；缺省宿主下卡片仍可渲染，只是不自拉基线） */
  sessionId?: string;
}>();

const { t } = useI18n();
const tr = (key: string) => t(key);
const store = useWorkflowRunsStore();

/** 整卡折叠态（默认展开：正文即进度本身，运行中要"边跑边看"） */
const collapsed = ref(false);
/** 日志/返回值折叠态（默认收起，段内容可能很长） */
const logsExpanded = ref(false);
const resultExpanded = ref(false);

// 基线加载：卡片是"本会话有 run"的第一消费方之一；幂等去重，随会话切换重试
watch(
  () => props.sessionId,
  (sid) => {
    if (sid) void store.ensureLoaded(sid);
  },
  { immediate: true },
);

/** 按 toolCallId 绑定本次运行（run-start 首条事件下发关联键；快照同字段保证刷新后仍可绑定） */
const run = computed<WorkflowRunState | null>(() =>
  props.tool.id ? store.findRunByToolCallId(props.tool.id) : null,
);

/** 参数对象（getToolArgs 可能返回原始 JSON 字符串，流式期间还是半截 JSON） */
const args = computed<Record<string, unknown>>(() => {
  const raw = getToolArgs(props.tool);
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = partialParse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
});

/** 名称：run.name（后端权威）优先，回落 args.name（run-start 到达前即可用），
 *  再回落插件展示文案（模型还在写参数时也要有稳定的头）。 */
const title = computed(() => {
  if (run.value?.name) return run.value.name;
  const name = args.value.name;
  if (typeof name === "string" && name) return name;
  return getToolConfig(props.tool).text.executing;
});

const description = computed(() => {
  if (run.value?.description) return run.value.description;
  const text = args.value.description;
  return typeof text === "string" ? text : "";
});

const status = computed<WorkflowMemberStatus>(() => {
  if (run.value) return run.value.status;
  // 绑不到 run（历史归档无关联键 / 宿主无会话）：按工具结果推导终态，不假装在跑
  return props.executing === false ? statusFromOutcome() : "running";
});

/** 无 run 绑定时的终态（工具已结束）：工具 outcome 是唯一可得的口径 */
function statusFromOutcome(): WorkflowMemberStatus {
  const outcome = props.tool.outcome;
  if (outcome === "error" || outcome === "rejected") return "failed";
  if (outcome === "aborted") return "cancelled";
  return "completed";
}

/** 启动中（工具已开始执行但 run 快照未到）：标题走 shimmer，与子代理行同款"进行中"视觉 */
const starting = computed(() => !run.value && props.executing !== false);

const metaText = computed(() => {
  if (run.value) return workflowRunMetaText(tr, run.value);
  return props.executing === false
    ? workflowStatusText(tr, statusFromOutcome())
    : tr("chat.workspace.wfStarting");
});

const agents = computed(() => run.value?.agents ?? []);
const logs = computed(() => run.value?.logs ?? []);

/** 返回值文本：优先快照 result（干净 JSON），回落工具结果文本 */
const resultText = computed(() => {
  if (run.value?.result !== undefined) return formatWorkflowResult(run.value.result);
  if (!props.response) return "";
  const content = extractResultContent(props.response);
  if (content === undefined || content === null || content === "") return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
});

// 成员行点击 → 跳转子代理会话 / 头部详情 → 工作流审阅标签（均复用 ChatPage provide；
// 无 provide 的宿主如 Bot 会话面板下入口不渲染/不可点）
const openSubAgent = inject<((subSessionId: string) => void) | null>(
  "workspace:openSubAgentSession",
  null,
);
const openWorkflowTab = inject<((sessionId?: string) => void) | null>(
  "workspace:openWorkflowTab",
  null,
);
</script>

<style scoped>
/* 卡壳（对齐计划卡）：自带边框/底色/圆角——独立渲染行不再套通用工具结果外框 */
.wf-card {
  border: 1px solid var(--gd-color-surface-border, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  overflow: hidden;
  background: var(--gd-color-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.wf-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 34px;
  min-width: 0;
  cursor: pointer;
  user-select: none;
}
.wf-card-head:hover {
  background: var(--gd-color-sidebar-bg-hover);
}
.wf-card-chevron {
  flex-shrink: 0;
  color: var(--gd-color-text-disabled);
  transition: transform 0.15s ease;
}
.wf-card-chevron.is-open {
  transform: rotate(90deg);
}
.wf-card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gd-size-text-base);
  font-weight: 500;
  color: var(--gd-color-text);
}
/* 启动中波纹（与 SubAgentToolRow 的进行中标题同款视觉） */
.is-shimmer {
  background: linear-gradient(90deg,
      var(--gd-shimmer-base, #a8aab3) 0%,
      var(--gd-shimmer-base, #a8aab3) 25%,
      var(--gd-shimmer-highlight, #ffffff) 50%,
      var(--gd-shimmer-base, #a8aab3) 75%,
      var(--gd-shimmer-base, #a8aab3) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: wf-card-shimmer-slide 1.5s linear infinite;
}
@keyframes wf-card-shimmer-slide {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
.wf-card-meta {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}
.wf-card-detail {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-disabled);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}
.wf-card-head:hover .wf-card-detail {
  opacity: 1;
}
.wf-card-detail:hover {
  color: var(--gd-color-text);
  background: var(--gd-color-surface-hover);
}

.wf-card-body {
  padding: 2px 10px 8px;
}

.wf-card-desc {
  margin: 0 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 17px;
  color: var(--gd-color-text-gray);
}

/* 日志折叠开关 */
.wf-card-fold {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 4px 0 0;
  padding: 1px 2px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-gray);
  text-align: left;
}
.wf-card-fold:hover {
  color: var(--gd-color-text);
}
.wf-card-fold-chevron {
  transition: transform 0.15s;
}
.wf-card-fold-chevron.is-open {
  transform: rotate(180deg);
}
.wf-card-logs {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--gd-color-surface, rgba(128, 128, 128, 0.06));
  max-height: 160px;
  overflow-y: auto;
}
.wf-card-log-line {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  line-height: 18px;
  color: var(--gd-color-text-gray);
  word-break: break-all;
}

/* 返回值 pre（与日志块同款：等宽、限高、内部滚动） */
.wf-card-pre {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--gd-color-surface, rgba(128, 128, 128, 0.06));
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  line-height: 18px;
  color: var(--gd-color-text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}

.wf-card-error {
  margin-top: 6px;
}
.wf-card-error-title {
  margin-bottom: 3px;
  font-size: 11px;
  line-height: 16px;
  color: var(--gd-color-text-disabled);
}
.wf-card-error-pre {
  margin: 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: color-mix(in srgb, #ef4444 8%, transparent);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  line-height: 18px;
  color: #ef4444;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
</style>
