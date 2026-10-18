import { Controller, Delete, Get, Query, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { UsageService } from "./usage.service";
import type { UsageRange } from "./usage.types";

/**
 * Token 用量统计 API。
 *
 * 前端传浏览器时区偏移（分钟，东八区 +480），后端按该偏移归日；
 * summary 的 token 口径与 provider usage 一致，不使用本地估算。
 */
@Controller("usage")
@UseGuards(AuthGuard)
export class UsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly providerStore: ProviderFileStore,
  ) {}

  @Get("stats")
  getStats(
    @Query("range") range: string = "7d",
    @Query("tzOffsetMinutes") tzOffsetMinutes: string = "0",
    @Query("timeZone") timeZone?: string,
  ) {
    const snapshot = this.usageService.getSnapshot({
      range: normalizeRange(range),
      tzOffsetMinutes: parseOffset(tzOffsetMinutes),
      timeZone,
    });

    // provider/model 显示名按当前配置补齐；配置已删除/解析失败时回退原始 id
    for (const model of snapshot.models) {
      try {
        const provider = model.providerId
          ? this.providerStore.getProvider(model.providerId)
          : undefined;
        if (!provider?.name) continue;
        model.providerName = provider.name;
        const entry = this.providerStore
          .resolveMergedModels(provider)
          .find((item) => item.modelName === model.modelId);
        if (entry?.name) model.modelName = entry.name;
      } catch {
        /* 展示名是增强信息，失败不阻断统计 */
      }
    }

    return snapshot;
  }

  /** 清空全部本地用量明细（不影响会话消息/元数据） */
  @Delete("stats")
  clearAll() {
    return { success: true, deleted: this.usageService.clearAll() };
  }
}

function normalizeRange(value: string): UsageRange {
  return value === "30d" || value === "all" ? value : "7d";
}

function parseOffset(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-840, Math.min(840, Math.trunc(n))) : 0;
}
