# DeepSeek Search / Fetch 对接方案

> 目标：把 DeepSeek 官方「网页搜索（Search）」与「网页抓取（Fetch）」接入本项目现有的联网搜索插件体系，作为一个新的搜索供应商。
> 参考文档：<https://api-docs.deepseek.com/zh-cn/guides/search>（2026-10 版本）

---

## 一、现状：本项目的搜索接口长什么样

### 1.1 调用链

```
LLM 工具调用 web_search(q, size) / web_parser(url)
        │
        ▼
WebSearchPlugin.executeSearch / executeReadWebpage          backend-ts/src/modules/plugins/builtins/web-search.plugin.ts
        │  读取 settings('search') → provider 名 + apiKey
        ▼
SearchProvider.search(q, { size }, apiKey)                  search-providers/search-provider.interface.ts
        │  实现：bocha / tavily / metaso
        ▼
返回 SearchResponse { total, results[] } → 插件拼成纯文本喂给模型
```

### 1.2 关键文件

| 文件 | 职责 |
| --- | --- |
| `backend-ts/src/modules/plugins/builtins/search-providers/search-provider.interface.ts` | 供应商契约：`SearchProvider` / `SearchOptions` / `SearchResponse` / `SearchResult` / `ParseResponse` / `SearchCapabilities` |
| `.../search-providers/bocha.provider.ts` | 博查实现（`POST /v1/web-search`，`count` + `summary:true`） |
| `.../search-providers/tavily.provider.ts` | Tavily 实现（`/search` + `/extract`） |
| `.../search-providers/metaso.provider.ts` | 秘塔实现（`/search` + `/reader`） |
| `.../web-search.plugin.ts` | 工具注册（`web_search` / `web_parser`）、能力驱动的 schema/提示词、设置读取、结果拼文本 |
| `backend-ts/src/modules/plugins/plugins.module.ts` | Provider 与插件的 NestJS 注册 |
| `frontend/src/components/setting/SearchSettings.vue` | 供应商下拉 + 各 Key 输入 + 切换后 `reloadPlugin('web-search')` |
| `frontend/src/types/service.ts` → `SearchGroupSettings` | `search` 设置分组类型 |
| `frontend/src/locales/{zh-CN,en-US}/settings.ts` | 文案 |

### 1.3 契约要点（对接时必须遵守）

- `search(q, { size }, apiKey)`：`size` 默认 10，工具 schema 限制 `1..50`。
- `SearchResult` 字段固定为 `index/title/link/score/date/summary/content`，**其它字段（如站点名、权威度）目前无处落地**。
- `score` 是 `string`；`SearchCapabilities.scoreType` 仅作声明（当前未被消费）。
- `readWebpage(url, format, apiKey)`：插件固定传 `format="markdown"`，返回 `string` 即原样输出，返回对象则按 `title/url/date/content` 兜底拼文本。
- 工具与提示词由 **能力声明在插件 `onLoad` 时一次性决定**，因此：
  - 切换供应商后必须 `reloadPlugin`（前端已实现）；
  - `web_parser` 只在 `supportsWebpageExtract=true` 时注册。
- 设置分组 `search` 无后端 schema 校验，直接 `{ provider, bocha:{apiKey}, tavily:{apiKey}, metaso:{apiKey} }` 持久化。
- 术语：项目里 “search engine interface” 就是这层 `SearchProvider` 抽象，不涉及 LLM 侧的 server-side tool。

### 1.4 现状的几处硬编码（本次顺手治理）

1. `web-search.plugin.ts::getProviderWithKey` 里有一张 `{ bocha:'博查', tavily:'Tavily', metaso:'秘塔' }` 名字表，新增供应商必须同步改两处 → 改用 `provider.displayName`。
2. 前端 `providerKeys` 与两处 `watch`/`originalSettings` 各写一遍供应商列表 → 新增一家要改 5 处（见 §4.2）。
3. 各 Provider 的 `readWebpage` 在 `capabilities.supportsWebpageExtract=false` 时仍是死代码（如 Bocha 用搜索接口凑正文）。本次不扩散。

---

## 二、DeepSeek Search / Fetch API 摘要

Base URL：`https://api.deepseek.com`，Bearer 鉴权，与 DeepSeek 模型 API 同一套 Key。

| 能力 | 端点 | 说明 |
| --- | --- | --- |
| Search | `POST /v1/tools/search` | 自研搜索引擎，按 query 返回结构化结果 |
| Fetch | `POST /v1/tools/fetch` | 抓取单个 URL，返回 Markdown 正文 |

### 2.1 Search 请求字段

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `query` | string | 是 | - | 1～128 Unicode 字符，不能全空白；支持 `site:` / `-site:` / `-词` / `-"短语"` / `"精确短语"` / `lang:` / `after:` / `before:` |
| `count` | integer | 否 | 10 | 1～50 |
| `ori_question` | string | 否 | - | 触发搜索的原始用户问题，1～128 字符，有助于理解意图 |
| `localization` | string | 否 | "" | 用于本地化排序的 IP |
| `need_content` | boolean | 否 | false | 为 true 时在 `content` 返回正文，否则恒为空串 |

### 2.2 Search 响应

```json
{ "results": [ {
  "rerank_score": 2.4, "title": "...", "url": "...",
  "snippet": "100~200 字符短摘要", "summary": "600~800 字符长摘要",
  "content": "网页正文（need_content=true 时）",
  "site_name": "Example News", "site_icon": "https://...",
  "date": "2026-06-01T00:00:00+00:00", "authority": 3
} ] }
```

- 无 `total` 字段，用 `results.length`。
- `rerank_score` 0～3，≥1.5 为优质；`authority` 0～4（-1 未知），≥3 极权威。
- 正常但无结果 → HTTP 200 + 空数组。

### 2.3 Fetch

- 请求：`{ "url": "https://..." }`，URL ≤8192，必须带 host 的 http/https，且不能带账号密码。
- 响应：`{ "title": "...", "content": "# Markdown 正文" }`。

### 2.4 错误 / 限速 / 计费

- 错误体为 OpenAI 兼容格式：`{ error: { message, type, param:null, code } }`。
- 状态码：400 参数/JSON 非法、401 Key 缺失或无效、402 余额不足、403 Fetch 被安全策略拒绝、404 抓不到可用正文、408 读体超时、413 体过大、429 限速、5xx 服务端。
- 限速：Search 100 QPS、Fetch 25 QPS（账号级，与 Key 无关；Fetch 另有目标域名级限速）。
- 计费：**按成功请求计次**，Search/Fetch 各 5 元 / 1000 次；`count` 不影响单价；失败/无结果不计费。2026-11-01 起 Harness 内的 Server 端调用也开始计费（与本项目无关，但可作预算提示）。

---

## 三、能力映射

| 契约字段 | DeepSeek 适配 |
| --- | --- |
| `name` | `deepseek`（= 设置里的 provider 值） |
| `displayName` | `DeepSeek` |
| `capabilities.scope` | `{ supported: false }` —— 无 scope 参数，站点/语言/时间用 query 语法表达 |
| `capabilities.searchReturnsContent` | `true` —— `need_content: true` |
| `capabilities.supportsWebpageExtract` | `true` —— Fetch 接口，注册 `web_parser` |
| `capabilities.scoreType` | `"number"`（`rerank_score`） |
| `size` → `count` | 直接映射，插件已限制 1..50，Provider 内再夹一次 |
| `title` ← `title` | 直接映射 |
| `link` ← `url` | 直接映射 |
| `score` ← `rerank_score` | `String(rerank_score ?? "unknown")` |
| `summary` ← `summary` ?: `snippet` | 优先长摘要（本来就是给模型读的） |
| `content` ← `content` | `safeTruncate(content, 5000)`，与 Tavily 对齐，避免撑爆上下文 |
| `date` ← `date` | 原样透传（RFC3339 UTC，与 Bocha/Tavily 行为一致） |
| `total` | `results.length` |
| `readWebpage` | `POST /v1/tools/fetch` → Markdown 正文；403/404 给出可读错误 |

> `site_name` / `site_icon` / `authority` 当前契约无槽位：不新增字段（避免动 `SearchResult` 影响面）。若后续前端要展示权威度，再以可选字段扩展。

---

## 四、改造清单

### 4.1 后端

#### ① 新增 `search-providers/deepseek.provider.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";
import {
  SearchProvider, SearchOptions, SearchResponse, SearchResult,
  ParseResponse, SearchCapabilities,
} from "./search-provider.interface";
import { safeTruncate } from "../../../../common/utils/string.utils";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_SEARCH_URL = `${DEEPSEEK_BASE_URL}/v1/tools/search`;
const DEEPSEEK_FETCH_URL = `${DEEPSEEK_BASE_URL}/v1/tools/fetch`;
const MAX_QUERY_LENGTH = 128;   // DeepSeek 硬限制
const MAX_CONTENT_LENGTH = 5000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class DeepSeekProvider implements SearchProvider {
  readonly name = "deepseek";
  readonly displayName = "DeepSeek";
  readonly capabilities: SearchCapabilities = {
    scope: { supported: false },
    searchReturnsContent: true,
    supportsWebpageExtract: true,
    scoreType: "number",
  };
  private readonly logger = new Logger(DeepSeekProvider.name);

  async search(q: string, options: SearchOptions, apiKey: string): Promise<SearchResponse> {
    const { size = 10 } = options;
    const query = safeTruncate(q, MAX_QUERY_LENGTH);
    if (query !== q) this.logger.warn(`Query truncated to ${MAX_QUERY_LENGTH} chars`);

    const data = await this.postJson(
      DEEPSEEK_SEARCH_URL,
      { query, count: Math.min(Math.max(size, 1), 50), need_content: true },
      apiKey,
      "DeepSeek search",
    );

    const results: SearchResult[] = (data?.results ?? []).map((item: any, index: number) => {
      const result: SearchResult = {
        index: index + 1,
        title: item.title || "",
        link: item.url || "",
        score: item.rerank_score != null ? String(item.rerank_score) : "unknown",
      };
      if (item.date) result.date = item.date;
      const summary = item.summary || item.snippet;
      if (summary) result.summary = summary;
      if (item.content) result.content = safeTruncate(item.content, MAX_CONTENT_LENGTH);
      return result;
    });

    return { total: results.length, results };
  }

  async readWebpage(url: string, format: string, apiKey: string): Promise<ParseResponse | string> {
    const data = await this.postJson(DEEPSEEK_FETCH_URL, { url }, apiKey, "DeepSeek fetch");
    const title = data?.title || "";
    const content = data?.content || "";
    if (!content) return "No content found for the given URL";

    if (format === "markdown") {
      return [`# ${title || "Untitled"}`, "", `> Source: ${url}`, "", content].join("\n");
    }
    return { title, url, content };
  }

  /** 统一 POST：Bearer 鉴权 + 幂等重试（408/429/5xx）+ OpenAI 错误体解析 */
  private async postJson(url: string, body: unknown, apiKey: string, label: string): Promise<any> {
    const payload = JSON.stringify(body);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: payload,
      });

      if (response.ok) return response.json();

      const raw = await response.text().catch(() => "");
      const message = this.errorMessage(response.status, raw);
      if (!RETRYABLE.has(response.status) || attempt === 2) {
        throw new Error(`${label} failed (${response.status}): ${message}`);
      }
      lastError = new Error(message);
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt;
      this.logger.warn(`${label} ${response.status}, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastError ?? new Error(`${label} failed`);
  }

  private errorMessage(status: number, raw: string): string {
    let message = raw;
    try {
      message = JSON.parse(raw)?.error?.message || raw;
    } catch { /* 非 JSON，保留原文 */ }
    switch (status) {
      case 401: return `invalid API key (${message})`;
      case 402: return `insufficient balance, please top up (${message})`;
      case 403: return `request rejected by safety policy (${message})`;
      case 404: return `no readable content at this URL (${message})`;
      case 429: return `rate limited, please retry later (${message})`;
      default: return message;
    }
  }
}
```

要点：
- 只新增一个文件，不动现有 Provider；`SearchProvider` 契约零改动。
- `need_content: true` 是「按次计费」下的免费收益（同一请求内返回正文）；正文 5000 字符截断与 Tavily 一致。
- 失败重试只覆盖幂等只读请求，符合官方「408/429/5xx 等待后重试，其它 4xx 不要重试」的建议。

#### ② `plugins.module.ts`：注册 Provider

```ts
import { DeepSeekProvider } from "./builtins/search-providers/deepseek.provider";
// providers 数组追加
DeepSeekProvider,
```

#### ③ `web-search.plugin.ts`：接入 + 去硬编码

```ts
constructor(
  private readonly settingsStorage: SettingsStorage,
  private readonly bochaProvider: BochaProvider,
  private readonly metasoProvider: MetasoProvider,
  private readonly tavilyProvider: TavilyProvider,
  private readonly deepSeekProvider: DeepSeekProvider,
  private readonly providerStore: ProviderFileStore, // @Global LlmCoreModule 导出
) { super(); }

this.providers = [this.bochaProvider, this.tavilyProvider, this.metasoProvider, this.deepSeekProvider];
```

错误提示改用 `provider.displayName`，删掉 `names` 表：

```ts
throw new Error(
  `Please configure the ${provider.displayName} API Key in the system settings > Search settings.`,
);
```

Key 解析支持「复用模型服务 Key」（`deepseek.useProviderKey === true`）：

```ts
private resolveApiKey(providerName: string, providerCfg: any): string {
  if (providerName === "deepseek" && providerCfg?.useProviderKey === true) {
    const key = this.findModelProviderKey(providerName);
    if (!key) {
      throw new Error(
        "No DeepSeek API Key found in Models settings. Configure a DeepSeek provider there, " +
          'or uncheck "Use model provider key" in Settings > Search.',
      );
    }
    return key;
  }
  return providerCfg?.apiKey || "";
}

private findModelProviderKey(type: string): string {
  const candidates = this.providerStore
    .listProviders()
    .filter((p) => p.type === type && p.apiKey?.trim());
  return (candidates.find((p) => p.enabled) || candidates[0])?.apiKey?.trim() || "";
}
```

> 语义：**显式勾选**才复用（`=== true`），未勾选时沿用输入框里的 Key；不复用「留空即静默回退」，避免用户以为在用自己填的 Key。首次加载且未填 Key 时前端默认勾选。

### 4.2 前端

1. `types/service.ts`：

```ts
export interface SearchGroupSettings {
  provider?: string
  bocha?: { apiKey?: string }
  tavily?: { apiKey?: string }
  metaso?: { apiKey?: string }
  deepseek?: { apiKey?: string; useProviderKey?: boolean }   // 新增
}
```

2. `SearchSettings.vue` 需要同步 5 处（建议顺手抽 `PROVIDERS` 常量数组循环渲染，减少下次新增成本）：
   - 下拉选项：`<el-option label="DeepSeek" value="deepseek" />`
   - Key 输入块：`v-if="selectedProvider === 'deepseek'"`，placeholder `sk-...`，获取地址 `https://platform.deepseek.com/api_keys`
   - Key 输入框下方复选框：「使用模型服务中的 DeepSeek Key」→ `deepseek.useProviderKey`；勾选时输入框禁用（保留已填 Key 以便切回），首次加载且未填 Key 时默认勾选
   - `providerKeys` 增加 `deepseek: ''`
   - `watch` 依赖数组增加 `providerKeys.deepseek` 与 `deepseekUseProviderKey.value`
   - `loadSettings` / `handleSave` / `originalSettings` 各补 `deepseek`（含 `useProviderKey`）

3. 文案 `locales/zh-CN/settings.ts` / `en-US/settings.ts`：

```ts
deepseek: 'DeepSeek',
deepseekApiKey: 'DeepSeek API Key',
deepseekApiKeyDesc: 'DeepSeek 搜索 API 密钥（与 DeepSeek 模型 API 共用）。',
deepseekUseProviderKey: '使用模型服务中的 DeepSeek Key',
deepseekUseProviderKeyDesc: '勾选后直接复用「模型服务」里已配置的 DeepSeek API Key，此处输入的 Key 将被忽略。',
deepseekUseProviderKeyPlaceholder: '自动复用模型服务中的 Key',
deepseekTip: '• DeepSeek 自研搜索引擎，中英文表现均衡，按成功请求计费（5 元 / 1000 次）；支持 site:/lang:/after: 等检索语法',
```

### 4.3 可选增强（建议分阶段，不阻塞 MVP）

| 增强 | 做法 | 价值 | 风险 |
| --- | --- | --- | --- |
| 复用模型侧 DeepSeek Key | ✅ 已实现：搜索设置的 DeepSeek Key 输入框下方新增复选框「使用模型服务中的 DeepSeek Key」，设置项 `deepseek.useProviderKey`；后端 `getProviderWithKey` 命中时从 `ProviderFileStore.listProviders()` 取 `type==='deepseek'` 的 Key（优先 enabled）。首次加载且未填 Key 时开关默认勾选，输入框禁用并保留手动 Key 以便随时切回 | 用户不必二次粘贴 Key，零配置可用 | 插件层读取 LLM 配置；已 try/catch 兜底，找不到 Key 时给出「去模型服务配置 / 取消勾选」的可行动作提示 |
| 搜索语法提示 | `SearchCapabilities` 增加可选 `promptHints?: string[]`，插件把它拼进 `web_search` 描述与工具提示词 | 让模型主动用 `after:`/`site:`，中文检索质量明显提升 | 工具描述变长（注意「对外只广告最简形态」约定，控制在 1～2 行） |
| 传 `ori_question` | `SearchOptions` 增加可选 `oriQuestion`，插件从最近一条用户消息取 | 提升长问句意图理解 | 需要把会话上下文带进 execute，改动面较大，暂缓 |
| 自定义 Base URL | 设置项加 `deepseek.baseUrl`，默认官方地址 | 兼容代理/中转 | 引入新 schema 与 UI，收益低 |
| 共享重试工具 | 把 `postJson` 抽到 `search-providers/http.util.ts`，Bocha/Tavily/Metaso 逐步复用 | 统一 429 处理 | 单独 PR 处理，避免与本次功能混在一起 |

---

## 五、验证

### 5.1 单元测试

**`deepseek.provider.spec.ts`（Provider 层，13 例）**

按项目现有 jest + 手写替身风格（mock `global.fetch`，不联网）：

1. **请求映射**：`size=5` → `count:5`、`need_content:true`、Bearer 头正确。
2. **响应映射**：`rerank_score` → `score`、`summary` 优先于 `snippet`、`date` 透传、`total` 等于条数。
3. **空结果**：`{ results: [] }` → `{ total: 0, results: [] }`。
4. **长正文**：`content` > 5000 → 截断。
5. **超长 query**：>128 字符 → 截断后再发出。
6. **401**：抛出含 `invalid API key` 的错误且不重试（fetch 仅调用 1 次）。
7. **429 → 200**：重试成功（可用假定时器跳过退避等待）。
8. **Fetch**：返回 Markdown 含标题/Source；返回对象分支字段正确；403/404 错误信息可读。

**`web-search.plugin.spec.ts`（插件层，6 例）**

- `useProviderKey=true` → 使用模型服务中 **enabled** 的 DeepSeek Key；
- 勾选优先于手动 Key；未勾选用手动 Key；
- 勾选但模型服务无 Key → 报错含「No DeepSeek API Key found in Models settings」且不发请求；
- 未勾选且 Key 为空 → 保持原提示；
- DeepSeek 供应商注册 `web_search` + `web_parser` 两个工具。

### 5.2 手工验收

1. 设置 → 搜索 → 选 DeepSeek，粘贴 Key（不点保存也自动保存）→ 插件自动 reload。
2. 对话中要求搜索实时新闻 → 观察工具卡片、结果条数与正文长度。
3. 让模型读取某个 URL → `web_parser` 生效（说明 `supportsWebpageExtract` 分支注册正确）。
4. 断网 / 填错 Key → 报错文案可读，不出现 `[object Object]`。
5. 切回博查 → 工具描述与 Key 回填正确（验证不串配置）。

### 5.3 真实链路实测（2026-10-20）

脚本：`backend-ts/scripts/test-deepseek-search.ts`（只读供应商 yaml 取 Key，不修改配置、不落盘，打印掩码）

```bash
cd backend-ts && npx ts-node --transpile-only scripts/test-deepseek-search.ts
```

实测结果（真实 Key，来自 `~/.guada/providers/*.yaml` 的 `type: deepseek` 实例）：

| 环节 | 结果 |
| --- | --- |
| `Provider.search("DeepSeek 最新模型 发布", size=3)` | HTTP 200，447ms，3 条结果，`score` 2.40～2.68，`summary` 324～1437 字，`content` 达 5000 字截断，`date` 正常 |
| `Provider.readWebpage(api-docs.../guides/search)` | 89ms，返回 6477 字 Markdown（标题 + Source + 正文） |
| 插件全链路（`settings: deepseek + useProviderKey=true`） | 322ms，正确复用模型侧 Key，`web_search` 输出格式化文本，`web_parser` 已注册 |

结论：Search / Fetch 接口、Provider 解析、模型侧 Key 复用、插件拼文本均可用。

### 5.4 回归
- `pnpm --dir backend-ts test`（至少跑 `deepseek.provider.spec.ts` 与 plugins 相关用例）。
- `pnpm --dir backend-ts run build`、`pnpm --dir frontend run build`。
- 三个旧 Provider 的行为不变（本次唯一共享改动是 `web-search.plugin.ts` 的错误提示改用 `displayName`，输出语义一致）。

---

## 六、风险与注意事项

1. **128 字符查询上限**：中文长问句很容易超；截断会损失意图，但报错更差。建议截断 + warn 日志，并在提示词里引导模型用短关键词查询（可选增强项）。
2. **正文体积**：`need_content` 是随请求免费的，但模型上下文按 token 计费；5000 字符截断是必要护栏。
3. **429 与账号级 QPS**：Search 100 / Fetch 25，多会话并发时可能触发；已加指数退避，`Retry-After` 优先。
4. **Fetch 的 403/404 不是「Key 错」**：UI 文案不要误导用户去改 Key。
5. **计费**：成功且非空才算一次；调试时避免循环调用（单次 0.005 元，量级很小，但自动化测试不应打真实接口）。
6. **插件 reload 时机**：`onLoad` 决定注册 `web_parser`；若未来支持「运行中热切 Provider」，必须 reload，否则会继续用旧 Provider 闭包。
7. **Key 归属**：DeepSeek 搜索与模型共用 Key；若用户只填了模型侧 Key，MVP 阶段会提示「去搜索设置填 Key」，可选增强再支持自动复用。

---

## 七、落地顺序

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| P0 | `deepseek.provider.ts` + 两个后端注册点 + 单测 | 0.5 天 |
| P0 | 前端设置项（含 5 处同步）+ 中英文案 | 0.5 天 |
| P1 | 复用模型侧 Key（复选框 + `ProviderFileStore` 兜底） | ✅ 已完成 |
| P1 | `promptHints` 能力字段 + DeepSeek 检索语法提示 | 0.5 天 |
| P2 | 抽公共 `postJson` 重试工具，回灌其它 Provider | 1 天（独立 PR） |

P0 完成后即具备完整可用能力（搜索 + 抓取 + 设置 + 报错），P1/P2 为体验与可维护性优化。
