/**
 * InteractionWaitService - 进程内交互等待表（统一 Ask 的投递原语）
 *
 * 多 kind：`Map<"sessionId:requestId", PendingEntry>`。
 * - **无超时**：没有 timer，等待只能被 resolveAnswers / cancel 终结（cancel 仅删表，
 *   等待中的 Promise 随 abort 竞速被弃——无 timer 即无泄漏）。
 * - **同会话可并存多个待答**（一个助手消息里的多个工具调用是并发执行的，各自都会来挂一次）；
 *   表按 `sessionId:requestId` 分键，`listPending()` 供"重连后恢复待答卡片"查询。
 * - questions 存一份供控制器校验答案合法性（id 对应、label 子集、单选互斥）。
 * - 消费方两端：AskService（等待方）与 POST /chat/respond（投递方），互不感知业务。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { AskAnswerItem, AskCardKind, AskKind, AskQuestion } from "../types/ask.types";
import { AUTO_APPROVABLE_CARD_KINDS } from "../types/ask.types";

/** 挂起中的一次交互（供 /chat/pending-asks 恢复卡片用） */
export interface PendingAskView {
  sessionId: string;
  requestId: string;
  kind: AskKind;
  /** 卡片类型（显式分类；旧帧可能缺省） */
  cardKind?: AskCardKind;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  questions: AskQuestion[];
}

/**
 * 等待表的内部元数据：展示字段 + 自动放行答案。
 *
 * `autoAllowLabel` 只在进程内使用（"本轮内自动放行"触发批量应答），
 * 不进入 `PendingAskView`——前端不需要知道，也不该据此自行作答。
 */
interface PendingAskMeta {
  kind: AskKind;
  cardKind?: AskCardKind;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  autoAllowLabel?: string;
}

interface PendingEntry {
  resolve: (answers: AskAnswerItem[]) => void;
  questions: AskQuestion[];
  /** 恢复卡片所需的展示元数据（历史遗留调用可能缺省） */
  meta: PendingAskMeta;
}

@Injectable()
export class InteractionWaitService {
  private readonly logger = new Logger(InteractionWaitService.name);

  /** key = `${sessionId}:${requestId}`；Map 保留插入顺序（= 到达顺序，队列展示按它排） */
  private pending = new Map<string, PendingEntry>();

  /**
   * 等待一次应答（无超时，永久挂起直到应答或 cancel）。
   * abort 取消由调用方竞速后调 cancel() 清表。
   */
  waitForAnswers(
    sessionId: string,
    requestId: string,
    questions: AskQuestion[],
    meta: PendingAskMeta = { kind: "ask" },
  ): Promise<AskAnswerItem[]> {
    const key = this.key(sessionId, requestId);
    if (this.pending.has(key)) {
      // 同 requestId 重复登记：调用方 bug（requestId 应唯一），覆盖会丢掉前一个等待者
      this.logger.warn(`[ask] duplicate wait registered for ${key}, overwriting previous waiter`);
    }
    return new Promise<AskAnswerItem[]>((resolve) => {
      this.pending.set(key, { resolve, questions, meta });
      this.logger.debug(`[ask] waiting for ${key} (${questions.length} question(s))`);
      const sameSession = this.countBySession(sessionId);
      if (sameSession > 1) {
        this.logger.debug(`[ask] session ${sessionId} now has ${sameSession} pending asks`);
      }
    });
  }

  /** 挂起中请求的问题单（控制器校验答案用；无等待者返回 undefined） */
  getPendingQuestions(sessionId: string, requestId: string): AskQuestion[] | undefined {
    return this.pending.get(this.key(sessionId, requestId))?.questions;
  }

  /**
   * 挂起中的交互列表（**重连后恢复卡片**用；不传 sessionId 返回全部会话）。
   * 顺序 = 登记顺序，前端按它排队展示。
   */
  listPending(sessionId?: string): PendingAskView[] {
    const out: PendingAskView[] = [];
    for (const [key, entry] of this.pending) {
      const sep = key.indexOf(":");
      const sid = key.slice(0, sep);
      const requestId = key.slice(sep + 1);
      if (sessionId && sid !== sessionId) continue;
      // 显式投影：autoAllowLabel 等内部元数据不外泄给 /chat/pending-asks
      out.push({
        sessionId: sid,
        requestId,
        kind: entry.meta.kind,
        cardKind: entry.meta.cardKind,
        title: entry.meta.title,
        toolCallId: entry.meta.toolCallId,
        toolName: entry.meta.toolName,
        questions: entry.questions,
      });
    }
    return out;
  }

  /**
   * 本轮自动放行：把该会话中"可自动放行"的挂起审批一并按允许应答。
   *
   * 资格按**卡片类型白名单**判定（`AUTO_APPROVABLE_CARD_KINDS`），而不是"有没有
   * 某个字段"——计划审批 / 提问 / 通用审批默认不参与；多问题卡也不能用单个
   * label 代替逐题作答。
   *
   * @returns 实际应答的条目数（0 = 没有可放行的挂起项）
   */
  resolveAutoAllowable(sessionId: string): number {
    const prefix = `${sessionId}:`;
    let resolved = 0;
    // 先取快照：resolveAnswers 会删表，不能边遍历边改
    for (const [key, entry] of [...this.pending]) {
      if (!key.startsWith(prefix)) continue;
      const { cardKind, autoAllowLabel } = entry.meta;
      if (!cardKind || !AUTO_APPROVABLE_CARD_KINDS.has(cardKind)) continue;
      if (!autoAllowLabel || entry.questions.length !== 1) continue;
      const requestId = key.slice(prefix.length);
      const answers: AskAnswerItem[] = [
        { id: entry.questions[0].id, selected: [autoAllowLabel] },
      ];
      if (this.resolveAnswers(sessionId, requestId, answers)) resolved++;
    }
    if (resolved > 0) {
      this.logger.log(`[ask] auto-allowed ${resolved} pending ask(s) for session ${sessionId}`);
    }
    return resolved;
  }

  /**
   * 投递答案唤醒等待方（POST /chat/respond 调用）。
   * @returns true=已投递；false=无等待者（循环已死/已取消/重启丢表）
   */
  resolveAnswers(
    sessionId: string,
    requestId: string,
    answers: AskAnswerItem[],
  ): boolean {
    const key = this.key(sessionId, requestId);
    const entry = this.pending.get(key);
    if (!entry) {
      this.logger.debug(`[ask] no waiter for ${key}`);
      return false;
    }
    this.pending.delete(key);
    entry.resolve(answers);
    this.logger.debug(`[ask] resolved ${key} with ${answers.length} answer(s)`);
    return true;
  }

  /** 撤回等待（abort 竞速胜出时调用）：仅删表，等待中的 Promise 被调用方弃置 */
  cancel(sessionId: string, requestId: string): void {
    const key = this.key(sessionId, requestId);
    if (this.pending.delete(key)) {
      this.logger.debug(`[ask] cancelled wait for ${key}`);
    }
  }

  private countBySession(sessionId: string): number {
    const prefix = `${sessionId}:`;
    let count = 0;
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    return count;
  }

  private key(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
}
