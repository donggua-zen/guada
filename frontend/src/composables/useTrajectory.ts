/**
 * useTrajectory — 轨迹台账数据 + 台账行派生（对齐 dsh layout.ts 的 turn→group→cell 折叠思路，精简版）
 *
 * 台账行模型（kind 判别联合）：
 * - 'turn-header'  回合分组头（按 turnId 首现顺序编号）
 * - 'group-header' 独立分组头（辅助调用：turnId=null 的 step 集合）
 * - 'request'      Request N 边界行（状态/模型/IN-OUT token/耗时/finishReason）
 * - 'message'      消息行（region: prefix=首卡之前的历史 / in=请求输入 / transient=瞬态注入 /
 *                  out=调用产出）
 *
 * IN 区不重建 wire 视图（dsh 同款）：请求输入 = 时间线 seq 区间切片 + transient verbatim；
 * 媒体占位由 step.mediaOverlay 标注。展开状态存 Panel 层 Set（跨卸载存活）。
 */
import { ref, computed, type Ref } from 'vue';
import { apiService } from '@/services/ApiService';
import type {
  TrajectoryEnvelopeSnapshot,
  TrajectoryMessageNode,
  TrajectoryStepView,
  TrajectoryView,
} from '@/services/modules/trajectory.api';
import type { ContentBlock } from '@/types/stream/content-block.types';

// ─── 台账行模型 ───

export interface LedgerRequestRow {
  key: string;
  kind: 'request';
  step: TrajectoryStepView;
  /** 会话级请求序号（1..N，按 startSeq 排序） */
  number: number;
}

export interface LedgerMessageRow {
  key: string;
  kind: 'message';
  node: TrajectoryMessageNode;
  region: 'prefix' | 'in' | 'transient' | 'out';
  /** 宿主 step（prefix 行为 null） */
  step: TrajectoryStepView | null;
}

export interface LedgerGroupRow {
  key: string;
  kind: 'turn-header' | 'group-header';
  label: string;
}

/** SYSTEM 快照行（envelope 事件，按 seq 插进台账流；对齐 dsh request/header 行） */
export interface LedgerSystemRow {
  key: string;
  kind: 'system';
  envelope: TrajectoryEnvelopeSnapshot;
  /** 序号（1..N，事件序） */
  number: number;
  /** 上一条快照（展开态 diff 用；首条为 null） */
  previous: TrajectoryEnvelopeSnapshot | null;
}

export type LedgerRow =
  | LedgerRequestRow
  | LedgerMessageRow
  | LedgerGroupRow
  | LedgerSystemRow;

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
  /** 详情选中的 step（requestId；null = 未选） */
  const selectedRequestId = ref<string | null>(null);

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

  /** 会话级请求编号（1..N） */
  const numberedSteps = computed<Array<{ step: TrajectoryStepView; number: number }>>(() => {
    const steps = [...(view.value?.steps ?? [])].sort((a, b) => a.startSeq - b.startSeq);
    return steps.map((step, i) => ({ step, number: i + 1 }));
  });

  /** 全部 envelope 快照（事件序；SYSTEM 变更历史） */
  const envelopes = computed(() => view.value?.envelopes ?? []);

  /** 首卡 startSeq 之前的历史消息（prefix 区） */
  const prefixNodes = computed<TrajectoryMessageNode[]>(() => {
    const steps = view.value?.steps ?? [];
    if (steps.length === 0) return [];
    const first = steps.reduce((m, s) => Math.min(m, s.startSeq), Number.MAX_SAFE_INTEGER);
    return (view.value?.timeline ?? []).filter((n) => n.seq < first);
  });

  /** seq 区间切片（timeline 有序，二分可省——数量级 ≤ 数千，线性足够） */
  function sliceTimeline(fromSeq: number, toSeq: number): TrajectoryMessageNode[] {
    return (view.value?.timeline ?? []).filter(
      (n) => n.seq >= fromSeq && n.seq <= toSeq,
    );
  }

  /** 台账行派生（对齐 dsh：turn 分组 + Request 边界 + kind 单元格） */
  const rows = computed<LedgerRow[]>(() => {
    const out: LedgerRow[] = [];
    const steps = numberedSteps.value;
    if (steps.length === 0) return out;

    // 回合编号（turnId 首现顺序）
    const turnOrder = new Map<string, number>();
    let turnCounter = 0;
    let standaloneHeaderWritten = false;
    let lastTurnId: string | null | undefined = undefined;

    // SYSTEM 行按 seq 插进台账流：每步前 flush seq 更早的 envelope（对齐 dsh
    // 把 request/header 行排在它服务的请求之前；初始行钉在最前，变更行挂 diff）
    const allEnvelopes = envelopes.value;
    let envIdx = 0;
    let sysCounter = 0;
    let lastSys: TrajectoryEnvelopeSnapshot | null = null;
    const flushSystemRows = (beforeSeq: number): void => {
      while (envIdx < allEnvelopes.length && allEnvelopes[envIdx]!.seq < beforeSeq) {
        sysCounter += 1;
        const env = allEnvelopes[envIdx]!;
        out.push({ key: `sys:${env.seq}`, kind: 'system', envelope: env, number: sysCounter, previous: lastSys });
        lastSys = env;
        envIdx += 1;
      }
    };

    for (const { step, number } of steps) {
      const turnId = step.turnId;
      flushSystemRows(step.startSeq);
      // 分组头（回合切换 / 首个辅助调用组）
      if (turnId !== null && turnId !== lastTurnId) {
        if (!turnOrder.has(turnId)) {
          turnCounter += 1;
          turnOrder.set(turnId, turnCounter);
        }
        out.push({
          key: `turn:${turnId}`,
          kind: 'turn-header',
          label: `${turnOrder.get(turnId)}`,
        });
        lastTurnId = turnId;
      } else if (turnId === null && !standaloneHeaderWritten) {
        out.push({ key: 'group:aux', kind: 'group-header', label: 'aux' });
        standaloneHeaderWritten = true;
        lastTurnId = null;
      }

      out.push({ key: `req:${step.requestId}:${number}`, kind: 'request', step, number });

      // IN 区（首卡之前的 prefix 消息单独归组在第一个 request 前输出）
      for (const node of sliceTimeline(step.input.fromSeq, step.input.toSeq)) {
        out.push({ key: `m:${node.seq}:in`, kind: 'message', node, region: 'in', step });
      }
      for (const node of step.input.transient ?? []) {
        out.push({
          key: `m:${node.id}:transient`,
          kind: 'message',
          node,
          region: 'transient',
          step,
        });
      }
      for (const node of step.input.fullInput ?? []) {
        out.push({
          key: `m:${node.id}:fullinput`,
          kind: 'message',
          node,
          region: 'transient',
          step,
        });
      }
      // OUT 区（unclosed 卡的 toSeq = MAX_SAFE_INTEGER → 剩余全部消息，切片自然收敛）
      const outTo = step.output.toSeq === Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : step.output.toSeq;
      for (const node of sliceTimeline(step.output.fromSeq, outTo)) {
        out.push({ key: `m:${node.seq}:out`, kind: 'message', node, region: 'out', step });
      }
    }
    flushSystemRows(Number.MAX_SAFE_INTEGER);
    return out;
  });

  /** 搜索过滤（dsh TrajectorySearchIndex 语义：空白分词 + AND 子串匹配；命中行保留宿主 request 行） */
  const filteredRows = computed<LedgerRow[]>(() => {
    const all = rows.value;
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return withPrefixRows(all);

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
      if (row.kind === 'request') {
        const s = row.step;
        return [
          s.source, s.model, s.provider, s.finishReason, s.status,
          s.error?.message, s.requestId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
      }
      return '';
    };

    const matches = (text: string) => terms.every((term) => text.includes(term));

    // 命中的消息行 + 命中的 request 行；request 行在其任一消息命中时也保留
    const hitMessage = new Set<string>();
    const hitRequest = new Set<string>();
    for (const row of all) {
      if (row.kind === 'message' && matches(rowText(row))) hitMessage.add(row.key);
      if (row.kind === 'request' && matches(rowText(row))) hitRequest.add(row.key);
    }
    // 分组头始终保留（结构锚）；request 行在其任一消息命中或自身命中时保留
    const visible = all.filter((row) => {
      if (row.kind === 'turn-header' || row.kind === 'group-header') return true;
      if (row.kind === 'system') return true;
      if (row.kind === 'request') {
        return (
          hitRequest.has(row.key) ||
          all.some(
            (m) =>
              m.kind === 'message' &&
              m.step?.requestId === row.step.requestId &&
              hitMessage.has(m.key),
          )
        );
      }
      return hitMessage.has(row.key);
    });
    return withPrefixRows(visible);
  });

  /** prefix 行（首卡之前历史）挂在第一条 request 行之前 */
  function withPrefixRows(rowsIn: LedgerRow[]): LedgerRow[] {
    const firstReqIdx = rowsIn.findIndex((r) => r.kind === 'request');
    if (firstReqIdx < 0) return rowsIn;
    const prefix: LedgerRow[] = prefixNodes.value.map((node) => ({
      key: `m:${node.seq}:prefix`,
      kind: 'message' as const,
      node,
      region: 'prefix' as const,
      step: null,
    }));
    if (prefix.length === 0) return rowsIn;
    return [...rowsIn.slice(0, firstReqIdx), ...prefix, ...rowsIn.slice(firstReqIdx)];
  }

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

  /** 详情面板选中的 step */
  const selectedStep = computed<TrajectoryStepView | null>(() => {
    if (!selectedRequestId.value) return null;
    return view.value?.steps.find((s) => s.requestId === selectedRequestId.value) ?? null;
  });

  function selectStep(requestId: string | null): void {
    selectedRequestId.value = requestId;
  }

  return {
    loading,
    error,
    view,
    search,
    expanded,
    rows: filteredRows,
    summary,
    envelopes,
    selectedRequestId,
    selectedStep,
    refresh,
    toggleExpand,
    expandAll,
    selectStep,
  };
}
