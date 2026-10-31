import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { McpMarketService } from "./mcp-market.service";
import { McpMarketImportService } from "./mcp-market-import.service";
import { ImportableMcpServer } from "./mcp-config.extract";

/**
 * MCP 市场接口（消费端）。
 *
 * 只有三个端点：拉榜单、解析条目配置、导入。没有「发布/上传」——
 * 本轮只做消费端，市场内容由第三方站点提供。
 */
@Controller("mcp-market")
@UseGuards(AuthGuard)
export class McpMarketController {
  constructor(
    private readonly market: McpMarketService,
    private readonly importer: McpMarketImportService,
  ) {}

  /**
   * `GET /api/v1/mcp-market/rankings?source=all&refresh=1`
   *
   * source 取 `all` | `skillhub_mcp` | `mcpworld`；refresh=1 绕过 10 分钟缓存。
   */
  @Get("rankings")
  async getRankings(
    @Query("source") source?: string,
    @Query("refresh") refresh?: string,
  ) {
    const forceRefresh = refresh === "1" || refresh === "true";
    return this.market.getRankings(source || "all", forceRefresh);
  }

  /**
   * `POST /api/v1/mcp-market/resolve`  { source, id }
   *
   * 返回该条目可导入的 mcpServers 配置（含占位符标记）。
   */
  @Post("resolve")
  async resolve(@Body() body: { source?: string; id?: string }) {
    const source = (body?.source ?? "").trim();
    const id = (body?.id ?? "").trim();
    if (!source || !id) {
      throw new BadRequestException("source 与 id 都是必填");
    }
    return this.market.resolveItem(source, id);
  }

  /**
   * `POST /api/v1/mcp-market/import`  { source, itemId, servers }
   *
   * 落盘为本地 MCP 服务器 YAML，**一律 disabled**，不启动任何进程。
   */
  @Post("import")
  async import(
    @Body()
    body: {
      source?: string;
      itemId?: string;
      servers?: ImportableMcpServer[];
    },
  ) {
    const source = (body?.source ?? "").trim();
    const itemId = (body?.itemId ?? "").trim();
    if (!source || !itemId) {
      throw new BadRequestException("source 与 itemId 都是必填");
    }
    return this.importer.importServers(source, itemId, body?.servers ?? []);
  }
}
