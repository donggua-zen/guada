/**
 * useTrajectory — 轨迹台账数据 + 台账行派生（审计视图：日志全量事件，一事件一行）
 *
 * 台账行模型（kind 判别联合）：
 * - 'turn-header'  回合分界线（turn/start 事件；编号按首现顺序，含已删除回合）
 * - 'system'       SYSTEM 快照行（envelope 事件，按 seq 插进台账流）
 * - 'message'      消息行（用户/助手/工具表面事件 + step/start 携带的瞬态注入）
 * - 'event'        通用事件行（step/start|end、context/stats、turn/finish、compaction、
 *                  turn/delete、未知事件——每条日志事件都必须出现在台账里）
 *
 * 审计纪律：turn/delete 只标记不回溯删除——被删回合的消息照常列出并置灰；
 * 消息行一律来自原始事件（不做 IN/OUT 区间重复切片），每条消息只出现一次。
 * 展开状态存 Panel 层 Set（跨卸载存活）。
 */
import { ref, computed, type Ref } from 'vue';
import { apiService } from '@/services/ApiService';
import type {
  TrajectoryEnvelopeSnapshot,
  TrajectoryEventView,
  TrajectoryMessageNode,
  TrajectoryStepView,
  TrajectoryView,
} from '@/services/modules/trajectory.api';
import type { ContentBlock } from '@/types/stream/content-block.types';

// ─── 台账行模型 ───

export interface LedgerMessageRow {
  key: string;
  kind: 'message';
  node: TrajectoryMessageNode;
  /** 瞬态注入（step/start 携带的 transient/fullInput；徽章用「注入」） */
  transient: boolean;
  /** 所属回合已被 turn/delete 删除 → 置灰（审计仍可见） */
  deletedTurn: boolean;
  /** 宿主 step（媒体占位标注用；旧步或缺页时为 null） */
  step: TrajectoryStepView | null;
}

export interface LedgerTurnRow {
  key: string;
  kind: 'turn-header';
  /** 回合编号（turnId 首现顺序，含已删除回合） */
  label: string;
  deletedTurn: boolean;
}

/** SYSTEM 快照行（envelope 事件，按 seq 插进台账流） */
export interface LedgerSystemRow {
  key: string;
  kind: 'system';
  envelope: TrajectoryEnvelopeSnapshot;
  /** 序号（1..N，事件序） */
  number: number;
  /** 上一条快照（展开态 diff 用；首条为 null） */
  previous: TrajectoryEnvelopeSnapshot | null;
}

/** 通用事件行：日志里除信封/表面消息外的一切事件（原样可展开审计） */
export interface LedgerEventRow {
  key: string;
  kind: 'event';
  event: TrajectoryEventView;
  /** turn/delete 行：被删除回合的编号（摘要文案用） */
  deletedTurnNumber?: number;
  /** 位于已删除回合区间内 → 置灰（审计仍可见） */
  deletedTurn?: boolean;
}

export type LedgerRow =
  | LedgerMessageRow
  | LedgerTurnRow
  | LedgerSystemRow
  | LedgerEventRow;

// ─── 内容块文本化（单行摘要 + 展开全文共用） ───

export function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'reasoning':
      return block.summary;
    case 'tool-call':
      return `${block.name}(${block.arguments ?? ''})`;
    case 'tool-result':
      return block.content;
    case 'image':
      return '[image]';
    case 'file':
      return '[file]';
    default:
      return `[${(block as { type: string }).type}]`;
  }
}

/** markdown → 纯文本（行内展示用）：剥粗体/斜体/行内码/标题/列表符/表格分隔 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/^\s*\|.*\|\s*$/gm, (line) => (line.match(/^\s*\|?[\s:|-]+\|?\s*$/) ? '' : line.replace(/\|/g, ' ')))
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

export function nodeToText(node: TrajectoryMessageNode): string {
  return (node.content ?? [])
    .map(blockToText)
    .filter((t) => t.length > 0)
    .join('\n');
}

/** 媒体占位标注：该消息该块在本次请求中被替换为占位文本 */
export function overlayFor(
  step: TrajectoryStepView | null,
  messageId: string,
  blockIndex: number,
): string | null {
  if (!step?.mediaOverlay) return null;
  const hit = step.mediaOverlay.find(
    (o) => o.messageId === messageId && o.blockIndex === blockIndex,
  );
  return hit ? hit.placeholder : null;
}

// ─── 组合式 ───

export function useTrajectory(sessionId: Ref<string | null | undefined>) {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const view = ref<TrajectoryView | null>(null);
  const search = ref('');
  /** 展开状态（Panel 层 Set，跨卸载存活；key = row.key） */
  const expanded = ref(new Set<string>());

  async function refresh(limit = 200): Promise<void> {
    const sid = sessionId.value;
    if (!sid) {
      view.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      view.value = await apiService.fetchTrajectory(sid, { limit });
    } catch (e: any) {
      error.value = e?.message ?? String(e);
      view.value = null;
    } finally {
      loading.value = false;
    }
  }

  function toggleExpand(key: string): void {
    const next = new Set(expanded.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded.value = next;
  }

  function expandAll(all: boolean): void {
    if (!all) {
      expanded.value = new Set();
      return;
    }
    const next = new Set<string>();
    for (const row of rows.value) {
      if (row.kind === 'message') next.add(row.key);
    }
    expanded.value = next;
  }

  /** 全部 envelope 快照（事件序；SYSTEM 变更历史） */
  const envelopes = computed(() => view.value?.envelopes ?? []);

  /** 消息所属 step（媒体占位标注用）：seq 落在 [startSeq, endSeq] 区间 */
  function stepForSeq(
    seq: number,
    steps: TrajectoryStepView[],
  ): TrajectoryStepView | null {
    for (const s of steps) {
      const end = s.endSeq ?? Number.MAX_SAFE_INTEGER;
      if (seq >= s.startSeq && seq <= end) return s;
    }
    return null;
  }

  /** 台账行派生：原始事件流逐条成行（审计视图，含已删除轮次） */
  const rows = computed<LedgerRow[]>(() => {
    const out: LedgerRow[] = [];
    const evs = view.value?.events ?? [];
    if (evs.length === 0) return out;

    const envelopesBySeq = new Map(envelopes.value.map((e) => [e.seq, e]));
    const steps = view.value?.steps ?? [];
    // 先收集删除标记：被删回合的消息行与回合头统一置灰
    const deletedTurns = new Set<string>();
    for (const ev of evs) {
      if (ev.type === 'turn/delete') {
        const tid = (ev.data as { turnId?: string } | undefined)?.turnId;
        if (tid) deletedTurns.add(tid);
      }
    }

    const turnNumbers = new Map<string, number>();

    /**
     * 行序规则：初始系统提示词（envelope.reason='initial'）钉在全表
     * 最顶；其余快照（含 change）留在原始 seq 位置（用户消息之后）。
     */
    let sysCounter = 0;
    let lastSys: TrajectoryEnvelopeSnapshot | null = null;
    const initialEnvelope = envelopes.value.find((e) => e.reason === 'initial') ?? null;
    if (initialEnvelope) {
      sysCounter += 1;
      out.push({
        key: `sys:${initialEnvelope.seq}`,
        kind: 'system',
        envelope: initialEnvelope,
        number: sysCounter,
        previous: null,
      });
      lastSys = initialEnvelope;
    }

    for (const ev of evs) {
      switch (ev.type) {
        case 'turn/start': {
          const tid = (ev.data as { turnId?: string } | undefined)?.turnId ?? '';
          if (!turnNumbers.has(tid)) turnNumbers.set(tid, turnNumbers.size + 1);
          out.push({
            key: `turn:${tid}`,
            kind: 'turn-header',
            label: `${turnNumbers.get(tid)}`,
            deletedTurn: deletedTurns.has(tid),
          });
          break;
        }
        case 'turn/delete': {
          const tid = (ev.data as { turnId?: string } | undefined)?.turnId ?? '';
          out.push({
            key: `ev:${ev.seq}`,
            kind: 'event',
            event: ev,
            ...(turnNumbers.has(tid) ? { deletedTurnNumber: turnNumbers.get(tid) } : {}),
          });
          break;
        }
        case 'envelope': {
          if (ev.seq === initialEnvelope?.seq) break; // 已钉在全表最顶
          const env = envelopesBySeq.get(ev.seq);
          if (env) {
            sysCounter += 1;
            out.push({
              key: `sys:${ev.seq}`,
              kind: 'system',
              envelope: env,
              number: sysCounter,
              previous: lastSys,
            });
            lastSys = env;
          }
          break;
        }
        case 'user/message':
        case 'assistant/message':
        case 'tool/result': {
          if (!ev.node) break;
          const node = ev.node;
          out.push({
            key: `m:${ev.seq}`,
            kind: 'message',
            node,
            transient: false,
            deletedTurn: node.turnId ? deletedTurns.has(node.turnId) : false,
            step: stepForSeq(ev.seq, steps),
          });
          break;
        }
        case 'step/start': {
          // 请求侧注入（transient/fullInput）：注入内容才是台账内容，调用开始本身是流水
          const data = ev.data as
            | { transient?: TrajectoryMessageNode[]; fullInput?: TrajectoryMessageNode[] }
            | undefined;
          const host = stepForSeq(ev.seq, steps);
          for (const node of data?.transient ?? []) {
            out.push({
              key: `m:${node.id}:inject`,
              kind: 'message',
              node,
              transient: true,
              deletedTurn: false,
              step: host,
            });
          }
          for (const node of data?.fullInput ?? []) {
            out.push({
              key: `m:${node.id}:fullinput`,
              kind: 'message',
              node,
              transient: true,
              deletedTurn: false,
              step: host,
            });
          }
          break;
        }
        default:
          // 流水事件（session/init、context/stats、step/end、turn/finish、compaction、
          // 未知事件…）不属于台账内容——审计价值在于消息与快照本身
          break;
      }
    }
    return out;
  });

  /** 搜索过滤（空白分词 + AND 子串匹配；回合/信封/删除锚点行始终保留） */
  const filteredRows = computed<LedgerRow[]>(() => {
    const all = rows.value;
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return all;

    const rowText = (row: LedgerRow): string => {
      if (row.kind === 'message') return nodeToText(row.node).toLowerCase();
      if (row.kind === 'system') {
        const e = row.envelope;
        return [
          e.reason, e.model, e.provider,
          ...(e.tools ?? []).map((x) => x.name),
          e.system,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
      }
      if (row.kind === 'event') {
        return `${row.event.type} ${JSON.stringify(row.event.data ?? {})}`.toLowerCase();
      }
      return '';
    };

    const matches = (text: string) => terms.every((term) => text.includes(term));
    return all.filter((row) => {
      // 结构锚行（回合分界 / 信封 / turn/delete）始终保留
      if (row.kind === 'turn-header' || row.kind === 'system') return true;
      if (row.kind === 'event' && row.event.type === 'turn/delete') return true;
      return matches(rowText(row));
    });
  });

  /** 汇总：调用数 / 累计 token / 模型集合 */
  const summary = computed(() => {
    const steps = view.value?.steps ?? [];
    let promptTokens = 0;
    let completionTokens = 0;
    let errorCount = 0;
    const models = new Set<string>();
    for (const s of steps) {
      if (s.usage) {
        promptTokens += s.usage.promptTokens ?? 0;
        completionTokens += s.usage.completionTokens ?? 0;
      }
      if (s.status === 'error') errorCount += 1;
      if (s.model) models.add(s.model);
    }
    return {
      callCount: view.value?.totalSteps ?? 0,
      shownCount: steps.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      errorCount,
      models: [...models],
    };
  });

  return {
    loading,
    error,
    view,
    search,
    expanded,
    rows: filteredRows,
    summary,
    envelopes,
    refresh,
    toggleExpand,
    expandAll,
  };
}
