<template>
  <!--
    消息行：事件列 kind 徽章（19px 单字符）+ 内容列单行省略；整行点击展开/收起。
    展开区：逐块卡片（mono 12px/19px，媒体占位标注，复制）。
  -->
  <div
    class="cv-row grid grid-cols-[44px_1fr] border-b-[0.5px] border-(--gd-color-border)/40 cursor-pointer hover:bg-(--gd-color-sidebar-bg-hover)/60"
    @click="emit('toggle', row.key)"
  >
    <div class="relative h-[30px]">
      <span
        class="absolute top-1/2 left-1/2 -translate-1/2 inline-flex items-center justify-center h-[19px] px-[5px] whitespace-nowrap rounded-[4px] text-[10px] font-[650] leading-[16px]"
        :class="roleBadgeClass"
        :data-trajectory-role="node.role"
      >
        {{ roleLabel }}
      </span>
    </div>
    <div class="flex items-center gap-1.5 min-w-0 pr-[8px]">
      <span v-if="toolName" class="shrink-0 max-w-24 truncate text-[10px] text-(--gd-trajectory-tool-call)">
        {{ toolName }}
      </span>
      <span class="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-(--gd-color-text)">
        {{ summary }}
      </span>
      <!-- 子代理会话跳转（meta.link = sub_agent） -->
      <button
        v-if="subAgentSessionId"
        type="button"
        class="shrink-0 px-1 rounded text-[10px] bg-(--gd-trajectory-user)/15 text-(--gd-trajectory-user) hover:bg-(--gd-trajectory-user)/25"
        @click.stop="emit('open-sub-trajectory', subAgentSessionId!)"
      >
        {{ t('trajectory.openSubTrajectory') }}
      </button>
      <span class="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-(--gd-color-text-gray)">
        <ChevronDown16Regular v-if="expanded" class="w-3 h-3" />
        <ChevronRight16Regular v-else class="w-3 h-3" />
      </span>
    </div>

    <!-- 展开全文：点击展开区不收起 -->
    <div v-if="expanded" class="col-start-2 px-[8px] pb-[8px] space-y-1" @click.stop>
      <div
        v-for="(block, bi) in node.content"
        :key="bi"
        class="rounded-md bg-(--gd-color-sidebar-bg-hover) px-[12px] py-[8px] max-h-48 overflow-y-auto"
      >
        <div class="flex items-center gap-1 mb-1">
          <span class="text-[10px] font-medium text-(--gd-color-text-gray)">{{ blockKindLabel(block) }}</span>
          <button
            type="button"
            class="ml-auto w-5 h-5 inline-flex items-center justify-center rounded text-(--gd-color-text-gray) hover:bg-(--gd-color-sidebar-bg-active)"
            @click="copyBlock(block)"
          >
            <Copy16Regular class="w-3 h-3" />
          </button>
        </div>
        <!-- 媒体占位标注（媒体预算替换：模型该次看到的是占位文本） -->
        <div
          v-if="overlayNote(bi)"
          class="mb-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px]"
        >
          {{ t('trajectory.mediaOverlay') }}
        </div>
        <pre class="whitespace-pre-wrap break-words font-mono text-[12px]/[19px] text-(--gd-color-text)">{{ blockToText(block) }}</pre>
      </div>
      <div class="text-[10px] text-(--gd-color-text-gray)">
        seq {{ node.seq }} · {{ regionLabel }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 台账消息行：kind 徽章事件列 + 单行摘要 + 整行点击展开 + 复制。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ChevronDown16Regular,
  ChevronRight16Regular,
  Copy16Regular,
} from '@vicons/fluent';
import type { ContentBlock } from '@/types/stream/content-block.types';
import type { LedgerMessageRow } from '@/composables/useTrajectory';
import { blockToText, nodeToText, overlayFor } from '@/composables/useTrajectory';
import { writeTextToClipboard } from '@/utils/clipboard';
import { toast } from '@/components/ui/toastService';

const props = defineProps<{ row: LedgerMessageRow; expanded: boolean }>();
const emit = defineEmits<{
  toggle: [key: string];
  /** 子代理工具行：打开子会话轨迹（meta.link.subSessionId） */
  'open-sub-trajectory': [subSessionId: string];
}>();

const { t } = useI18n();

const node = computed(() => props.row.node);

const roleLabel = computed(() => {
  if (props.row.region === 'transient') return t('trajectory.role.inject');
  return t(`trajectory.role.${node.value.role}`);
});

const roleBadgeClass = computed(() => {
  if (props.row.region === 'transient') {
    return 'bg-violet-500/15 text-violet-500';
  }
  switch (node.value.role) {
    case 'user':
      return 'bg-(--gd-trajectory-user)/15 text-(--gd-trajectory-user)';
    case 'assistant':
      return 'bg-(--gd-trajectory-reasoning)/15 text-(--gd-trajectory-reasoning)';
    case 'tool':
      return 'bg-(--gd-trajectory-tool-result)/15 text-(--gd-trajectory-tool-result)';
    default:
      return 'bg-(--gd-trajectory-neutral-bg) text-(--gd-color-text-gray)';
  }
});

/** 工具行取工具名（tool-call / tool-result 块） */
const toolName = computed(() => {
  for (const block of node.value.content) {
    if (block.type === 'tool-call' || block.type === 'tool-result') return block.name;
  }
  return null;
});

/** 子代理关联（tool-result meta.link.type='sub_agent' → subSessionId） */
const subAgentSessionId = computed<string | null>(() => {
  for (const block of node.value.content) {
    if (block.type !== 'tool-result') continue;
    const link = (block.meta as Record<string, any> | undefined)?.link;
    if (link?.type === 'sub_agent' && typeof link.subSessionId === 'string' && link.subSessionId) {
      return link.subSessionId;
    }
  }
  return null;
});

const fullText = computed(() => nodeToText(node.value));
const summary = computed(() => fullText.value.replace(/\s+/g, ' ').slice(0, 300) || '—');

const regionLabel = computed(() => t(`trajectory.region.${props.row.region}`));

function blockKindLabel(block: ContentBlock): string {
  return t(`trajectory.block.${block.type}`);
}

function overlayNote(blockIndex: number): string | null {
  return overlayFor(props.row.step, node.value.id, blockIndex);
}

async function copyBlock(block: ContentBlock): Promise<void> {
  const ok = await writeTextToClipboard(blockToText(block));
  if (ok) toast.success(t('common.copySuccess'));
}
</script>
