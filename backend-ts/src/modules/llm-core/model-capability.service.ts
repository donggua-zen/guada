import { Injectable } from '@nestjs/common';
import { ProviderFileStore } from './provider-file.store';
import { ThinkingEffort } from './thinking/thinking-vocabulary';
import { clampThinkingEffort } from './thinking/thinking-effort-policy';

/** 调用方可恢复的「档位不受支持」错误（fail-loud，对齐 DSH UNSUPPORTED_REASONING_EFFORT） */
export class UnsupportedReasoningEffortError extends Error {
  readonly code = 'UNSUPPORTED_REASONING_EFFORT';
  constructor(
    providerId: string | undefined,
    modelName: string | undefined,
    effort: string,
  ) {
    super(
      `UNSUPPORTED_REASONING_EFFORT: provider "${providerId ?? '(unknown)'}" model "${modelName ?? '(unknown)'}" has no reasoning capability, but effort "${effort}" was requested`,
    );
    this.name = 'UnsupportedReasoningEffortError';
  }
}

/**
 * 模型能力服务（思考域）
 *
 * 能力的唯一所有者是数据层（实例文件 → bundled 目录 → preset → 协议默认），
 * 由 ProviderFileStore 的合并视图解析。本服务把它暴露给两个消费者：
 * - LLMService：校验选择值并给出最终生效档位（对齐 DSH resolveCallWithInfo 的角色）
 * - 协议适配器：取档位的 wire 值（vendor 词汇映射），拼请求体
 *
 * 菜单与映射都不出服务边界：调用方只递交「选择值」，拿走「生效档位 / wire 值」。
 * （对齐 DSH seam：请求只带 opaque 选择，能力由所有者按需解析。）
 */
@Injectable()
export class ModelCapabilityService {
  constructor(private readonly store: ProviderFileStore) {}

  /**
   * 该档位的 wire 值（vendor 字符串）。
   * - 仅非 none/on 档查映射表（开关态的 wire 行为由 thinkingFormat 决定，
   *   关闭态的映射值走 resolveThinkingOff）
   * - 无映射 / 查不到 → undefined（调用方回退「档位名即 wire 值」）
   */
  resolveThinkingWireValue(
    providerId: string | undefined,
    modelName: string | undefined,
    level: string | undefined,
  ): string | undefined {
    if (!level || level === 'none' || level === 'on') return undefined;
    const model = this.lookup(providerId, modelName);
    return model?.thinkingEffortMap?.[level as ThinkingEffort];
  }

  /**
   * 关闭态信息（对齐 DSH：能不能关由菜单决定，关了发什么由映射值决定）。
   * - supported：菜单含 `none`（能关）
   * - wire：`thinkingEffortsMap.none` 的映射字符串（缺省 = 用 format 的原生关闭）
   */
  resolveThinkingOff(
    providerId: string | undefined,
    modelName: string | undefined,
  ): { supported: boolean; wire?: string } {
    const model = this.lookup(providerId, modelName);
    const menu = (model?.thinkingEfforts ?? []) as string[];
    const mapNone = model?.thinkingEffortMap?.['none'];
    return {
      supported: menu.includes('none'),
      wire: typeof mapNone === 'string' && mapNone ? mapNone : undefined,
    };
  }

  /**
   * 校验选择值并返回最终生效档位（策略见 clampThinkingEffort，与会话侧共用）：
   * - 模型无思考能力（菜单无非 off 档）却请求非 none → 抛
   *   UnsupportedReasoningEffortError（fail-loud，调用方 bug 不静默掩盖）
   * - 菜单非空但选择值不在其中（换模型后的存量设置）→ 静默调整到合法档
   * - 请求 none 但菜单无 none → 调整到首个非 off 档
   * - 实例/模型查不到（能力未知）→ 原样返回，不校验（沿用悬空引用设计）
   */
  resolveThinkingEffort(
    providerId: string | undefined,
    modelName: string | undefined,
    requested: string | undefined,
  ): string | undefined {
    const model = this.lookup(providerId, modelName);
    const resolution = clampThinkingEffort(
      model ? ((model.thinkingEfforts ?? []) as ThinkingEffort[]) : undefined,
      requested,
    );
    if (resolution.unsupported) {
      throw new UnsupportedReasoningEffortError(
        providerId,
        modelName,
        requested as string,
      );
    }
    return resolution.effort;
  }

  private lookup(providerId?: string, modelName?: string) {
    if (!providerId || !modelName) return undefined;
    return this.store.findModel(`${providerId}:${modelName}`);
  }
}
