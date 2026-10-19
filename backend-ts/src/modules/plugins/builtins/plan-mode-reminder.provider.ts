import type { TurnReminderProvider } from "../turn-reminders/turn-reminder.types";
import { buildPlanModeTurnInjection } from "./plan-mode-reminder.util";

/**
 * 计划模式每轮提醒 provider。
 *
 * 由 PlanModePlugin 在 onLoad 时注册；引擎只负责收集与落库，不感知计划模式。
 */
export function createPlanModeReminderProvider(): TurnReminderProvider {
  return {
    id: "plan-mode-reminders",
    order: 100,
    build: ({ sessionContext, iterationCount, history }) =>
      buildPlanModeTurnInjection(sessionContext, iterationCount, history),
  };
}
