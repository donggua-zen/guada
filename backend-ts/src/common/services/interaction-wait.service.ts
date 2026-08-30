/**
 * InteractionWaitService - 进程内交互等待表（统一 Ask 的投递原语）
 *
 * 单 kind：`Map<"sessionId:requestId", {resolve, questions}>`。
 * - **无超时**：没有 timer，等待只能被 resolveAnswers / cancel 终结（cancel 仅删表，
 *   等待中的 Promise 随 abort 竞速被弃——无 timer 即无泄漏）。
 * - questions 存一份供控制器校验答案合法性（id 对应、label 子集、单选互斥）。
 * - 消费方两端：AskService（等待方）与 POST /chat/respond（投递方），互不感知业务。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { AskAnswerItem, AskQuestion } from "../types/ask.types";

interface PendingEntry {
  resolve: (answers: AskAnswerItem[]) => void;
  questions: AskQuestion[];
}

@Injectable()
export class InteractionWaitService {
  private readonly logger = new Logger(InteractionWaitService.name);

  /** key = `${sessionId}:${requestId}` */
  private pending = new Map<string, PendingEntry>();

  /**
   * 等待一次应答（无超时，永久挂起直到应答或 cancel）。
   * abort 取消由调用方竞速后调 cancel() 清表。
   */
  waitForAnswers(
    sessionId: string,
    requestId: string,
    questions: AskQuestion[],
  ): Promise<AskAnswerItem[]> {
    const key = this.key(sessionId, requestId);
    return new Promise<AskAnswerItem[]>((resolve) => {
      this.pending.set(key, { resolve, questions });
      this.logger.debug(`[ask] waiting for ${key} (${questions.length} question(s))`);
    });
  }

  /** 挂起中请求的问题单（控制器校验答案用；无等待者返回 undefined） */
  getPendingQuestions(sessionId: string, requestId: string): AskQuestion[] | undefined {
    return this.pending.get(this.key(sessionId, requestId))?.questions;
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

  private key(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
}
