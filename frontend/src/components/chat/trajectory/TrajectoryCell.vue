<template>
  <!--
    消息行：事件列（回合轨 + 徽章右贴内容列）+ 内容列原文单行省略。
    整行点击展开/收起；展开区逐块卡片（mono 12px/19px、媒体占位标注、复制）。
  -->
  <div
    class="cv-row grid grid-cols-[50px_1fr] border-b-[0.5px] border-(--gd-color-border)/40 hover:bg-(--gd-color-sidebar-bg-hover) cursor-pointer"
    :class="row.deletedTurn ? 'opacity-50' : ''"
    @click="emit('toggle', row.key)"
  >
    <div class="relative h-[30px]">
      <span class="absolute left-0 top-0 bottom-0 w-[2px] bg-(--gd-trajectory-turn-rail)"></span>
      <span
        class="absolute right-[4px] top-1/2 -translate-y-1/2 inline-flex h-[19px] px-[5px] whitespace-nowrap rounded-[4px] text-[10px] leading-[16px] font-[650] tracking-[0.035em]"
        :class="roleBadgeClass"
        :data-trajectory-role="node.role"
      >
        {{ roleLabel }}
      </span>
    </div>
    <div class="flex items-center min-w-0 pl-[4px] pr-[8px]">
      <!-- 工具行：mono 工具名 + 载荷（分离字重） -->
      <span v-if="toolName" class="shrink-0 font-mono text-[12px] leading-[18px] text-(--gd-color-text)">
        {{ toolName }}
      </span>
      <span class="block min-w-0 ml-[7px] whitespace-nowrap overflow-hidden text-ellipsis text-(--gd-color-text-gray)">
        {{ rawText }}
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
    </div>

    <!-- 展开全文：点击展开区不收起；文本块不重复标注类型，复制按钮悬停浮现 -->
    <div v-if="expanded" class="col-start-2 px-[12px] pb-[8px] space-y-1" @click.stop>
      <div
        v-for="(block, bi) in node.content"
        :key="bi"
        class="group relative rounded-[6px] bg-(--gd-color-sidebar-bg-hover) px-[10px] py-[6px] max-h-48 overflow-y-auto"
      >
        <span
          v-if="block.type !== 'text'"
          class="mb-1 block text-[10px] font-medium text-(--gd-color-text-gray)"
        >{{ blockKindLabel(block) }}</span>
        <button
          type="button"
          class="absolute top-[4px] right-[4px] w-5 h-5 inline-flex items-center justify-center rounded text-(--gd-color-text-gray) opacity-0 group-hover:opacity-100 hover:bg-(--gd-color-sidebar-bg-active)"
          @click="copyBlock(block)"
        >
          <Copy16Regular class="w-3 h-3" />
        </button>
        <!-- 媒体占位标注（媒体预算替换：模型该次看到的是占位文本） -->
        <div
          v-if="overlayNote(bi)"
          class="mb-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px]"
        >
          {{ t('trajectory.mediaOverlay') }}
        </div>
        <pre class="whitespace-pre-wrap break-words font-mono text-[12px]/[19px] text-(--gd-color-text)">{{ blockToText(block) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 台账消息行：kind 徽章事件列（右贴内容列）+ 内容原文单行省略 + 整行点击展开。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Copy16Regular } from '@vicons/fluent';
import type { ContentBlock } from '@/types/stream/content-block.types';
import type { LedgerMessageRow } from '@/composables/useTrajectory';
import { blockToText, overlayFor, stripMarkdown } from '@/composables/useTrajectory';
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
  if (props.row.transient) return t('trajectory.role.inject');
  return t(`trajectory.role.${node.value.role}`);
});

const roleBadgeClass = computed(() => {
  if (props.row.transient) {
    return 'bg-violet-500/15 text-violet-500';
  }
  switch (node.value.role) {
    case 'user':
      return 'bg-(--gd-trajectory-user)/15 text-(--gd-trajectory-user)';
    case 'assistant':
      return 'bg-(--gd-trajectory-reasoning)/15 text-(--gd-trajectory-reasoning)';
    case 'tool':
      return 'bg-(--gd-trajectory-tool-call)/15 text-(--gd-trajectory-tool-call)';
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

/** 内容列文本：正文 text 块拼接 + markdown 转纯文本（reasoning 放详情），换行压空格，单行省略交给 CSS */
const rawText = computed(() => {
  // 工具行：取 tool-result 的内容文本（dsh 同款：名称 + 结果预览）
  for (const block of node.value.content) {
    if (block.type === 'tool-result') {
      return stripMarkdown(block.content ?? '') || '—';
    }
  }
  const t = (node.value.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => stripMarkdown((b as { text: string }).text))
    .join(' ')
    .trim();
  return t || '—';
});

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
