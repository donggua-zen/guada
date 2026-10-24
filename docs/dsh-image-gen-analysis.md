# dsh-image-gen 实现原理分析

> 分析对象：<https://github.com/shanliuling/dsh-image-gen>（v0.9.2，Apache-2.0）
> 本地副本：`refs/dsh-plugins/dsh-image-gen`（shallow clone，2026-10-20）
> 规模：79 个源文件 / 约 2.09 万行 TS/TSX；42 个 vitest 测试文件；Node ≥22.19

---

## 1. 一句话结论

它不是一个"调一次 API 返回图片"的小工具，而是 **DeepSeek Harness（DSH）原生插件范式的完整示范**：

> **Host 侧（Node/Cordis）** 注册工具、HTTP 路由、凭证与 OAuth 会话，负责所有网络与落盘；
> **浏览器侧（React Bundle）** 通过 DSH 的 UI 插槽（slots）注入设置页、工具卡片、画廊、画布、输入框胶囊；
> 两侧只通过 **同源 HTTP 路由 + 附件 ID** 交换数据，浏览器永远不接触 API Key / OAuth Token。

图像生成本身反而简单：7 个云厂商 + 3 个订阅账号 + 本地 ComfyUI 被收敛成同一个 `{ data, mediaType }` 结果。真正值得研究的是 **装配模型、provider 适配层、附件/落盘边界、双端插槽与兼容层**。

---

## 2. 能力面

| 维度 | 内容 |
| --- | --- |
| Provider（11） | `google`、`openai`、`openai-compat`、`seedream`（火山 Ark）、`dashscope`（通义）、`xai`、`zhipu`、`comfyui`、`chatgpt-sub`、`grok-sub`、`google-sub` |
| Agent 工具（5） | `generate_image`、`generate_images`（1~10 张顺序批量）、`edit_image`、`canvas_state`、`view_canvas` |
| HTTP 路由（12） | `/plugins/dsh-image-gen/{image,import,delete,save-workspace,studio,inspiration,test,settings-health,canvas-state,canvas-asset,subscription-login,subscription-status}` |
| UI 面（6） | 插件设置卡、工具结果卡（3 个 toolview）、`conversation.view` 画廊、右栏 Studio、输入框 Provider 胶囊、promoted 图片结果节点 |
| 附加能力 | tldraw 无限画布 + 选区截图回传、500+ Prompt 灵感库、多模型横向对比、订阅免 Key、工作区落盘 |

---

## 3. 插件装配模型（DSH / Cordis）

### 3.1 包清单：一个 npm 包，两个运行面

```jsonc
// package.json
"main": "lib/index.js",              // Host：ESM，Node
"exports": {
  ".":        { "default": "./lib/index.js" },
  "./client": { "default": "./lib/client.js" }   // 浏览器：CJS，platform=web
},
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // 装配补丁
  "client": {                                    // 允许注入的 DSH 客户端包
    "inject": ["@deepseek-ai/dsh-client-connection", "...ui-conversation", "...ui-settings", "...ui-slots", "..."],
    "platform": "web"
  }
}
```

```yaml
# cordis.patch.yml —— 把插件插进 DSH 的 profile
- insert:
    - id: image-gen                  # 这个 id 同时是 0.1.7 的设置命名空间
      name: dsh-image-gen
      config:
        provider: google
```

构建：`tsc` 出类型与中间 JS → `tsdown` 打成两个产物（Host ESM / Client CJS），React 等是 external。`scripts/check-package.mjs` 还会把 tarball 装进临时目录，用**已发布的 DSH 0.2.0-rc.2 服务**跑一遍装配断言，防止"源码能跑、装包就炸"。

### 3.2 Cordis 插件形态

```ts
export const name = 'dsh-image-gen'
export const inject = ['tools', 'attachments', 'credentials']   // 硬依赖

export function apply(ctx: Context, config: Config = {}): void {
  // 可选依赖：host 没有这个服务就永远不执行回调（headless 没有人 webServer 也能加载）
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({ path: IMAGE_ROUTE, ... }), 'label')
  })

  // 注册工具
  ctx.tools.register(defineTool({ name: 'generate_image', ... }))

  // 注册"可插拔副作用"：effect 的返回值即卸载函数
  ctx.effect(() => { /* mount */ return () => { /* dispose */ } }, 'label')
}
```

要点：
- **`inject` 声明依赖，`ctx.inject([...], cb)` 做可选注入**，未满足时整条 fiber 不执行而不是报错；
- **`ctx.effect` 是资源生命周期原语**（路由、样式、事件订阅、settings 监听都靠它回收）；
- 同一个 `apply` 里同时装配 Host 能力与（另一个包的）浏览器 Bundle，二者靠 `name`/entry id 对齐。

### 3.3 配置：schemastery + `.volatile()` 热更新

```ts
export const Config = z.object({
  provider: volatile(z.union(IMAGE_PROVIDERS).default('google')),
  googleModel: volatile(z.string().default(DEFAULT_GOOGLE_MODEL)),
  // ... 约 35 个字段
})
```

- 字段级 `.volatile()` 是 DSH 0.1.7 的"在线表单"契约：host 会给每个字段一个 box，`.get()` 拿最新值；
- 入口处 `plainConfig()` 每次读取时拆 box，因此**改设置不需要重启插件**；
- 老 host（≤0.1.6）没有 `volatile`，同一份 schema 退化成普通值，由旧 settings relay 工作；
- 还带一次性迁移 `migrateOpenAICompatConfig()`：旧的单一 OpenAI 槽位如果指向中转站，自动搬到独立的 `openai-compat` 行，两行从此共存。

`resolveProvider(config)` 把 35 个字段压成**恰好一个** provider profile（并在这里做跨字段耦合，例如 Seedream 选 `transparent` 就强制 `png`，避免把 Ark 明确拒绝的组合发到线上）。每次工具调用还可以 `withProviderOverrides()` 临时覆盖 provider/model，但订阅渠道的 model 被忽略（由订阅协议固定）。

---

## 4. 总体架构

```
┌────────────────────────── 浏览器（React Bundle, CJS） ──────────────────────────┐
│ 设置卡 / Provider 胶囊 / 工具结果卡 / 画廊 / Studio / tldraw 画布              │
│  - 读设置：configForms(0.1.7) 或 settingsScope(≤0.1.6)，缺失则 degradedScope     │
│  - 读写 Key：remote.credentials（describe/set，永不见明文）                     │
│  - 生成/批量/导入：fetch 同源 /plugins/dsh-image-gen/*                          │
│  - 画布状态：POST canvas-state（节流、上限、选区截图 dataURL）                  │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ 同源 HTTP（attachment id / JSON / 二进制）
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ Host（Node, Cordis）                                                             │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ tools      │  │ HTTP routes  │  │ attachments  │  │ credentials           │  │
│  │ 5 个工具   │  │ 12 条同源路由│  │ 内容寻址存储 │  │ BYOK + OAuth blob     │  │
│  └─────┬──────┘  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│        │                │                 │                      │              │
│  ┌─────▼────────────────▼─────────────────▼──────────────────────▼───────────┐  │
│  │ 编排层：generateSingle / edit_image / studio / canvas mirror              │  │
│  └─────┬──────────────────────────────────────────────────────────────────────┘  │
│        │                                                                         │
│  ┌─────▼──────────────────────────────────────────────────────────────────────┐  │
│  │ Provider 适配层（全部返回 { data: Uint8Array, mediaType }）               │  │
│  │ google │ openai/compat │ seedream │ dashscope │ xai │ zhipu │ comfyui      │  │
│  │                        订阅：codex / grok / antigravity（OAuth）           │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 关键机制拆解

### 5.1 工具定义：参数、输出 schema、渲染、展示元数据四件套

```ts
ctx.tools.register(defineTool({
  name: 'generate_image',
  description: '...Give a complete visual prompt... A successful image is attached... Do not call read/glob to locate it.',
  parameters: {
    prompt: { type: 'string', required: true },
    provider: { type: 'string', enum: [...11 个] },
    model: { type: 'string' },
    aspect_ratio: { type: 'string', enum: [...] },
    image_size: { type: 'string', enum: ['1K','2K','4K'] },
    size: { type: 'string' },
    quality: { type: 'string' },
    workflow: { type: 'string' },
  },
  output: imageOutput('Generated'),   // { schema, render, presentationMeta }
  async execute(args, exec) { return generateSingle(args, exec) },
  presentResult: (_args, result) => imagePresentation(result),
}))
```

设计要点：
- **`description` 是给模型的行为契约**：明确"成功后图已附到会话，不要再 read/glob 找图"，直接消灭一类工具滥用；
- **`output.render` 返回内容块**：`[{type:'text'}, {type:'image', attachment}]`，模型看到文字 + 真图；
- **`output.presentationMeta`** 是给前端卡片的稳定结构（`kind: 'dsh-image-gen'` + attachment/provider/model/prompt/savedTo/seed），LLM 与 UI 解耦；
- **`generate_images` 是顺序批处理**：每项独立 try/catch，失败进 `failures[]` 不中断；最多 10 条；`signal.aborted` 时剩余项标记跳过；
- `edit_image` 的选择器字段互斥（`source_attachment_id(s)` / `source_path(s)` / `source=canvas_selection`），无选择器时回退到"最新一条带图消息"。

### 5.2 Provider 适配层：统一返回、差异隔离

```ts
export interface GeneratedImage {
  data: Uint8Array
  mediaType: ImageMediaType
}
```

| Provider | Wire 协议 | 关键差异 |
| --- | --- | --- |
| `google` | Interactions（默认）或 `generateContent`（native 开关） | 两套响应解析：`steps[].model_output.content[]` vs `candidates[].content.parts[].inlineData`；可换 `x-goog-api-key` |
| `openai` | `/images/generations`、`/images/edits`（multipart） | 尺寸需 `validateOfficialSize`（16 倍数、1:3~3:1、≤3840、像素区间） |
| `openai-compat` | generations + **5 种** edits 形态 | `multipart` / `jsonImageUrlArray` / `formReferenceImages` / `xaiJson` / `qwenJson`；`extraBody` 最后合并，专门伺候中转站的方言 |
| `seedream` | 复用 OpenAI 形状 + Ark 输出控制 | `response_format:'url'`、`output_format/watermark/background`；`transparent` 强制 png |
| `dashscope` | 通义原生 | 尺寸串用 `1024*1024` 乘法格式 |
| `xai` | 无 `size` 参数 | 只认 `aspect_ratio + resolution`，塞进 `extraBody` |
| `zhipu` | OpenAI 形状 | 推荐尺寸表 + `quality=hd` |
| `comfyui` | `/prompt` → 轮询 `/history/{id}` → `/view` | 导入 API-format workflow JSON，注入 prompt/seed/图片名；单次总超时；Abort 透传 |

所有适配器共享同一套**网络健壮性范式**（`fetch-diagnostics.ts` + `redact.ts`）：
- `redirect: 'error'`：禁止 30x 把请求带到别的主机（防 SSRF 绕过）；
- `readBoundedText/readBoundedBytes`：响应体有上限（错误 4KB、图片 `maxImageBytes`），不会把内存打爆；
- 错误信息统一 `redactSecrets(text, apiKey)`：避免把 Key 回显到聊天/日志；
- **媒体类型以字节嗅探为准**（magic number），声明头只作兜底 —— 因为中转站经常撒谎，host 会因 `IMAGE_TYPE_MISMATCH` 拒收；
- 所有请求都吃 `AbortSignal`，取消能穿透到 fetch 与轮询。

### 5.3 参考图解析：一个兼容边界模块

`reference-image.ts` 是唯一允许知道"DSH 会话如何暴露消息、附件如何嵌套"的模块：

- 无选择器：取 `agent.session.deriveMessages()` 中**最新一条带图消息**的所有图；
- 有 `source_attachment_id(s)`：按调用方顺序在会话里查找，缺一张就报错指名；
- 有 `source_path(s)`：限制在会话 `cwd` 内（`realpath` 后再校验），并做 `maxBytes` 上限；
- `source=canvas_selection`：由 `canvas-tools` 解析（生成的图取原图，手绘/贴图取选区截图）。

这样 Provider 层永远只看到 `{data, mediaType}`，DSH 版本升级只改这一个文件。

### 5.4 结果落盘与呈现：内容寻址 + 同源桥

1. 生成字节 → 先过 `attachments.imageLimits`（媒体类型/最大字节）；
2. `ctx.attachments.saveImage()` 存进**内容寻址**的附件库（`sha256:` ID，同字节自动去重）；
3. 可选写工作区（默认开）：
   - 文件名 `image-<digest前8位>.<ext>`，**同图重复保存幂等覆盖**；
   - 目录必须在 workspace 内：先词法校验 `..`/绝对路径，再 `realpath` 校验符号链接逃逸；
   - 先写同目录 staging 文件再 `rename`，崩溃不留半张图；取消信号连 rename 都拦截；
4. 浏览器拿到的是附件 ID，通过 `POST /plugins/dsh-image-gen/image` 换字节：
   - **仅 POST**、仅 JSON、**同源校验**（Origin vs Host）、`cache-control: private, no-store`、`nosniff`；
   - 附件读取失败统一 404，不泄露路径。

> 这是"Host 持有字节、浏览器只拿引用"的典型安全边界，也是它能同时支持桌面/Web/多会话的原因。

### 5.5 凭证与订阅：浏览器永远不碰 Token

- **BYOK**：`ctx.credentials.resolve(credentialRef('GOOGLE_API_KEY'))` 等；空串/纯空白视为未配置；设置卡通过 `remote.credentials.describe/set` 只显示"已配置/缺失"徽章；
- **订阅**（`chatgpt-sub` / `grok-sub` / `google-sub`）：
  - 授权码 + **PKCE S256**，`state` 绑定本次登录；
  - 临时 **loopback HTTP server**（厂商固定回调端口，10 分钟超时），只接受 `127.0.0.1/::1/::ffff:127.0.0.1` 的连接；
  - Token/refresh/email 打包成 blob 存进 **独立的 credentials ref**（`CODEX_OAUTH_1` 等），与 API Key 完全隔离；
  - 刷新用 per-vendor 锁避免并发刷新把 refresh token 打废；过期缓存只做徽章展示；
  - 生图在 Host 侧完成，浏览器只看到登录状态文案。
- 设置卡"测试连接"逐 provider 探测；订阅账号的测试只验证登录记录，真正验证要靠一次生图。

> 注意：订阅通道走的是厂商私有客户端协议，稳定性和合规性都不由插件控制；这是该插件最大的外部风险，也是它 README 里大量"入口/项目发现/UNSUPPORTED_CLIENT 回退"注释的来源。

### 5.6 浏览器 Bundle：插槽化 UI

```ts
export const inject = ['slots', 'connection', 'remote', 'locale']

export function apply(ctx: Context): void {
  // 设置卡：新 slot 'plugins.bundle.config'（按包名 key）+ 旧 slot 'settings.plugin.item'
  ctx.slots.inject('tool.call.toolview', () => register({ name: 'tool.call.toolview', key: 'generate_image', ... }, GeneratedImageCard))
  ctx.slots.inject('conversation.view', () => register({ name: 'conversation.view', id: 'gallery', ... }, GalleryViewTab))
  // 右栏 Studio：两阶段注册（先 sidebarRightTabs.register 类型，再 keyed slot 挂 body）
  // 输入框胶囊：'conversation.input.right'
  // 新结果节点：uiConversation.events.register(...) + 'conversation.chat.node'
}
```

- 每个插槽注册都返回 dispose，由 `ctx.effect` 统一回收；
- 设置读写做**两代 API 探测**（`configForms` vs `settingsScope`），都没有时用 `degradedScope`（读空、写失败、不抛错）保证卡片仍能挂载；
- 凭据服务用 **可变 holder + 委托代理**：先同步探测，后 `ctx.inject(['remote.credentials'])` 晚绑定，卡片不因服务晚到而崩溃；
- 样式以 `<style data-plugin>` 注入并在卸载时移除，所有类名带 `dsh-ig-` 前缀，避免污染宿主；
- 本地数据：画廊/收藏在浏览器 localStorage，画布在 tldraw + IndexedDB（含旧库清理），灵感图按需缓存。

### 5.7 画布镜像：浏览器拥有画布，Host 只留"摘要"

- 浏览器把 tldraw 状态**节流推送**到 `POST /canvas-state`：节点清单（≤48）、选区（≤16）、每张图的 attachment/prompt（≤120 字）、选区截图 dataURL、单调 `sequence`；
- Host 的 `CanvasMirror` 只存最新快照（**session-scratch，不落盘**）；
- 每轮请求通过 `systemPrompt.context()` 注入一小段 digest（画布上有什么、选了什么）；
- `view_canvas` 只在模型**真的要看图**时，才把选区截图物化成持久附件 —— 没人看的截图永不落盘；
- 上限在 client 裁剪、route 拒收两端对齐，避免"两端漂移"。

### 5.8 Studio 与多模型对比

- `GET studio` 返回**能力矩阵**：每家的比例/分辨率/质量选项、默认值、是否已配置、水印能力；
- `POST studio` 接收统一 intent（ratio/quality/size/references），在服务端归一成各家 wire 参数后并发生成；
- `openaiCompatSizes` 表把"比例 → 档位 → 像素"做成配置，**解析时只向下取整、绝不放大**，防止用户选 1K 却悄悄花 4K 的钱；
- 多模型对比默认只勾 2 个已配置模型（避免误触批量花钱），共享 intent 按各模型能力自动降级/调整，并标记 `adjusted`。

### 5.9 兼容层：这个插件最"重"的部分

代码里大量注释带 issue 号（#32/#41/#53/#55/#61），对应真实踩坑：
- 设置 API 两代（0.1.2~0.1.6 vs 0.1.7），静态 `inject` 任一名字都会在另一代 host 上**永久挂起 fiber** → 改为运行时 `ctx.get()` 探测；
- 右栏 tab 两阶段注册，旧 host 无此服务时静默不挂载；
- `uiConversation` 新版 promoted 结果节点 vs 旧版 toolview；
- 兼容"DSH 0.2.0-rc"的发布包测试；
- 错误信息保留每次尝试的脱敏响应，避免只看到最后一个 429。

---

## 6. 端到端时序（以对话文生图为例）

```
用户："画一只在雨里打伞的柴犬"
  │
  ▼ LLM 选择 generate_image(prompt=...)
Host tool.execute
  ├─ resolveProvider(config) → google profile
  ├─ requireApiKey(ctx,'google') → credentials 服务
  ├─ generateGoogleImage() → fetch Gemini → 字节 + 嗅探 mediaType + 限额校验
  ├─ attachments.saveImage() → sha256 附件 ID（去重）
  ├─ saveImageToWorkspace()（可选）→ <cwd>/dsh-image-gen/image-xxxxxxxx.png
  └─ 返回 { attachment, provider, model, output, savedTo }
        │ output.render → [text, image(attachment)]  → 模型上下文
        │ presentationMeta → kind=dsh-image-gen ...   → 前端卡片
        ▼
浏览器 GeneratedImageCard
  └─ POST /plugins/dsh-image-gen/image { attachment } → 二进制 → <img>
     （同源校验 + no-store + nosniff）
```

---

## 7. 安全与健壮性清单（可直接抄）

1. **凭证只进不出**：浏览器只能 `describe/set`，永不读回明文；OAuth blob 与 API Key 分 ref 存放。
2. **同源 + 方法 + Content-Type 三重校验**的附件读取路由；`POST` 而非 GET，避免被 `<img src>` 跨站引用。
3. **`redirect: 'error'`** + 限定 URL 构造，防 SSRF 重定向。
4. **有界读取**：错误体 4KB、历史响应 16MB、图片按 `maxImageBytes`。
5. **字节嗅探优先**的媒体类型判定。
6. **路径双重校验**（词法 + realpath）防目录穿越/符号链接逃逸。
7. **原子写** + 取消语义（abort 后绝不留下最终文件）。
8. **错误脱敏**（API Key 从响应文本中抹掉）。
9. **上限两端对齐**（画布节点数、选区数、prompt 长度），route 拒收超限。
10. **Abort 全链路**（fetch、轮询、落盘、批量剩余项）。

---

## 8. 工程化与质量

- `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`；
- 42 个 spec：provider wire 解析、config 迁移、settings 两代兼容、canvas 同步、packaging 安装验证、watermark、redact 等；
- `scripts/check-package.mjs`：真实 `npm pack` + 临时 home 安装 + 用已发布 DSH 服务跑装配，验证"发布产物"而不是"源码"；
- 双产物构建（Host ESM / Client CJS），client 只 external React 与少量 DSH 包；
- README 同时维护中英双份 + 大量 WebP 演示图（产品化程度高）。

---

## 9. 最值得借鉴的 8 个决策

1. **Host 管字节、浏览器管引用**：附件 ID + 同源路由，天然适配多会话/远程。
2. **一个 `{data, mediaType}` 收敛 10 种 wire**：Provider 只做协议翻译，不做业务。
3. **能力矩阵前置**：Studio/对比/工具参数都从 `capabilities` 派生，前端不硬编码厂商知识。
4. **每次调用可覆盖 provider/model**：默认配置只是默认值，LLM 可按用户要求临时切换。
5. **`output.render` 与 `presentationMeta` 分离**：模型看文字+图，UI 看结构化元数据。
6. **参考图解析收敛到单一兼容模块**：DSH 升级只改一处。
7. **实时设置（volatile）**：改配置不重启，体验接近原生应用。
8. **兼容层用"探测 + 降级"而非版本号判断**：旧/新 host 都能跑，避免硬门槛。

---

## 10. 移植到 GuaDa 的映射与建议

### 10.1 两套插件模型对照

| 维度 | DSH (Cordis) | GuaDa (NestJS PluginBase) |
| --- | --- | --- |
| 插件入口 | `export function apply(ctx, config)` | `PluginBase.onLoad(api)` + `manifest` |
| 依赖注入 | `inject` / `ctx.inject` / `ctx.get` | Nest DI 构造器注入（SettingsStorage、ProviderFileStore 等） |
| 工具 | `ctx.tools.register(defineTool(...))` | `api.registerToolKit` / `registerTool`（Zod） |
| 工具结果图片 | `output.render` 返回 `{type:'image', attachment}` | `ToolResultObject.images`（base64）或 **`imageRefs`（磁盘引用，引擎物化）** |
| 前端扩展 | `ctx.slots.register`（React） | `api.registerSlot` / `registerUiPage`（Vue，`frontend/dist/<component>.js`） |
| 前后端调用 | 同源 `webServer.register` 路由 | `api.registerRpc` 或 Nest Controller / 静态附件服务 |
| 设置 | schemastery + `settings.installSection` | `SettingsStorage` 分组（`GET/PUT /settings/:group`） |
| 凭证 | `ctx.credentials`（独立服务） | 无独立服务，现有做法是 settings 分组明文（如搜索 Key） |
| 附件 | `ctx.attachments`（内容寻址、`sha256:` ID） | 会话附件目录 + `imageRefs` 物化；无对外附件服务 API |
| 兼容策略 | 运行时探测 + degradedScope | 单体版本，无多宿主兼容负担 |

### 10.2 可直接复用的部分

- **wire 适配逻辑**（Apache-2.0，需保留版权声明）：`google.ts`、`openai-compatible.ts`、`seedream.ts`、`dashscope.ts`、`comfyui.ts` 的请求构造/响应解析/尺寸校验，基本可以平移成 GuaDa 的 `search-providers` 风格模块；
- **能力矩阵**：`capabilities.ts` 的比例/质量表与"只降不升"的尺寸解析；
- **安全范式**：`redirect:'error'`、有界读取、字节嗅探、错误脱敏、原子写、路径双重校验；
- **Prompt/工具描述**：`generate_image` / `edit_image` 的 description 与选择器设计。

### 10.3 不能直接复用的部分

- Cordis 的 `apply/inject/effect`、`ctx.slots`、`ctx.credentials`、`ctx.attachments`、`webServer` 全部要换成 GuaDa 对应机制；
- React 组件（设置卡、画廊、Studio、tldraw）要改写为 Vue；tldraw 有 Vue 绑定但版本/授权需评估；
- 订阅 OAuth（Codex/Grok/Antigravity）依赖厂商私有协议，移植需自行承担稳定性与合规风险。

### 10.4 建议的 GuaDa 落地路径

**P0（1~2 天，先跑通闭环）**
1. 新增插件 `image-gen`（`backend-ts/src/modules/plugins/builtins/image-gen.plugin.ts`）；
2. Provider 接口（对齐现有 `SearchProvider` 风格）：

```ts
export interface ImageProvider {
  readonly name: string;               // openai | google | dashscope | seedream | comfyui
  readonly displayName: string;
  readonly capabilities: ImageCapabilities;  // ratios/qualities/supportsEdit/...
  generate(input: GenerateInput, apiKey: string, signal: AbortSignal): Promise<GeneratedImage>;
  edit?(input: EditInput, apiKey: string, signal: AbortSignal): Promise<GeneratedImage>;
}
```

3. 工具：
   - `generate_image(prompt, size?, quality?, provider?)`：写临时文件 → 返回 `imageRefs:[{url, refType:'local', media_type, name}]`，引擎物化进会话 images 目录；
   - `edit_image(prompt, sourcePath | attachmentRef?)`：参考图直接读会话图片路径（GuaDa 的图片消息已有磁盘路径）；
4. 设置分组 `image-gen`：`{ provider, openai:{apiKey,baseURL,model}, google:{...}, ... }`，前端在 `SettingsPage` 加一个 Tab（参照 `SearchSettings.vue`）。
5. 验收：对话里一句话出图，消息里能看到图，`generate_image` 卡片显示 provider/model/尺寸。

**P1（3~5 天，体验补齐）**
- `generate_images` 批量（顺序 + failures）；
- 测试连接 RPC（`api.registerRpc`）+ 模型列表拉取；
- 画廊：直接扫描会话 `images/` 目录（无需 IndexedDB），支持复用为参考图；
- 输入框 Provider 胶囊：`api.registerSlot('chat.input.actions', ...)`（若前端尚未消费该 slot，需先在 ChatInput 挂一个 `<PluginSlot>`）。

**P2（按需）**
- Studio（Vue 表单 + 批量/对比）；
- 画布（tldraw Vue 或自研 SVG 画布）；
- 订阅通道（谨慎评估 ToS/封号风险）。

### 10.5 主要差距与注意事项

1. **凭证安全**：GuaDa 目前 Key 存在 settings 明文里（搜索 Key 就是如此）。若要做桌面端，建议后续接系统钥匙串；至少 UI 上不回显、日志脱敏。
2. **附件模型**：DSH 的 `sha256:` 内容寻址 + 同源路由很优雅；GuaDa 走 `imageRefs` 物化也能得到等价效果，但**去重/引用计数**要自己在落盘时处理。
3. **UI 插槽消费**：GuaDa 已有 `registerSlot` 与 `PluginSlot.vue`，但聊天区目前没有消费者；结果卡片可以先依赖"工具返回图片 → 消息文件块渲染"，后续再挂专用卡片。
4. **成本控制**：批量/对比默认关闭、单次张数上限、尺寸只降不升，这三条务必照抄。
5. **合规**：订阅通道（Codex/Grok/Google 账号）属于私有协议，商用产品不建议默认提供。

---

## 11. 关键文件地图

| 关注点 | 文件 |
| --- | --- |
| 插件入口 / 工具 / 编排 | `src/index.ts`（661 行） |
| 配置 schema / provider 解析 | `src/config.ts` |
| 能力矩阵 / 尺寸表 | `src/capabilities.ts` |
| Provider 适配 | `src/google.ts`、`openai-compatible.ts`、`seedream.ts`、`dashscope.ts`、`comfyui.ts` |
| 参考图解析 | `src/reference-image.ts` |
| 附件 HTTP 桥 | `src/image-route.ts`、`import-route.ts`、`canvas-asset-route.ts` |
| 工作区落盘 | `src/workspace-save.ts` |
| 凭证 / 订阅 | `src/credentials.ts`、`subscription/manager.ts`、`oauth.ts`、`loopback.ts`、`vendors/*` |
| Studio 编排 | `src/studio.ts`、`studio-route.ts` |
| 画布镜像 / 工具 | `src/canvas-state.ts`、`canvas-state-route.ts`、`canvas-tools.ts` |
| 网络健壮性 | `src/fetch-diagnostics.ts`、`redact.ts` |
| 浏览器 Bundle | `src/client/index.tsx`（2725 行）、`studio-view.tsx`、`gallery-view.tsx`、`tl/*` |
| 打包/验证 | `tsdown.config.ts`、`scripts/check-package.mjs`、`tests/*` |

---

## 12. 结论

dsh-image-gen 的核心价值不在"生图"，而在它把 **Agent 工具、Provider 适配、凭证隔离、附件安全、UI 插槽、兼容降级** 六个问题用一套一致的边界解决了：

- 模型只拿到"文字 + 图片引用"，不接触密钥与文件系统；
- 浏览器只拿到"附件 ID + 能力矩阵"，不接触厂商协议；
- 每个外部差异（wire 方言、尺寸约束、响应格式）都被收敛在 Provider 层；
- 每个宿主差异（设置 API、侧栏、关联节点）都被收敛在"探测 + 降级"里。

对 GuaDa 来说，最划算的做法是：**照抄它的 Provider 层与安全范式，用 GuaDa 的工具/附件/设置机制重写装配层，跳过订阅与画布，先做"对话生图 + 参考图编辑 + 会话图库"这条主线。**
