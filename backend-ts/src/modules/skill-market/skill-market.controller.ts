import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { SkillHubMarketService } from "./skillhub-market.service";

/**
 * 技能市场接口（消费端）。
 *
 * 目前只有 SkillHub 一个源；路由按 `/skill-market/:source/*` 组织，
 * 后续要接第二个源时不必改前端路径结构。
 */
@Controller("skill-market")
@UseGuards(AuthGuard)
export class SkillMarketController {
  constructor(private readonly skillhub: SkillHubMarketService) {}

  /**
   * `GET /api/v1/skill-market/skillhub/list?page=1&pageSize=12&keyword=&category=&lang=zh`
   */
  @Get("skillhub/list")
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("keyword") keyword?: string,
    @Query("category") category?: string,
    @Query("sortBy") sortBy?: string,
    @Query("order") order?: string,
    @Query("lang") lang?: string,
  ) {
    return this.skillhub.list({ page, pageSize, keyword, category, sortBy, order, lang });
  }

  /**
   * `GET /api/v1/skill-market/skillhub/recommended?limit=12&refresh=1&lang=zh`
   */
  @Get("skillhub/recommended")
  async recommended(
    @Query("limit") limit?: string,
    @Query("refresh") refresh?: string,
    @Query("lang") lang?: string,
  ) {
    return this.skillhub.recommended(limit, refresh === "1" || refresh === "true", lang);
  }

  /**
   * `GET /api/v1/skill-market/skillhub/categories?lang=zh`
   */
  @Get("skillhub/categories")
  async categories(@Query("lang") lang?: string) {
    return this.skillhub.categories(lang);
  }

  /**
   * `GET /api/v1/skill-market/skillhub/skills/:slug?lang=zh`
   *
   * 返回列表同构条目 + 作者/最新版本/安全报告/质量评测。
   */
  @Get("skillhub/skills/:slug")
  async detail(@Param("slug") slug: string, @Query("lang") lang?: string) {
    return this.skillhub.detail(slug, lang);
  }

  /**
   * `POST /api/v1/skill-market/skillhub/install`  { slug, version?, force? }
   *
   * 只接受 slug，不接受任意 URL；下载与安装失败统一返回 { success:false, message }。
   */
  @Post("skillhub/install")
  async install(
    @Body() body: { slug?: string; version?: string; force?: boolean },
  ) {
    if (!body?.slug?.trim()) {
      throw new BadRequestException("slug 是必填");
    }
    return this.skillhub.install(body);
  }
}
