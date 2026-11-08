import {
  All,
  Controller,
  Logger,
  Param,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth/auth.guard";
import { PluginManager } from "../plugin.manager";
import { PluginPathsService } from "../paths/plugin-paths.service";
import { buildHttpContext, PluginHttpRegistry } from "./plugin-http.registry";

/**
 * 插件自定义 HTTP 路由入口（v3）
 *
 * URL 形态：`<base>/plugins/<pluginId>/http/<path>`
 *
 * 为什么用独立段 `http`：
 * - 与既有 `/plugins/:id/rpc/:method`、`/plugins/:id/assets/*path`、`/plugins/:id/data`
 *   完全不重叠，避免通配路由抢占。
 * - 鉴权在控制器级统一施加（`AuthGuard`），插件无法绕过；需要公开媒体时用 assets 端点。
 *
 * handler 拿到原生 `req`/`res`，因此可以：
 * - `res.write()` 多次做 SSE / 分块流
 * - `fs.createReadStream().pipe(res)` 传大文件
 * - 自定义状态码与 header
 */
@Controller("plugins")
@UseGuards(AuthGuard)
export class PluginHttpController {
  private readonly logger = new Logger(PluginHttpController.name);

  constructor(
    private readonly registry: PluginHttpRegistry,
    private readonly pluginManager: PluginManager,
    private readonly pluginPaths: PluginPathsService,
  ) {}

  @All(":pluginId/http/*path")
  async dispatch(
    @Param("pluginId") pluginId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const started = Date.now();
    const method = String(req.method || "GET").toUpperCase();
    const rawPath = extractRoutePath(req, pluginId);

    const hit = this.registry.match(pluginId, method, rawPath);
    if (!hit) {
      res.status(404).json({
        error: "plugin route not found",
        pluginId,
        method,
        path: rawPath,
      });
      this.audit(pluginId, method, rawPath, 404, started);
      return;
    }

    let dataDir = "";
    try {
      dataDir = this.pluginPaths.getDataDir(pluginId);
    } catch {
      /* 数据目录不可用时给空串，handler 自行决定是否报错 */
    }

    const ctx = buildHttpContext({
      pluginId,
      params: hit.params,
      query: (req.query || {}) as Record<string, unknown>,
      body: (req as any).body,
      dataDir,
      req: {
        headers: req.headers as Record<string, unknown>,
        method,
        url: req.originalUrl || req.url,
      },
    });

    // 连接中断时给 handler 一个中止信号（流式响应场景）
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on("close", onClose);

    try {
      await hit.route.handler(req, res, ctx);
      this.audit(pluginId, method, rawPath, res.statusCode || 200, started);
    } catch (error: any) {
      const message = error?.message ? String(error.message) : String(error);
      this.logger.error(
        `[plugin-http] ${pluginId} ${method} /${rawPath} failed: ${message}`,
      );
      if (!res.headersSent) {
        res.status(500).json({ error: message, pluginId, path: rawPath });
      } else {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      this.audit(pluginId, method, rawPath, 500, started);
    } finally {
      res.removeListener("close", onClose);
    }
  }

  private audit(
    pluginId: string,
    method: string,
    path: string,
    status: number,
    started: number,
  ): void {
    this.logger.log(
      `[plugin-http] ${pluginId} ${method} /${path} ${status} ${Date.now() - started}ms`,
    );
  }
}

/**
 * 从 originalUrl 手动截取路由剩余段。
 *
 * 不同 Express/path-to-regexp 版本对多段通配的参数捕获行为不一致
 * （有时是逗号拼接、有时是数组），与 assets 端点同样的处理策略：以 URL 为准确来源。
 */
function extractRoutePath(req: Request, pluginId: string): string {
  const original = String(req.originalUrl || req.url || "");
  const marker = `/plugins/${pluginId}/http/`;
  const idx = original.indexOf(marker);
  if (idx < 0) {
    const param = (req.params as any)?.path;
    return Array.isArray(param) ? param.join("/") : String(param || "");
  }
  const rest = original.slice(idx + marker.length);
  const q = rest.indexOf("?");
  return q >= 0 ? rest.slice(0, q) : rest;
}
