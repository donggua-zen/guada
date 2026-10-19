import { mintPlanModeEpoch } from "../../common/utils/plan-mode-epoch.util";

export interface PlanModeSettingsMergeResult {
  settings: Record<string, any>;
  /** null = 计划模式状态未变化 */
  transition: { from: boolean; to: boolean } | null;
}

/**
 * 合并会话 settings 并维护计划周期。
 *
 * 前端不感知 planModeEpoch，保存时必须保留后端已有值；只有 false -> true
 * （真正进入计划模式）才生成新周期。planEnabled 未传时也保留当前值，
 * 避免部分更新把计划态意外清掉。
 */
export function mergePlanModeSettings(
  currentSettings: Record<string, any> | null | undefined,
  incomingSettings: Record<string, any> | null | undefined,
  mintEpoch: () => string = mintPlanModeEpoch,
): PlanModeSettingsMergeResult {
  const current = currentSettings ?? {};
  const incoming = incomingSettings ?? {};
  const settings: Record<string, any> = { ...incoming };

  if (incoming.planEnabled === undefined && current.planEnabled !== undefined) {
    settings.planEnabled = current.planEnabled;
  }

  // epoch 由后端管理：永远以当前值为基线，忽略旧标签页可能写回的旧周期
  settings.planModeEpoch = current.planModeEpoch ?? null;

  const from = current.planEnabled === true;
  const to = settings.planEnabled === true;
  if (to && (!from || !settings.planModeEpoch)) {
    settings.planModeEpoch = mintEpoch();
  }

  return {
    settings,
    transition: from !== to ? { from, to } : null,
  };
}
