<template>
  <ToolDiffView
    v-if="info.kind === 'diff'"
    :file-path="info.args.file || ''"
    :old-text="info.args.oldValue || ''"
    :new-text="info.args.newValue || ''"
  />
  <ToolContentView
    v-else-if="info.kind === 'content'"
    :file-path="info.args.file || ''"
    :content="info.args.content || ''"
  />
  <ToolTerminalView
    v-else
    :command="info.args.command || ''"
    :output="term ? term.output : outputText"
    :is-error="isError"
    :executing="executing"
    :exit-code="term?.exitCode"
    :uptime-text="term?.uptimeText"
    :process-status="term?.processStatus"
    :backgrounded="term?.backgrounded"
    :process-id="term?.processId"
    :truncated="term?.truncated"
    :log-file-path="term?.logFilePath"
    :sandbox-note="term?.sandboxNote"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import ToolDiffView from "./ToolDiffView.vue";
import ToolContentView from "./ToolContentView.vue";
import ToolTerminalView from "./ToolTerminalView.vue";
import { extractResultContent } from "@/utils/toolResult";
import {
  parseTerminalResult,
  formatUptime,
  type TerminalResultInfo,
} from "@/utils/terminalOutput";
import type { ToolRendererInfo } from "@/utils/toolDisplay";
import type { ToolCallResponseEntry } from "@/types/message";

const props = defineProps<{
  /** getToolRenderer + getRendererArgs 的解析结果 */
  info: ToolRendererInfo;
  /** 对应 toolResponses 条目（结果），terminal 视图展示其输出 */
  response?: ToolCallResponseEntry;
  isError?: boolean;
  executing?: boolean;
}>();

/** 工具结果文本（含元数据标记；terminal 卡片从这里解析剥离） */
const outputText = computed(() => {
  if (!props.response) return "";
  const content = extractResultContent(props.response);
  if (!content) return "";
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
});

/** 工具结果 meta（card: "terminal" 时为新契约的结构化来源；后端 meta 即 card + 各卡片自定义字段的开放字典） */
const resultMeta = computed<Record<string, any> | null>(() => {
  const m = props.response?.meta;
  return m && m.card === "terminal" ? m : null;
});

/**
 * 终端结构化状态：meta 优先（权威），解析器兜底（历史会话）；
 * 两者皆无 → null，视图回退原样展示。
 */
const term = computed<
  | (TerminalResultInfo & { output: string })
  | null
>(() => {
  if (props.info.kind !== "terminal") return null;
  const m = resultMeta.value;
  const p = outputText.value ? parseTerminalResult(outputText.value) : null;
  if (!m && !p) return null;
  // 退出码语义：number = 正常 pill；null = 异常退出（红 pill）；undefined = 无退出码（后台/运行中，不显示 pill）
  const exitCode = m
    ? m.exitCode !== undefined
      ? (m.exitCode as number | null)
      : undefined
    : p?.exitCode;
  return {
    body: p?.body ?? "",
    output: p ? p.body : outputText.value,
    exitCode,
    uptimeText:
      m?.uptimeMs != null
        ? formatUptime(m.uptimeMs)
        : (p?.uptimeText ?? undefined),
    processStatus: m?.processStatus ?? p?.processStatus,
    backgrounded: m?.backgrounded ?? p?.backgrounded ?? false,
    processId: m?.processId ?? p?.processId,
    truncated: m?.truncated ?? p?.truncated ?? false,
    logFilePath: m?.logFilePath ?? p?.logFilePath,
    sandboxNote: m?.sandboxNote ?? p?.sandboxNote,
    recognized: true,
  };
});
</script>
