/**
 * 会话目标（Session Goal）— 模块内共享常量与类型
 *
 * 事实源只有一个：会话 JSONL 事件日志中的 `goal/change` 事件，经
 * `ReplayState.goal` 折叠；`_meta.db` 完全不参与。
 */
import type { GoalSnapshot } from '../../common/persistence/types';

/** 默认最大自动续跑轮数（每 session 可覆盖） */
export const DEFAULT_MAX_GOAL_ROUNDS = 30;
/** 目标文本长度上限（与 DTO 校验一致） */
export const MAX_GOAL_OBJECTIVE_CHARS = 4000;

/** REST 统一响应 */
export interface GoalStateResponse {
  goal: GoalSnapshot | null;
  /** 折叠水位（lastProcessedSeq），前端防晚到响应覆盖 */
  lastSeq: number;
  /** 严格重放的首个错误；非空时拒绝推进 */
  failure: string | null;
  /** 进程内激活态；重启后一律 false，须显式 resume */
  armed: boolean;
}

/** 独立校验器的判定 */
export interface GoalVerification {
  passed: boolean;
  reason: string;
  nextAction: string | null;
}

/** 校验器返回文本的解析结果（宽松 JSON 抽取） */
export function parseGoalVerification(text: string): GoalVerification | null {
  if (!text) return null;
  let body = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(body);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.passed !== 'boolean') return null;
    return {
      passed: parsed.passed,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      nextAction: typeof parsed.nextAction === 'string' ? parsed.nextAction : null,
    };
  } catch {
    return null;
  }
}

/** 构造校验器 prompt：模型不能自判完成，完成与否只由校验器裁定 */
export function buildGoalVerificationPrompt(objective: string, recent: string): string {
  return [
    'You are an independent completion verifier for a long-running session objective.',
    'You have NO tools. Judge only from the objective and the recent conversation excerpt below.',
    '',
    `Objective:\n${objective}`,
    '',
    `Recent conversation excerpt:\n${recent || '(empty)'}`,
    '',
    'Rules:',
    '- "passed": true ONLY when the objective is fully achieved with concrete evidence in the excerpt.',
    '- For greetings or non-task objectives that cannot be "completed", set passed=true with a brief reason.',
    '- If work remains, set passed=false and give a short, actionable "nextAction" for the next round.',
    '- You are NOT the agent doing the work. Never claim you did the work yourself.',
    '',
    'Return ONLY a JSON object, no markdown, no extra text:',
    '{"passed": boolean, "reason": string, "nextAction": string | null}',
  ].join('\n');
}

/** 续跑指令（system-reminder 包裹后入队） */
export function buildGoalContinuationPrompt(
  snapshot: GoalSnapshot,
  nextAction: string,
): string {
  return [
    '[Current session goal — authoritative]',
    `Objective: ${snapshot.objective}`,
    `Round: ${snapshot.iteration + 1}/${snapshot.maxRounds}`,
    `Verifier feedback: ${nextAction || 'continue making concrete progress'}`,
    '',
    'Keep working toward the objective. Make concrete progress and verify the result.',
    'Do NOT mark the goal complete yourself — an independent verifier decides completion.',
    'If the work is genuinely finished, state the evidence and stop; the verifier will confirm.',
  ].join('\n');
}
