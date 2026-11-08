/**
 * 插件市场 HTTP 接口（客户端市场 Tab 用）。
 *
 * 路由挂在 /plugins/market/* 下，与既有插件管理接口同 Controller 前缀
 * 但独立模块；安装/安装日志直接复用既有端点语义（jobId 轮询）。
 */
import { Controller, Get, Post, Query, Body, Param, Logger, NotFoundException } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { PluginMarketService } from "./market.service";
import type { MarketListResponse, MarketPluginDetail, MarketTag } from "./market.types";

@Controller("plugins/market")
export class PluginMarketController {
  private readonly logger = new Logger(PluginMarketController.name);

  constructor(private readonly marketService: PluginMarketService) {}

  /** 市场列表（分页/keyword/tag） */
  @Public()
  @Get("list")
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("keyword") keyword?: string,
    @Query("tag") tag?: string,
  ): Promise<MarketListResponse> {
    return this.marketService.list({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 12,
      keyword,
      tag,
    });
  }

  /** 插件详情（含截图） */
  @Public()
  @Get("detail")
  async detail(@Query("id") id: string): Promise<MarketPluginDetail> {
    const plugin = await this.marketService.detail(id ?? "");
    if (!plugin) {
      throw new NotFoundException(`市场索引中找不到插件: ${id}`);
    }
    return plugin;
  }

  /** 标签聚合 */
  @Public()
  @Get("tags")
  async tags(): Promise<{ tags: MarketTag[] }> {
    return { tags: await this.marketService.tags() };
  }

  /**
   * 一键安装：查索引取安装源 → 复用既有安装任务。
   * 返回 jobId 后走既有 GET /plugins/install-log/:jobId 轮询，
   * 安装成功后自动向官网上报计数。
   */
  @Public()
  @Post("install/:id")
  async install(@Param("id") id: string): Promise<{ jobId: string; source: string }> {
    const { jobId, source } = await this.marketService.installFromMarket(id);
    this.marketService.reportInstall(id);
    return { jobId, source };
  }

  /** 可达性探测（前端决定市场 Tab 空态/错误态） */
  @Public()
  @Get("ping")
  async ping(): Promise<{ ok: boolean }> {
    return this.marketService.ping();
  }
}
