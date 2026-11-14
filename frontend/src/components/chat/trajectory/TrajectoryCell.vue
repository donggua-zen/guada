<template>
  <!-- 消息行：角色标签 + 单行摘要 + 展开/复制（对齐 dsh TrajectoryCell 的精简版） -->
  <!-- 消息行：整行可点展开/收起（箭头仅作指示器）；对齐 dsh 台账行交互 -->
  <div
    class="cv-row border-b border-(--gd-color-border)/40 cursor-pointer hover:bg-(--gd-color-sidebar-bg-hover)/60"
    @click="emit('toggle', row.key)"
  >
    <div class="px-2 py-1 flex items-start gap-1.5">
      <span
        class="shrink-0 mt-0.5 inline-flex px-1 rounded text-(10px) font-medium"
        :class="roleBadgeClass"
        :data-trajectory-role="node.role"
      >
        {{ roleLabel }}
      </span>
      <span v-if="toolName" class="shrink-0 max-w-24 truncate text-(10px) text-(--gd-trajectory-tool-call)">
        {{ toolName }}
      </span>
      <span class="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-(--gd-color-text)">
        {{ summary }}
      </span>
      <!-- 子代理会话跳转（meta.link = sub_agent；对齐 SubAgentToolRow 的跳转语义） -->
      <button
        v-if="subAgentSessionId"
        type="button"
        class="shrink-0 px-1 rounded text-(10px) bg-(--gd-trajectory-user)/15 text-(--gd-trajectory-user) hover:bg-(--gd-trajectory-user)/25"
        @click.stop="emit('open-sub-trajectory', subAgentSessionId!)"
      >
        {{ t('trajectory.openSubTrajectory') }}
      </button>
      <span class="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-(--gd-color-text-gray)">
        <ChevronDown16Regular v-if="expanded" class="w-3 h-3" />
        <ChevronRight16Regular v-else class="w-3 h-3" />
      </span>
    </div>

    <!-- 展开全文（pre-wrap + 滚动上限）；点击展开区不收起 -->
    <div v-if="expanded" class="px-2 pb-2 space-y-1" @click.stop>
      <div
        v-for="(block, bi) in node.content"
        :key="bi"
        class="rounded-md bg-(--gd-color-sidebar-bg-hover) px-2 py-1.5 max-h-48 overflow-y-auto"
      >
        <div class="flex items-center gap-1 mb-1">
          <span class="text-(10px) font-medium text-(--gd-color-text-gray)">{{ blockKindLabel(block) }}</span>
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
          class="mb-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-(10px)"
        >
          {{ t('trajectory.mediaOverlay') }}
        </div>
        <pre class="whitespace-pre-wrap break-words text-(11px) leading-snug text-(--gd-color-text) font-mono">{{ blockToText(block) }}</pre>
      </div>
      <div class="text-(10px) text-(--gd-color-text-gray)">
        seq {{ node.seq }} · {{ regionLabel }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 台账消息行：角色配色徽标 + 单行摘要 + Chevron 展开全文 + 复制。
 * region 区分 prefix/in/transient/out（徽标注释了行在请求中的角色）。
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
  switch (props.row.region) {
    case 'transient':
      return t('trajectory.role.inject');
    case 'out':
      return t(`trajectory.role.${node.value.role}`);
    default:
      return t(`trajectory.role.${node.value.role}`);
  }
});

const roleBadgeClass = computed(() => {
  if (props.row.region === 'transient') {
    return 'bg-violet-500/15 text-violet-500';
  }
  switch (node.value.role) {
    case 'user':
      return 'bg-(--gd-trajectory-user)/15 text-(--gd-trajectory-user)';
    case 'assistant':
      return 'bg-(--gd-trajectory-assistant)/15 text-(--gd-trajectory-assistant)';
    case 'tool':
      return 'bg-(--gd-trajectory-tool-result)/15 text-(--gd-trajectory-tool-result)';
    default:
      return 'bg-(--gd-color-sidebar-bg-hover) text-(--gd-color-text-gray)';
  }
});

/** 工具行取工具名（tool-call / tool-result 块；call_ 前缀剥离展示） */
const toolName = computed(() => {
  for (const block of node.value.content) {
    if (block.type === 'tool-call' || block.type === 'tool-result') return block.name;
  }
  return null;
});

/** 子代理关联（tool-result meta.link.type='sub_agent' → subSessionId；对齐 resolveSubAgentLink 的落库链路） */
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

<style scoped>
.cv-row {
  content-visibility: auto;
  contain-intrinsic-height: auto 28px;
}
</style>
