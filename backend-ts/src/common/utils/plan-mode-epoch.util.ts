import { randomUUID } from "crypto";

/**
 * 计划周期标识。
 *
 * 每次进入计划模式生成一个新值并写入 settings.planModeEpoch；完整提醒按该周期
 * 只落一份（压缩遮蔽后重新落一份）。随机后缀避免同一毫秒内重复。
 */
export function mintPlanModeEpoch(): string {
  return `plan-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
