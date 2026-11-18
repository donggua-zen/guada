# DeepSeek OCR 接入知识库方案（可行性评估 + 改造清单）

> 目标：把 DeepSeek 官方独立 OCR 接口（`POST /v1/tools/ocr`）接入本项目知识库的 OCR 供应商体系，作为 UMI-OCR、百度之外的第三选项；并复用搜索设置里那套「使用模型服务 Key」的机制，让用户不必二次粘贴 DeepSeek API Key。
> 参考文档：DeepSeek《OCR 指南》<https://api-docs.deepseek.com/zh-cn/guides/ocr>、《全家桶应用 API》<https://api-docs.deepseek.com/zh-cn/news/news261113/>
> 调研日期：2026-11-18

---

## 一、结论：可行，且改动收敛

**可行。** 三个有利条件：

1. **项目已有干净的 OCR 供应商抽象**：`OcrService.getCapabilities()` 声明能力、`recognizeImageBuffer()` 处理图片、`recognizePdfPages()` / `recognizePdf()` 处理 PDF，调用方 `FileParserService` 完全按能力声明路由。新增一家供应商 = 加一个 `provider === 'deepseek'` 分支 + 一个私有识别方法，**不动调用链**。
2. **DeepSeek OCR 与现有供应商形态一致**：独立 HTTP 接口、Bearer 鉴权、multipart 上传、按页返回结果，和百度 OCR 的接入姿势几乎相同；且它原生支持 PDF/Word/PPT 直传。
3. **Key 复用机制有现成范例**：搜索插件的 `resolveApiKey` + `findModelProviderKey`（`web-search.plugin.ts:188-215`）已经实现「勾选后从模型供应商取 Key」，`ProviderFileStore` 由 `@Global` 的 `ProvidersModule` 导出，`OcrService` 可直接注入——不需要新增任何跨模块 plumbing。

**定价参照**：每 1,000 页 1.5 元（按成功页数计费，失败/超时不计费）；账号级并发上限 15，与对话模型分开计算。相比百度的按张计费，扫描件 PDF 单页成本更低，且省掉本地部署 UMI 的运维。

**需要注意的一个坑**：DeepSeek 逐页 OCR 的文本里会保留 `<｜ref｜>` / `<｜box｜>[[x1,y1,x2,y2]]` 等标记和归一化坐标，直接入库会污染文本块和向量。必须在 provider 内清洗（见 §3.1 ③）。

---

## 二、现状链路与契约

### 2.1 OCR 调用链

```
PDF/图片上传 → KbFileService → FileParserService.parseFile / parsePdf
   ├─ 图片：ocrService.recognizeImage(filePath)                       file-parser.service.ts:156
   └─ PDF ：ocrService.getCapabilities() + getScanOcrStrategy()       file-parser.service.ts:287-288
             ├─ 页面级路由：低字符页 = 疑似扫描页（或 force 全页）
             ├─ native + 整本扫描 → ocrService.recognizePdf()         :346
             └─ render（百度）/ 局部补页 → ocrService.recognizePdfPages() :364
                    └─ PdfToImageService.renderPages() 逐页渲染 → recognizeImageBuffer() :330
```

### 2.2 关键文件

| 文件 | 职责 / 改动 |
| --- | --- |
| `backend-ts/src/modules/knowledge-base/ocr.service.ts` | OCR 供应商核心：**主改动点**。配置接口、能力声明、图片/PDF 识别分派 |
| `backend-ts/src/modules/knowledge-base/file-parser.service.ts` | OCR 调用方，**无需改动**（按能力声明自动路由） |
| `backend-ts/src/modules/knowledge-base/knowledge-base.module.ts` | OcrService 已注册；`ProviderFileStore` 来自 `@Global` 模块，**无需加 import** |
| `backend-ts/src/modules/plugins/builtins/web-search.plugin.ts` | Key 复用范式参考（`:188-215`），**无需改动** |
| `frontend/src/components/setting/OcrSettings.vue` | OCR 设置界面：新增供应商选项、Key 输入、复用开关 |
| `frontend/src/types/service.ts` → `OcrGroupSettings` | 类型定义新增 `deepseek` 字段 |
| `frontend/src/locales/{zh-CN,en-US}/settings.ts` | 中英文案 |
| `backend-ts/src/modules/settings/settings.constants.ts` | `SG_OCR` 分组常量（无需改，确认存在即可） |

### 2.3 现有契约要点

- `getCapabilities(): { supportsPdf, supportsImage, pdfMode: "native"|"render"|"none" }`
  - `native`：服务原生接收 PDF（UMI）；`render`：只收图片，须先渲染逐页（百度）
- `recognizeImageBuffer(buffer, mimeType?, hintName?): Promise<string>`：图片识别统一入口，返回**纯文本**
- `recognizePdfPages(filePath, pageNumbers[], onProgress): Array<{page, text}>`：渲染逐页路径
- 扫描策略 `ocrMode: "auto" | "force"`：auto 仅对低字符页 OCR，force 全页强制
- 设置分组 `ocr` 无后端 schema 校验，直接持久化；前端分组设置接口 `apiService.updateGroupSettings('ocr', ...)`

---

## 三、DeepSeek OCR API 摘要

### 3.1 接口

```
POST https://api.deepseek.com/v1/tools/ocr
Authorization: Bearer <DeepSeek API Key>
Content-Type: multipart/form-data

字段（均必填，purpose 必须在 file 之前）：
  purpose: text_recognition | rich_layout_recognition
  file:    PDF / Word / PPT / PNG / JPEG / WebP / ... （需带文件名）
```

返回（识别过程中服务端持续发换行保活，最终一个 JSON 对象；换行是合法 JSON 前导空白，可直接 parse）：

```json
{
  "id": "ocr-...", "object": "ocr.result", "page_count": 2,
  "pages": [
    {"index": 0, "text": "...", "finish_reason": "stop"}
  ],
  "usage": {"input_tokens": 1536, "output_tokens": 412, "total_tokens": 1948}
}
```

**关键实现细节**：

1. **保活换行**：响应体形如 `\n\n\n{...json...}`，`JSON.parse` 天然忽略前导空白，直接 parse 即可；但不能用 SSE 解析器。
2. **特殊标记清洗**：`text_recognition` 对 PDF/图片逐页识别时，文本含 `<｜ref｜>标题<｜/ref｜><｜box｜>[[52,40,948,96]]<｜/box｜>`。入库前需剥离：
   ```ts
   text.replace(/<｜ref｜>(.*?)<｜\/ref｜>/gs, "$1")
       .replace(/<｜box｜>\[\[.*?\]\]<\/｜?box｜>|<｜box｜>\[\[.*?\]\]<\｜\/box｜>/g, "")
       .replace(/<｜[^｜]+｜>/g, "");   // 兜底：清除任何残留 ｜xx｜ 标记
   ```
   （建议用单条组合正则并加单测覆盖样例文本，避免标记变体漏网。）
3. **`purpose` 选择**：知识库只要文字 → 统一用 `text_recognition`（`rich_layout_recognition` 会裁图并额外占 Token，本项目用不上）。
4. **`finish_reason === "length"`** 表示该页输出被截断，应记 warn 日志（文本不完整），不静默当成功。
5. **HTTP 200 后的错误体**：识别开始后状态码已是 200，失败时响应体是 `{ error: { message, ... } }`，须检查 `error` 字段；`pages.length === 0` 也视为失败。
6. **限制**：单文件 ≤100 MiB、≤1000 页、上传 120 秒内完成、总时长 180 秒；账号并发 15。错误体 OpenAI 兼容；`402` 余额不足、`408` 上传超时、`413` 过大、`429` 并发超限、`5xx` 可重试（参见搜索 provider 的 `retryWithBackoff` 口径）。

### 3.2 能力映射

| 契约 | DeepSeek 取值 | 理由 |
| --- | --- | --- |
| `provider` | `"deepseek"` | 与搜索设置、模型供应商 type 保持一致 |
| `supportsPdf` | `true` | 原生支持 PDF 直传 |
| `supportsImage` | `true` | 支持 PNG/JPEG 等 |
| `pdfMode` | **`"render"`** | 关键点见下 |
| 图片识别 | `recognizeImageBuffer` 新增分支 → 走 multipart 上传 buffer | 与 UMI/百度同构 |
| PDF 识别 | 走 `recognizePdfPages`（渲染逐页 + 每页一次 OCR 请求） | 见下 |

**为什么 `pdfMode` 选 `render` 而不是 `native`？**

现有 `native` 路径（`recognizePdf` → `recognizePdfWithUmi`）假设供应商能「一次上传整份 PDF + 异步轮询 + 指定页码」，且 `FileParserService:356` 在 native 整本扫描时把全文塞进**单个** `pages[{pageNum:1}]`。DeepSeek 的 OCR 是同步整文件识别，没有「按页码子集识别」参数，若声明 native：
- 混合 PDF（部分文本页 + 少量扫描页）无法只 OCR 指定页 → 要么整本重识别（成本浪费且丢失文本层结构），要么走 render 路径；
- 单页条目会让 chunk 的页码元数据全部变成 1，破坏按页溯源。

因此声明 `render`：复用既有「渲染为图片 → `recognizeImageBuffer` 逐页识别」管线，天然对齐页面级混合路由、页码、进度回调。代价是混合 PDF 每页一次 HTTP 请求（单页成本不变、按页计费口径一致），且受账号并发 15 限制——`recognizePdfPages` 是串行的，不会触顶。若后续要优化，可加 `recognizePdfNative`（一次上传整 PDF、`pages[].index` 直接映射页码）并在 `FileParserService` 增加 `nativeSync` 模式，属 P2。

---

## 四、改造清单

### 4.1 后端：`ocr.service.ts`

**① 类型与配置**

```ts
type OcrProvider = "umi" | "baidu" | "deepseek" | "none";

interface OcrConfig {
  provider: OcrProvider;
  // ... 既有字段
  deepseek?: {
    apiKey?: string;
    useProviderKey?: boolean;   // 复用模型服务 Key（默认 true，同搜索语义）
  };
}
```

`getOcrConfig()` 从 `settingsService.getGroupSettings("ocr")` 读出后补一行：

```ts
deepseek: {
  apiKey: settings.deepseek?.apiKey || "",
  useProviderKey: settings.deepseek?.useProviderKey ?? true,  // 未配置时默认复用
},
```

**② 注入 `ProviderFileStore` + Key 解析**（照搬搜索插件语义）

```ts
import { ProviderFileStore } from "../llm-core/provider-file.store";

constructor(
  private readonly httpService: HttpService,
  private readonly settingsService: SettingsService,
  private readonly providerStore: ProviderFileStore,      // 新增；@Global 可直接注入
  @Optional() private readonly pdfToImage?: PdfToImageService,
) {}

private resolveDeepSeekKey(config: OcrConfig): string {
  if (config.deepseek?.useProviderKey) {
    const candidates = this.providerStore.listProviders()
      .filter((p) => p.type === "deepseek" && p.apiKey?.trim());
    const key = (candidates.find((p) => p.enabled) || candidates[0])?.apiKey?.trim();
    if (key) return key;
    throw new Error(
      "未在模型服务中找到 DeepSeek API Key，请在「模型服务」中配置 DeepSeek 供应商，" +
      "或在 OCR 设置中关闭「使用模型服务 Key」并手动填写。"
    );
  }
  const key = config.deepseek?.apiKey?.trim();
  if (!key) throw new Error("请先在设置中配置 DeepSeek OCR API Key");
  return key;
}
```

> 复用语义与搜索保持一致：`useProviderKey === true` 时优先取模型侧 **enabled** 的 DeepSeek Key；取不到时**报错并给出可行动作**，不静默回退到空/手动 Key。前端首次加载且未填 Key 时默认勾选（同 `SearchSettings.vue:207-208`）。
>
> DI 注意：`OcrService` 的构造签名被部分单测以两参方式 `new OcrService(http, settings)` 调用（现有代码注释 `:125` 已标注）。把 `providerStore` 放在 `pdfToImage` 之前会破坏这些调用——建议放**最后**并加 `@Optional()`，内部 `this.providerStore?.listProviders() ?? []` 兜底，或在测试里同步补第三个参数。

**③ 能力声明**

```ts
async getCapabilities(): Promise<OcrCapabilities> {
  // 既有 umi / baidu 分支不变
  if (config.provider === "deepseek") {
    return { supportsPdf: true, supportsImage: true, pdfMode: "render" };
  }
  return { supportsPdf: false, supportsImage: false, pdfMode: "none" };
}
```

**④ 图片识别分派 + 实现**

`recognizeImageBuffer()` 加分支：

```ts
} else if (config.provider === "deepseek") {
  return await this.recognizeImageWithDeepSeek(buffer, config, label);
}
```

新增私有方法——与百度分支同构，但走 multipart 且按页解析：

```ts
private async recognizeImageWithDeepSeek(
  fileData: Buffer, config: OcrConfig, label: string
): Promise<string> {
  const apiKey = this.resolveDeepSeekKey(config);
  const { default: FormData } = await import("form-data");
  const form = new FormData();
  form.append("purpose", "text_recognition");
  form.append("file", fileData, { filename: label || "image.png" });

  const response = await firstValueFrom(
    this.httpService.post<any>(
      "https://api.deepseek.com/v1/tools/ocr",
      form,
      { headers: form.getHeaders(), timeout: 190000 },
    ),
  );
  return this.parseDeepSeekOcrResponse(response.data, label);
}
```

**⑤ 响应解析 + 标记清洗**（新增私有方法，供图片与未来 PDF native 复用）

```ts
private parseDeepSeekOcrResponse(data: any, label: string): string {
  if (!data || (!Array.isArray(data.pages) && data.error)) {
    throw new Error(`DeepSeek OCR 识别失败: ${data?.error?.message || "空响应"}`);
  }
  const pages = data.pages || [];
  if (!pages.length) throw new Error(`DeepSeek OCR 未返回识别结果: ${label}`);
  const truncated = pages.filter((p: any) => p.finish_reason === "length").length;
  if (truncated) {
    this.logger.warn(`DeepSeek OCR 有 ${truncated} 页输出被截断（${label}）`);
  }
  return pages
    .map((p: any) => String(p.text || ""))
    .map(cleanDeepSeekOcrText)      // 剥离 <｜ref｜>/<｜box｜> 标记与坐标
    .join("\n")
    .trim();
}

export function cleanDeepSeekOcrText(text: string): string {
  return text
    .replace(/<｜ref｜>([\s\S]*?)<｜\/ref｜>/g, "$1")
    .replace(/<｜box｜>[\s\S]*?<\｜\/box｜>/g, "")
    .replace(/<｜[^｜]{1,20}｜>/g, "");
}
```

**⑥ 可重试错误判定**：`isRetryableOcrError()`（`:695`）已覆盖 429/5xx 与网络关键字，DeepSeek 的 `408`（上传超时）可考虑加入 `RETRYABLE_STATUS`——但 408 多半意味着文件过大/网络慢，重试收益低，建议**不加**，保持现状。

### 4.2 前端

1. **`types/service.ts`**：

```ts
export interface OcrGroupSettings {
  // ... 既有字段
  deepseek?: { apiKey?: string; useProviderKey?: boolean }
}
```

2. **`OcrSettings.vue`**：
   - 供应商下拉新增 `<GdOption :label="t('settings.ocr.deepseek')" value="deepseek" />`
   - 新增 `v-if="settingsForm.provider === 'deepseek'"` 配置块（仿 `SearchSettings.vue:72-89`）：
     - Key 输入框（`type="password" show-password`），`disabled` 绑定 `deepseekUseProviderKey`
     - 复选框「使用模型服务中的 DeepSeek Key」→ `deepseekUseProviderKey`
     - 获取 Key 链接 `https://platform.deepseek.com/api_keys`
   - `settingsForm` reactive 增加 `deepseekApiKey: ''`、`deepseekUseProviderKey: true`
   - **watch 必须包含新字段**：现有 watch（`:140-147`）只列了 4 个字段且**漏了 baiduApiKey/baiduSecretKey**（既有缺陷，百度 Key 改了不会触发自动保存）。本次顺手把 baidu 两个字段和 deepseek 两个字段一并补齐。
   - `loadSettings()`：`deepseekUseProviderKey = response.deepseek?.useProviderKey ?? !response.deepseek?.apiKey`
   - `handleSave()`：provider 为 deepseek 时写入 `dataToSave.deepseek = { apiKey, useProviderKey }`（仿 `SearchSettings.vue:249`）
   - 提示区新增 deepseek 分支：按页计费 1.5 元/千页、支持 PDF/Word/PPT/图片、文本已自动清洗布局标记

3. **文案 `locales/zh-CN/settings.ts` / `en-US/settings.ts`**（`ocr` 段，约 `:263-292`）：

```ts
deepseek: 'DeepSeek',
deepseekApiKeyDesc: 'DeepSeek API Key（与模型服务共用，按识别页数计费）。',
deepseekUseProviderKey: '使用模型服务中的 DeepSeek Key',
deepseekUseProviderKeyDesc: '勾选后直接复用「模型服务」里已配置的 DeepSeek Key，此处输入的 Key 将被忽略。',
deepseekUseProviderKeyPlaceholder: '自动复用模型服务中的 Key',
deepseekTip1: '• 支持 PDF / Word / PPT / 图片，原生按页识别，无需本地部署服务',
deepseekTip2: '• 按成功识别页数计费：1.5 元 / 1,000 页；识别失败不计费',
deepseekTip3: '• 自动剥离 OCR 布局标记，识别文本可直接用于知识库索引',
```

### 4.3 无需改动

- `FileParserService`：能力声明驱动，新增 `render` provider 自动走既有逐页路径
- `KnowledgeBaseModule`：`ProvidersModule` 为 `@Global` 且导出 `ProviderFileStore`，OcrService 可直接注入
- 搜索插件、模型供应商配置：仅复用，不改

---

## 五、测试

### 5.1 单元测试（新增 `ocr.service.spec.ts` 或并入现有测试）

1. `getCapabilities()`：`provider=deepseek` → `{ supportsPdf:true, supportsImage:true, pdfMode:"render" }`
2. `recognizeImageBuffer` → 请求体含 `purpose=text_recognition` + `file` 字段，Bearer Key 正确
3. 响应解析：`\n\n{...}` 保活换行可正常 parse
4. 标记清洗：`<｜ref｜>标题<｜/ref｜><｜box｜>[[52,40,948,96]]<｜/box｜>` → `标题`
5. `finish_reason: "length"` → 输出全文但 logger.warn 被调用
6. 错误：`{ error: { message } }` → 抛出含 message 的错误；`pages: []` → 抛出未返回结果
7. Key 复用：`useProviderKey=true` → 取模型侧 enabled 的 DeepSeek Key
8. Key 复用失败：模型侧无 Key → 抛可行动作错误，不发 HTTP 请求
9. 显式手动 Key：`useProviderKey=false` → 用 `deepseek.apiKey`
10. 回归：umi / baidu 分支行为不变

### 5.2 手工验收（真实链路）

1. 设置 → 模型服务：确认已配置 DeepSeek 供应商（本仓库 `~/.guada/providers/*.yaml` 已有 `type: deepseek` 实例）
2. 设置 → OCR：选 DeepSeek，勾选「使用模型服务 Key」→ 自动保存
3. 上传一份扫描件 PDF 到知识库 → 观察进度（10%→80%）、识别文本无 `<｜ref｜>` / `<｜box｜>` 残留、页码溯源正确
4. 上传纯文本 PDF（auto 策略）→ 零 OCR 成本，不走 DeepSeek 接口
5. force 策略 → 全页识别
6. 图片文件（jpg/png）上传 → 识别成功
7. 取消勾选复用、手动填错 Key → 报错文案可读；清空 Key 且关闭复用 → 提示配置
8. 切回 UMI / 百度 / 不启用 → 各分支行为不变

### 5.3 构建与回归

```bash
pnpm --dir backend-ts test
pnpm --dir backend-ts run build
pnpm --dir frontend run build
```

---

## 六、风险与注意事项

| 项 | 说明 | 处理 |
| --- | --- | --- |
| 布局标记污染 | `<｜ref｜>` / `<｜box｜>` 与坐标会进入文本块和向量 | provider 内清洗 + 单测（§3.1 ②） |
| 图片 Markdown 内容 | `rich_layout_recognition` 裁图会占 Token | 统一用 `text_recognition` |
| 按页 HTTP 请求数 | render 模式逐页调用，100 页 = 100 次请求 | 现有串行路径不会触 15 并发上限；大文档识别耗时长，进度回调已覆盖 |
| `finish_reason=length` | 单页文本被截断且不报错 | warn 日志；知识库场景可接受（超大单页罕见） |
| 180 秒总时长 | 超大 PDF 逐页渲染 + 识别可能超时 | 提示用户拆分文档；`recognizePdfPages` 已有重试（429/5xx） |
| Key 归属 | 模型侧 Key 与 OCR 计费共用同一账号 | 在设置文案里明确「按页另行计费」，避免用户误解为免费 |
| 构造函数兼容性 | `OcrService` 被测试以两参方式实例化 | `ProviderFileStore` 放最后 + `@Optional()`，或同步改测试 |
| 与「全家桶对话内文件输入」的区别 | 本方案接的是**独立 OCR 接口**（只出文本、不入 Files API、不喂模型），不是 Chatbot 的 `POST /files` + `file_id` 流程 | 知识库要的是纯文本切片入库，独立 OCR 接口正是正确选型；若未来要“让模型看图回答”，再评估 Files API 路线 |

---

## 七、落地顺序

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| P0 | `ocr.service.ts`：配置 + 能力声明 + Key 解析 + 图片识别 + 响应清洗；后端单测 | 0.5 天 |
| P0 | 前端：`OcrSettings.vue` + 类型 + 中英文案 + watch 补齐 | 0.5 天 |
| P0 | 手工验收（扫描件 PDF / 纯文本 PDF / 图片 / Key 复用与降级） | 0.5 天 |
| P1 | `recognizePdfNative`：一次上传整 PDF，按 `pages[].index` 溯源，为整本扫描大文档提速（需 `FileParserService` 增 `nativeSync` 模式） | 0.5 天 |
| P2 | 抽取公共 `postJson`/multipart 重试工具，与搜索 provider、百度 OCR 共用 | 独立 PR |

P0 完成后即可用：知识库扫描件识别多一个低成本、零运维的云端选项，且默认复用已有模型 Key，用户零配置。
