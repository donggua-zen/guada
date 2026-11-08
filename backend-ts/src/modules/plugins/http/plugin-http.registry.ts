import { Injectable, Logger, Optional } from "@nestjs/common";
import type { PluginHttpContext, PluginHttpRouteDef } from "../types/plugin.types";

/**
 * 插件 HTTP 路由注册表（v3）
 *
 * 设计要点：
 * - **不暴露 express 实例**：插件只能往自己的命名空间注册，无法覆盖宿主路由或绕过鉴权。
 * - 路径按 pluginId 隔离：`/api/v1/plugins/<pluginId>/http/<path>`。
 * - 支持 `:param` 段与末尾 `*` 通配；其余按字面量精确匹配。
 * - 生命周期：`flush()` 提交；插件**禁用不摘除**（由控制器查询 `isEnabled` 拦截，
 *   避免反复启停导致注册抖动）；卸载时 `unregisterPlugin`。
 */
@Injectable()
export class PluginHttpRegistry {
  private readonly logger = new Logger(PluginHttpRegistry.name);
  /** pluginId → 路由表（注册顺序即匹配顺序，静态路径优先于含参数的） */
  private readonly routes = new Map<string, Array<RegisteredRoute>>();
  private enabledResolver: (pluginId: string) => boolean = () => true;

  constructor(@Optional() private readonly _noop?: unknown) {}

  /** 由 PluginManager 注入：插件是否处于启用态 */
  setEnabledResolver(resolver: (pluginId: string) => boolean): void {
    this.enabledResolver = resolver;
  }

  register(pluginId: string, def: PluginHttpRouteDef): void {
    const path = normalizeRoutePath(def?.path);
    if (!path) {
      throw new Error(
        `plugin ${pluginId}: route path must be a non-empty relative path (no leading "/", no "..")`,
      );
    }
    if (typeof def.handler !== "function") {
      throw new Error(`plugin ${pluginId}: route "${path}" requires a handler`);
    }
    const method = normalizeMethod(def.method);
    const list = this.routes.get(pluginId) || [];
    // 同 pluginId + 同 method + 同路径视为重复注册：后者覆盖（热重载友好）
    const existing = list.findIndex(
      (item) => item.method === method && item.path === path,
    );
    const route: RegisteredRoute = {
      method,
      path,
      segments: path.split("/"),
      handler: def.handler,
    };
    if (existing >= 0) list[existing] = route;
    else list.push(route);
    // 静态段优先：含 `:param` 的排在后面，避免 `/items/:id` 抢占 `/items/count`
    list.sort((a, b) => countParams(a.segments) - countParams(b.segments));
    this.routes.set(pluginId, list);
  }

  /** 匹配路由；未命中返回 undefined */
  match(
    pluginId: string,
    method: string,
    path: string,
  ): { route: RegisteredRoute; params: Record<string, string> } | undefined {
    const list = this.routes.get(pluginId);
    if (!list || list.length === 0) return undefined;
    if (!this.isEnabled(pluginId)) return undefined;

    const target = splitPath(path);
    const upper = String(method || "GET").toUpperCase();

    for (const route of list) {
      if (route.method !== "ALL" && route.method !== upper) continue;
      const params = matchSegments(route.segments, target);
      if (params) return { route, params };
    }
    return undefined;
  }

  /** 诊断：某插件注册了多少条路由 */
  countOf(pluginId: string): number {
    return this.routes.get(pluginId)?.length || 0;
  }

  /** 插件卸载/重载前清空 */
  unregisterPlugin(pluginId: string): void {
    if (this.routes.delete(pluginId)) {
      this.logger.log(`plugin http routes cleared: ${pluginId}`);
    }
  }

  private isEnabled(pluginId: string): boolean {
    try {
      return this.enabledResolver(pluginId);
    } catch {
      return false;
    }
  }
}

export interface RegisteredRoute {
  method: string;
  path: string;
  segments: string[];
  handler: PluginHttpRouteDef["handler"];
}

function normalizeMethod(raw: PluginHttpRouteDef["method"]): string {
  const value = String(raw || "GET").toUpperCase();
  const allowed = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL"];
  if (!allowed.includes(value)) {
    throw new Error(`unsupported route method: ${raw}`);
  }
  return value;
}

/** 去掉前导 /、拒绝 .. 与空段 */
export function normalizeRoutePath(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const stripped = value.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!stripped) return "";
  if (stripped.includes("..")) return "";
  const segments = stripped.split("/");
  if (segments.some((seg) => seg.trim() === "")) return "";
  // 末尾 `*` 允许（通配剩余段），但 `*` 只能出现在最后
  const starIndex = segments.indexOf("*");
  if (starIndex >= 0 && starIndex !== segments.length - 1) return "";
  return stripped;
}

function splitPath(raw: string): string[] {
  return String(raw || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((seg) => seg !== "");
}

function countParams(segments: string[]): number {
  return segments.filter((seg) => seg.startsWith(":")).length;
}

/** 段匹配：`:x` 捕获、`*` 吞掉剩余、其余字面量比较 */
function matchSegments(
  pattern: string[],
  target: string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p === "*") {
      // 通配：剩下的全部吃掉（至少 0 段）
      return params;
    }
    const t = target[i];
    if (t === undefined) return null;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeSafe(t);
      continue;
    }
    if (p !== t) return null;
  }
  // 模式段数必须与目标一致（无 `*` 时）
  return pattern.length === target.length ? params : null;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 构造给插件的 handler 上下文。
 * 与 registry 解耦，方便控制器复用与单测。
 */
export function buildHttpContext(options: {
  pluginId: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  dataDir: string;
  req?: { headers?: Record<string, unknown>; method?: string; url?: string };
}): PluginHttpContext {
  return {
    pluginId: options.pluginId,
    params: options.params,
    query: options.query as Record<string, string | string[]>,
    body: options.body,
    dataDir: options.dataDir,
    method: options.req?.method || "GET",
    url: options.req?.url || "",
    headers: (options.req?.headers || {}) as Record<string, string | string[] | undefined>,
  };
}
