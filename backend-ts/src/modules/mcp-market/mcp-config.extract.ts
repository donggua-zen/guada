/**
 * 市场条目的统一形态 + 从 markdown 里抽取可导入的 MCP 配置。
 *
 * 市场给的东西只有两类：一份榜单 JSON，和每个条目的 readme/detail 文本。
 * 后者是人类文档，MCP 配置只是里面若干 ```json 代码块之一 —— 而且通常还有
 * Docker / 全局安装 / npx 多种写法并列。所以这里要解决两件事：
 * 1. 抠出所有候选块，只认带 mcpServers 的；
 * 2. 给候选块打分，选出「最可移植」的那一个（优先 npx 系，其次 docker）。
 *
 * 打分是必要的：直接取第一个代码块，会在大量条目上拿到 Docker 写法，用户机器没装
 * Docker 就必然失败。nomifun 的 market/mcp.rs 就是被这个问题逼出来的。
 */

/** 统一的市场条目（前端展示用） */
export interface McpMarketItem {
  /** 市场侧稳定 id，形如 `mcpworld:be0640da...` / `skillhub_mcp:slug` */
  id: string;
  /** 来源标识 */
  source: string;
  /** 来源内排名（1 起） */
  rank: number;
  name: string;
  description: string;
  /** 详情页 URL */
  url: string;
  tags: string[];
  /** 展示用统计，如 "521 stars" */
  stats?: string;
}

/** 归一后的可导入服务器 */
export interface ImportableMcpServer {
  name: string;
  type: "stdio" | "sse" | "streamableHttp";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** 配置里含占位符，用户补全后才能启用 */
  needsConfiguration: boolean;
  /** 待补全字段，如 `env.PROM_URL` / `url` / `headers.Authorization` */
  configurationFields: string[];
}

/** 从 readme 抽取的结果 */
export interface ExtractedMcpConfig {
  /** 原始 mcpServers JSON（给前端「复制配置」用） */
  configJson: unknown;
  /** 归一后的服务器列表 */
  servers: ImportableMcpServer[];
  /** 选中的块得分，便于排障 */
  score: number;
}

/** 占位符：任何命中都意味着「这不能直接跑」 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\$\{[^}]+\}/, // ${VAR}
  /<[^>\r\n]{1,64}>/, // <YOUR_TOKEN> / <url>
  /\bx{4,}\b/i, // xxxx-xxxx
  /\b(?:your|replace|insert)[\s_-]+[a-z0-9][a-z0-9\s_-]*/i, // your_api_key
  /\b(?:api[\s_-]*key|token|secret)[\s_-]+here\b/i,
];

/** 判断一个字符串是否是占位符 */
export function isPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(text));
}

/** 抠出 markdown 里所有 ``` 围栏块（语言标记可选） */
export function extractFencedBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const body = match[1];
    if (body && body.trim()) blocks.push(body.trim());
  }
  return blocks;
}

/**
 * 去掉 JSONC 风格的注释与尾逗号，让 `JSON.parse` 能吃掉「人类写的 JSON」。
 *
 * 为什么必须做：市场 readme 里的配置块大量带 `//` 注释（典型如
 * `"TENCENTCLOUD_REGION": "ap-guangzhou"  //可选参数`），严格 JSON.parse 会
 * 整块失败 → 该条目永久报「未找到可导入的配置」。这不是个别现象。
 *
 * 用字符扫描而不是正则，因为必须区分「字符串里的 //」和「注释」——
 * 正则会把 `"https://api.example.com"` 里的 `//` 当注释切掉，直接毁掉 URL。
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let atLineStart = true;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === "\n") {
      out += ch;
      atLineStart = true;
      continue;
    }

    if (ch === '"') {
      inString = true;
      atLineStart = false;
      out += ch;
      continue;
    }

    // 行注释
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n"; // 保留换行，避免把两行粘成一行后语义变化
      atLineStart = true;
      continue;
    }

    // 块注释
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1; // 跳过结尾的 '/'
      continue;
    }

    // 行首的 '#' 注释：readme 里常见把文件路径/操作提示写在 JSON 前面，
    // 例如 ```json 块开头三行 "# claude_desktop_config.json"。
    // 只在「行首（允许前置空白）」时处理，避免误伤字符串外的合法内容。
    if (atLineStart && ch === "#") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      atLineStart = true;
      continue;
    }

    if (!/\s/.test(ch)) atLineStart = false;
    out += ch;
  }

  return removeTrailingCommas(out);
}

/** 去掉 `,]` / `,}` 这类尾逗号（同样只在字符串外操作） */
function removeTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      // 向后看第一个非空白字符
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === "}" || text[j] === "]") {
        continue; // 丢掉这个逗号
      }
    }

    out += ch;
  }

  return out;
}

/** 解析可能带注释/尾逗号的 JSON；失败返回 undefined */
export function parseLenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 落到宽容解析
  }
  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return undefined;
  }
}

/** 一个对象是否是合法的 mcpServers 容器 */
function hasMcpServers(value: unknown): value is { mcpServers: Record<string, any> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const servers = (value as any).mcpServers;
  return !!servers && typeof servers === "object" && !Array.isArray(servers)
    && Object.keys(servers).length > 0;
}

/** 一个值看起来像服务器配置（有 command 或 url） */
function isServerLike(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const transport = (value as any).transport;
  const source = transport && typeof transport === "object" ? transport : value;
  const hasCommand = typeof (source as any).command === "string" && (source as any).command.trim();
  const hasUrl =
    typeof (source as any).url === "string" && (source as any).url.trim();
  return Boolean(hasCommand || hasUrl);
}

/**
 * 把「不是标准 mcpServers 结构」的写法归一成标准结构。
 *
 * 真实 readme 里见到的变体（都来自各家文档的粘贴习惯）：
 *   1. `{ "chatgpt-mcp": { "command": "npx", ... } }`  —— 少写外层 mcpServers
 *   2. `{ "command": "npx", "args": [...] }`           —— 只贴了单个服务器内容
 *   3. `{ "servers": { "x": {...} } }`                 —— 用了 servers 这个键名
 * 直接丢弃会让这些条目永久不可导入，所以在这里补壳 / 改键名。
 */
export function coerceToMcpServers(
  value: unknown,
  fallbackName = "mcp-server",
): { mcpServers: Record<string, any> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  if (hasMcpServers(value)) return value;

  const obj = value as Record<string, any>;
  const entries = Object.entries(obj);
  if (entries.length === 0) return null;

  // 变体 3：键名叫 servers（部分文档用这个）
  const serversAlias = obj.servers ?? obj.mcp_servers ?? obj.mcpservers;
  if (
    serversAlias &&
    typeof serversAlias === "object" &&
    !Array.isArray(serversAlias) &&
    Object.keys(serversAlias).length > 0 &&
    Object.values(serversAlias).every((v) => isServerLike(v))
  ) {
    return { mcpServers: serversAlias as Record<string, any> };
  }

  // 变体 2：本身就是一个服务器配置
  if (isServerLike(obj)) {
    return { mcpServers: { [fallbackName]: obj } };
  }

  // 变体 1：name -> server 的映射（全部条目都像服务器才算数，
  // 否则可能是一个无关的普通对象，例如 {"version": 1}）
  if (entries.every(([, v]) => isServerLike(v))) {
    return { mcpServers: obj };
  }

  return null;
}

/** 取服务器的 transport 对象：兼容 `{ transport: { type } }` 嵌套与平铺 */
function transportOf(server: any): any {
  if (server?.transport && typeof server.transport === "object") {
    return server.transport;
  }
  return server;
}

/** 从配置里读第一个命中的字段（兼容平铺与 transport 嵌套） */
function pickField(server: any, keys: string[]): unknown {
  const transport = transportOf(server);
  for (const key of keys) {
    if (transport?.[key] !== undefined) return transport[key];
    if (server?.[key] !== undefined) return server[key];
  }
  return undefined;
}

/** 单个服务器的可移植性得分（越高越优先） */
export function scoreServer(server: any): number {
  if (!server || typeof server !== "object") return -1000;

  const command = pickField(server, ["command"]);
  if (typeof command === "string" && command.trim()) {
    const firstToken = command.trim().split(/\s+/)[0] ?? "";
    const base = firstToken
      .split(/[\\/]/)
      .pop()!
      .toLowerCase()
      .replace(/\.(exe|cmd|bat)$/, "");

    let score: number;
    switch (base) {
      case "npx":
      case "pnpx":
      case "bunx":
      case "uvx":
        score = 90;
        break;
      case "npm":
      case "bun":
      case "uv":
      case "python":
      case "python3":
      case "deno":
      case "node":
        score = 65;
        break;
      case "docker":
      case "podman":
        score = 10;
        break;
      default:
        score = 35;
    }

    // npx 缺 -y 会交互式提问，非交互场景必挂
    if (["npx", "pnpx", "bunx"].includes(base)) {
      const args = pickField(server, ["args"]);
      const hasYes =
        Array.isArray(args) &&
        args.some((a: unknown) => typeof a === "string" && (a === "-y" || a === "--yes"));
      if (!hasYes) score -= 15;
    }

    // 命令里带占位符 = 拿到也用不了
    if (isPlaceholder(command)) score -= 250;
    return score;
  }

  const url = pickField(server, ["url", "endpoint", "baseUrl", "base_url", "serverUrl", "server_url"]);
  if (typeof url === "string" && url.trim()) {
    let score = 80;
    if (isPlaceholder(url)) score -= 250;
    return score;
  }

  return -50;
}

/** 整个配置块的得分 = 各服务器平均分（避免「块里塞的服务器多」反而占优） */
export function scoreConfig(config: { mcpServers: Record<string, any> }): number {
  const scores = Object.values(config.mcpServers).map(scoreServer);
  if (scores.length === 0) return -1000;
  return Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** 从 headers/env 里找出所有占位符字段 */
function collectPlaceholderFields(server: any): string[] {
  const fields: string[] = [];
  const transport = transportOf(server);

  const env = transport?.env ?? server?.env;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env)) {
      if (isPlaceholder(value)) fields.push(`env.${key}`);
    }
  }

  const headers = transport?.headers ?? server?.headers;
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (isPlaceholder(value)) fields.push(`headers.${key}`);
    }
  }

  const url = pickField(server, ["url", "endpoint", "baseUrl", "base_url", "serverUrl", "server_url"]);
  if (isPlaceholder(url)) fields.push("url");

  const command = pickField(server, ["command"]);
  if (isPlaceholder(command)) fields.push("command");

  const args = pickField(server, ["args"]);
  if (Array.isArray(args) && args.some((a: unknown) => isPlaceholder(a))) {
    fields.push("args");
  }

  return fields;
}

/** 把一个市场配置对象里的单个 server 归一成 ImportableMcpServer */
export function normalizeServer(name: string, server: any): ImportableMcpServer | null {
  if (!server || typeof server !== "object" || Array.isArray(server)) return null;

  const transport = transportOf(server);
  const command = pickField(server, ["command"]);
  const rawUrl = pickField(server, ["url", "endpoint", "baseUrl", "base_url", "serverUrl", "server_url"]);

  const configurationFields = collectPlaceholderFields(server);
  const needsConfiguration = configurationFields.length > 0;

  // stdio 优先：有 command 就是 stdio，即使同时给了 url（Claude Desktop 的老写法）
  if (typeof command === "string" && command.trim()) {
    const argsRaw = pickField(server, ["args"]);
    const args = Array.isArray(argsRaw)
      ? argsRaw.filter((a: unknown): a is string => typeof a === "string")
      : undefined;

    const envRaw = transport?.env ?? server?.env;
    let env: Record<string, string> | undefined;
    if (envRaw && typeof envRaw === "object" && !Array.isArray(envRaw)) {
      env = {};
      for (const [key, value] of Object.entries(envRaw)) {
        if (value === null || value === undefined) continue;
        env[key] = typeof value === "string" ? value : String(value);
      }
      if (Object.keys(env).length === 0) env = undefined;
    }

    return {
      name,
      type: "stdio",
      command: command.trim(),
      ...(args && args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
      needsConfiguration,
      configurationFields,
    };
  }

  // HTTP 系：从 type 读协议，缺省 streamableHttp（当前主流）
  if (typeof rawUrl === "string" && rawUrl.trim()) {
    const typeRaw = String(transport?.type ?? server?.type ?? "").toLowerCase().replace(/[-_]/g, "");
    const type: ImportableMcpServer["type"] =
      typeRaw === "sse" ? "sse" : "streamableHttp";

    const headersRaw = transport?.headers ?? server?.headers;
    let headers: Record<string, string> | undefined;
    if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)) {
      headers = {};
      for (const [key, value] of Object.entries(headersRaw)) {
        if (value === null || value === undefined) continue;
        headers[key] = typeof value === "string" ? value : String(value);
      }
      if (Object.keys(headers).length === 0) headers = undefined;
    }

    return {
      name,
      type,
      url: rawUrl.trim(),
      ...(headers ? { headers } : {}),
      needsConfiguration,
      configurationFields,
    };
  }

  return null;
}

/** 把整块配置归一成服务器列表 */
export function normalizeConfig(config: { mcpServers: Record<string, any> }): ImportableMcpServer[] {
  const out: ImportableMcpServer[] = [];
  for (const [name, server] of Object.entries(config.mcpServers)) {
    const normalized = normalizeServer(name, server);
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * 从 markdown/detail 文本里抽取可导入的 MCP 配置。
 *
 * 顺序：整段裸 JSON 优先（权威）→ 否则遍历围栏块，选分数最高的那个。
 */
export function extractMcpConfig(markdown: string, fallbackName = "mcp-server"): ExtractedMcpConfig | null {
  const text = markdown ?? "";

  // 1) 整段就是 JSON（含 JSONC）
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("#")) {
    const parsed = parseLenientJson(trimmed);
    const coerced = coerceToMcpServers(parsed, fallbackName);
    if (coerced) {
      const servers = normalizeConfig(coerced);
      if (servers.length > 0) {
        return { configJson: coerced, servers, score: scoreConfig(coerced) };
      }
    }
  }

  // 2) 围栏块里选最优
  let best: ExtractedMcpConfig | null = null;
  for (const block of extractFencedBlocks(text)) {
    const parsed = parseLenientJson(block);
    const coerced = coerceToMcpServers(parsed, fallbackName);
    if (!coerced) continue;

    const servers = normalizeConfig(coerced);
    if (servers.length === 0) continue;

    const score = scoreConfig(coerced);
    if (!best || score > best.score) {
      best = { configJson: coerced, servers, score };
    }
  }

  return best;
}
