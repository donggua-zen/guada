import { BadRequestException } from "@nestjs/common";
import { mintPlanModeEpoch } from "../../../common/utils/plan-mode-epoch.util";

/**
 * 回合级设置覆盖（排队消息补发时使用）。
 *
 * 语义：只影响当前回合，不写回会话持久化设置。字段是白名单——绝不能把客户端
 * 传入的任意 settings 键展开进会话（plugins/skills/systemPrompt 等不可由客户端改）。
 */
export const SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type SandboxMode = (typeof SANDBOX_MODES)[number];

export interface TurnSettingsOverride {
  modelId?: string;
  thinkingEffort?: string;
  maxTokensLimit?: number | null;
  sandboxMode?: SandboxMode;
  planEnabled?: boolean;
}

/**
 * 归一化并校验客户端传入的 settingsOverride。
 *
 * 只保留白名单字段；类型非法直接 400，避免坏值进入回合上下文。
 */
export function normalizeTurnSettingsOverride(
  raw: unknown,
): TurnSettingsOverride | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const out: TurnSettingsOverride = {};

  if (input.modelId !== undefined && input.modelId !== null) {
    if (typeof input.modelId !== "string" || !input.modelId.trim()) {
      throw invalidOverride("modelId");
    }
    out.modelId = input.modelId.trim();
  }

  if (input.thinkingEffort !== undefined && input.thinkingEffort !== null) {
    if (typeof input.thinkingEffort !== "string") {
      throw invalidOverride("thinkingEffort");
    }
    out.thinkingEffort = input.thinkingEffort;
  }

  if (input.maxTokensLimit !== undefined) {
    if (input.maxTokensLimit === null) {
      out.maxTokensLimit = null;
    } else if (
      typeof input.maxTokensLimit === "number" &&
      Number.isFinite(input.maxTokensLimit) &&
      input.maxTokensLimit >= 0
    ) {
      out.maxTokensLimit = input.maxTokensLimit;
    } else {
      throw invalidOverride("maxTokensLimit");
    }
  }

  if (input.sandboxMode !== undefined) {
    if (!SANDBOX_MODES.includes(input.sandboxMode as SandboxMode)) {
      throw invalidOverride("sandboxMode");
    }
    out.sandboxMode = input.sandboxMode as SandboxMode;
  }

  if (input.planEnabled !== undefined) {
    if (typeof input.planEnabled !== "boolean") {
      throw invalidOverride("planEnabled");
    }
    out.planEnabled = input.planEnabled;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 把覆盖合并进会话副本（绝不修改入参）。
 *
 * 两个必须绕开的既有行为：
 * - resolveModel() 优先返回 session.model，覆盖 modelId 时必须清空内存挂载；
 * - initialize() 在 planEnabled 且无 planModeEpoch 时会补 epoch 并落库，
 *   这里预置临时 epoch，避免把回合级覆盖写回会话设置。
 */
export function applyTurnSettingsOverride<T extends Record<string, any>>(
  session: T,
  override?: TurnSettingsOverride,
): T {
  if (!override) return session;

  const next: Record<string, any> = { ...session };
  const settings: Record<string, any> = { ...(session.settings ?? {}) };

  if (override.modelId !== undefined) {
    next.modelId = override.modelId;
    next.model = undefined;
  }
  if (override.thinkingEffort !== undefined) {
    settings.thinkingEffort = override.thinkingEffort;
  }
  if (override.maxTokensLimit !== undefined) {
    settings.maxTokensLimit = override.maxTokensLimit;
  }
  if (override.sandboxMode !== undefined) {
    settings.sandboxMode = override.sandboxMode;
  }
  if (override.planEnabled !== undefined) {
    settings.planEnabled = override.planEnabled;
    if (override.planEnabled === true && !settings.planModeEpoch) {
      settings.planModeEpoch = mintPlanModeEpoch();
    }
  }

  next.settings = settings;
  return next as T;
}

function invalidOverride(field: string): BadRequestException {
  return new BadRequestException({
    error: `无效的回合设置覆盖：${field}`,
    code: "INVALID_SETTINGS_OVERRIDE",
  });
}
