# OCR 供应商插件化可行性评估

> 结合本项目现有插件体系，评估「OCR 供应商是否可以像模型/搜索供应商一样插件化」。
> 调研日期：2026-11-18
> 关联：`docs/deepseek-ocr-integration-plan.md`（DeepSeek OCR 硬编码接入，已实施）

---

## 一、结论先行

**技术上可行，但不建议现在做「完全插件化」。**

- 项目插件体系里**已有一套成熟的「供应商包」范式**（LLM Provider Pack：`ProviderContributionCoordinator` + `AdapterRegistry` + `registerProviderType/registerProtocolAdapter`），它是「插件贡献一个供核心服务直接调用的实现」的现成骨架——这正是 OCR 插件化需要的机制类型。
- 但**这套机制绑定了 LLM 聊天协议语义**（`IProtocolAdapter.chatCompletion()`），与 OCR 的独立识别接口（`POST /v1/tools/ocr`，multipart，返回 `pages[].text`）语义不同，**无法直接复用，必须新建一套 OCR 专属扩展点**。
- 更关键的是**收益/成本不匹配**：OCR 供应商是「小而稳」的集合（目前 umi / baidu / deepseek 三家），不像 LLM 供应商那样需要频繁接入几十家、且要终端用户自行投喂第三方包。为它新建一整套「贡献协调器 + 注册表 + manifest 协议 + 外部加载 + 安全边界 + 动态设置 UI」，工程量远超其收益。

**推荐路线：先做「接口抽象 + 内置注册表」的中间态（路线 B），把 OCR 从硬编码 `if/else` 解耦为可插拔 adapter；把「外部插件热加载」作为按需启用的后续阶段（路线 C）。** 这样既拿到插件化的主要工程收益（新增供应商不动核心逻辑、可独立测试、可替换），又不背负一整套外部供应商包基础设施。

---

## 二、现状：OCR 是「核心服务内的硬编码多供应商」

`OcrService` 是被 `FileParserService` 构造注入的 **NestJS 单例服务**（`knowledge-base.module.ts:38` 注册、`file-parser.service.ts:39` 注入），走的是**同步、进程内、核心调用链**，不是工具调用路径：

```
PDF/图片上传 → KbFileService → FileParserService.parseFile
      → OcrService（按 capabilities 分派）
            ├─ provider === "umi"      → recognizeImageWithUmi / recognizePdfWithUmi
            ├─ provider === "baidu"    → recognizeImageWithBaidu
            └─ provider === "deepseek" → recognizeImageWithDeepSeek
```

分派点全是硬编码 `if/else`（`ocr.service.ts:174-187`、`:287-307`、`:196-238`），供应商类型写死在联合类型里：

```ts
provider: "umi" | "baidu" | "deepseek" | "none";
```

每加一家供应商要改：`OcrConfig` 类型 + `getCapabilities` + `recognizeImageBuffer` 分支 + 一个新的私有识别方法 + 前端设置 UI + 文案。这与**搜索供应商模式完全同构**（即「编译期插拔」，非运行期插件化）。

---

## 三、插件体系能力盘点：三种「供应商」范式

| 范式 | 供应商是否独立插件 | 运行期切换 | 外部安装 | 新增一家改核心代码 | 消费路径 |
| --- | --- | --- | --- | --- | --- |
| ① 搜索供应商（`SearchProvider`） | 否，一个插件内 N 个实现 | 否（onLoad 选一次） | 否 | **要**（多处） | 插件内工具调用 |
| ② LLM Provider Pack | **是**，独立供应商包 | 是（setActive） | **是**（外部目录热加载） | **不要**（丢目录即可） | 核心服务直接调用（`LLMService.getAdapter`） |
| ③ 命令提供者（`CommandProviderRegistry`） | 半独立，轻量 registry | 否 | 否 | 要改插件代码 | 后端直接执行 |

### 3.1 关键发现：只有范式②是真正的「插件化供应商」

`ProviderContributionCoordinator` 的类注释自觉定位为「**插件生命周期与 llm-core 注册表之间的唯一桥**」，其链路完整覆盖了插件化所需的一切：

```
插件 onLoad → api.registerProtocolAdapter() / registerProviderType() 缓冲贡献
   → PluginManager flush 后 commitProviderContributions()
   → Coordinator 原子提交（先 validate 冲突 → remove 旧 → register 新，失败 rollback）
   → AdapterRegistry（Map<protocol, {adapter, source, pluginId, active}>）
   → BundledCatalogService（类型卡目录）
   → LLMService 按 protocol 取 adapter；区分「未注册」/「已禁用」两类错误
   → 插件禁用 setActive / 卸载 remove 联动
```

内建协议是保留位、插件不得覆盖（防密钥劫持），插件间重名拒绝，有 `providerApi` 版本校验和 `realpath` 路径穿越防护。**这套东西就是为「第三方供应商包」设计的。**

### 3.2 范式①不是插件化，但它有一个对 OCR 极重要的设计

`SearchProvider` 接口把 API Key 作为**方法参数**传入：

```ts
search(q: string, options: SearchOptions, apiKey: string): Promise<SearchResponse>;
```

Key 的解析（含「复用模型服务 Key」）留在宿主插件 `resolveApiKey` / `findModelProviderKey` 里，provider 实现只管拿着 Key 发请求。**这个设计恰好绕开了「外部插件没有 Nest DI、拿不到 ProviderFileStore」的限制**——即使 OCR 做成外部插件，"复用模型 Key"仍可由宿主解析后传参，插件不需要自己读模型配置。这是 OCR 插件化可行性的关键支撑点。

---

## 四、三个关键约束（决定插件化不能照搬）

### 约束 1：OCR 是「同步核心调用」，不是「工具调用」

LLM/搜索供应商最终都服务于「模型工具调用」或「用户配置的模型入口」，天然是插件域。而 OCR 被 `FileParserService` 在文件上传 pipeline 中同步 `await`，是知识库核心链路。插件化意味着核心链路要依赖一个「可从外部加载、可禁用、可热重载」的注册表——**核心链路的稳定性从此与插件状态耦合**：插件被禁用/加载失败时，`FileParserService` 必须优雅降级（回退到仅用文本层或报错），这需要在 `OcrService` 里显式处理「未注册 / 已禁用」两类错误（可借鉴 `LLMService` 的 `UnsupportedProtocolError` / `ProtocolDisabledError`）。

### 约束 2：外部插件无 Nest DI，也拿不到原始 Key

外部插件由 `new PluginClass()` 实例化（`external-plugin-loader.ts:224`），`PluginApi` 只暴露 `complete/completeStream/listModels` 和数据读写，**不暴露任何服务的原始 apiKey**。所以：
- 外部 OCR 插件**不能**自己实现「复用模型 Key」；
- 必须由宿主 `OcrService`（保留 Nest DI）解析 Key 后，作为参数传给 adapter（照搬 `SearchProvider` 设计）。

### 约束 3：现有贡献机制绑定 LLM 协议语义

`IProtocolAdapter` 必选方法是 `chatCompletion()`，返回聊天流块（`block_start → *_delta → usage → finish`）。OCR 是「上传文件 → 按页返回文本」，强行包装成 `chatCompletion` 会让识别伪装成对话，且无法融入 `recognizeImageBuffer` / `recognizePdfPages` 的 `pdfMode: native|render` 渲染编排。必须新建独立的 `IOcrAdapter` 契约。

---

## 五、三条路线对比

| | 路线 A：维持硬编码（现状） | 路线 B：接口抽象 + 内置注册表 | 路线 C：完全插件化（外部包） |
| --- | --- | --- | --- |
| 做法 | 继续在 `OcrService` 加 `if/else` 分支 | 抽 `IOcrAdapter` + `OcrAdapterRegistry`，内置三家走 `registerBuiltin`，`OcrService` 改为按 key 查表分派 | 在 B 基础上加 `registerOcrAdapter` API、manifest `provides.ocrAdapters`、Coordinator、外部加载器、动态设置 UI |
| 新增一家供应商 | 改核心代码 + 发版 | 改核心代码（但只加一个 adapter 文件 + 一行注册） | **投一个插件目录，零核心改动** |
| 外部/第三方扩展 | 不支持 | 不支持 | 支持 |
| 运行期启停/热重载 | 无 | 无 | 有 |
| Key 复用 | 已实现（宿主内） | 已实现（宿主解析后传参，同搜索） | 宿主解析后传参（不受外部插件无 DI 影响） |
| 工程量 | 0（已做） | 中（1~2 天） | 大（5~10 天，含协议/安全/UI） |
| 风险 | 低 | 低 | 中高（核心上传链路依赖外部代码/插件状态） |

---

## 六、推荐方案：路线 B（可插拔 adapter，内置注册表）

### 6.1 目标

把 OCR 从「硬编码分支」重构为「按 key 查注册表」，为未来插件化**预留干净的接口边界**，但暂不引入外部加载与安全机制。收益立即可得，成本可控，且不破坏现有功能。

### 6.2 新增 `IOcrAdapter` 契约

接口形状取 `SearchProvider` 与 `OcrCapabilities` 的优点，**不含 Nest DI 依赖**（为将来外部插件 new 出来留门）：

```ts
export interface OcrAdapterCapabilities {
  supportsPdf: boolean;
  supportsImage: boolean;
  pdfMode: "native" | "render";
}

export interface OcrRecognizeOptions {
  apiKey?: string;          // 宿主解析后传入（Key 复用保持在宿主侧）
  useProviderKey?: boolean;
}

export interface IOcrAdapter {
  readonly name: string;           // "umi" | "baidu" | "deepseek" | ...
  readonly displayName: string;
  readonly capabilities: OcrAdapterCapabilities;
  /** 识别单张图片（buffer），返回纯文本 */
  recognizeImage(
    buffer: Buffer, mimeType: string | undefined, hintName: string,
    options: OcrRecognizeOptions,
  ): Promise<string>;
  /** render 型：识别渲染后的单页图片；native 型可选实现整 PDF */
  recognizePdf?(
    filePath: string, pages: number[], onProgress?: FileProgressCallback,
    options?: OcrRecognizeOptions,
  ): Promise<Array<{ page: number; text: string }>>;
}
```

### 6.3 新增 `OcrAdapterRegistry`（轻量版）

借鉴 `CommandProviderRegistry` 的简洁 + `AdapterRegistry` 的 entry 结构，但**不引入 active/冲突/版本**（这些是路线 C 才需要）：

```ts
@Injectable()
export class OcrAdapterRegistry {
  private adapters = new Map<string, IOcrAdapter>();
  registerBuiltin(adapter: IOcrAdapter): void { /* name 非空 + 不重复 */ }
  get(name: string): IOcrAdapter | undefined { ... }
  list(): Array<{ name: string; displayName: string; capabilities: ... }> { ... }
}
```

三家内置供应商各自重构为实现 `IOcrAdapter` 的类（`UmiOcrAdapter` / `BaiduOcrAdapter` / `DeepSeekOcrAdapter`），在 `KnowledgeBaseModule`（或 `OcrModule`）里 `registerBuiltin`。DeepSeek 的 `<｜ref｜>/<｜box｜>` 清洗、换行保活解析、Key 复用解析都收敛进 `DeepSeekOcrAdapter`。

### 6.4 `OcrService` 瘦身为「编排器」

```
getCapabilities()        → registry.get(current).capabilities
recognizeImageBuffer()   → 解析 Key → adapter.recognizeImage(buffer, ..., { apiKey })
recognizePdf / recognizePdfPages → 按 pdfMode 编排（渲染/原生），调用 adapter
```

`pdfMode` 的渲染编排、`onProgress` 映射、扫描页混合路由留在 `OcrService`（这是宿主能力，不属于任何 adapter）。Key 复用（`resolveDeepSeekKey`）可留宿主，也可下沉到 adapter 内并注入 `ProviderFileStore`——两种都行，但**推荐留宿主 + 参数传入**，与搜索一致且为路线 C 铺路。

### 6.5 收益

- 新增一家 OCR 供应商 = 新增一个实现 `IOcrAdapter` 的文件 + 一行 `registerBuiltin`，**核心编排逻辑零改动**；
- 每个供应商可独立单测（`ocr.service.spec.ts` 的 20 个用例可按 adapter 拆分）；
- 接口边界干净——将来要开路线 C，只需给注册表加 `active`/`source`/`pluginId` 并接上 Coordinator，`IOcrAdapter` 契约本身不用改。

---

## 七、若坚持路线 C（完全插件化）的完整清单

1. **类型**：`types/ocr-plugin.types.ts` — `IOcrAdapter`、`OcrAdapterContribution`、`PluginOcrManifestFields`（`provides.ocrAdapters`）。
2. **API**：`plugin-api.ts` 加 `registerOcrAdapter(def)`（缓冲 + 强校验：name 非空、方法存在、不重复），`getOcrContributions()` 供 Manager 取走。
3. **注册表**：`OcrAdapterRegistry` — `Map<name, {adapter, source, pluginId, active}>`；内建 `umi/baidu/deepseek` 走 `registerBuiltin` 且为保留位（防伪装官方 OCR）；`getEntry` 区分未注册/已禁用。
4. **协调器**：`OcrContributionCoordinator` — 照搬 `provider-contribution.coordinator.ts` 的原子提交（validate → remove → register，失败 rollback）+ `setActive` + `remove`。
5. **生命周期联动**：`plugin.manager.ts` 的 `registerPlugin` / `unregisterPlugin` / `setPluginEnabled` 三处挂接 `commit` / `remove` / `setActive`。
6. **外部加载器**：`external-plugin-loader.ts` 解析 `provides.ocrAdapters` 代码入口、动态 require、`providerApi` 版本校验、路径穿越防护；外部包不得自封 `system/essential`。
7. **核心消费**：`OcrService` 改为 `registry.getEntry(provider)` → 未注册/已禁用两类错误 → `adapter.recognize...`；禁用态优雅降级（回退文本层或可读报错）。
8. **设置 UI**：`OcrSettings.vue` 的供应商下拉从静态 `<GdOption>` 改为从 `GET /ocr/adapters` 动态渲染；每个 adapter 的配置项（Key / host / port）需用 `configSchema` 描述并动态生成表单——**这是路线 C 最容易被低估的一块工作量**。
9. **Key 策略**：宿主解析模型 Key → `recognizeImage(..., { apiKey })` 传参；外部插件不直接接触 `ProviderFileStore`。
10. **安全**：插件代码在后端主进程执行、无沙箱（与供应商包同模型），需在文档明确「安装第三方 OCR 包 = 授予本机代码执行权限」，并提示文件数据会流经第三方代码。

---

## 八、风险与建议

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| 核心链路耦合插件状态 | 上传 pipeline 同步依赖 OCR，插件禁用/加载失败会影响知识库入库 | `OcrService` 必须显式处理「未注册/已禁用」，优雅降级并给可读提示 |
| 设置 UI 动态化成本 | 不同 OCR 供应商配置项不同（host/port vs apiKey/secretKey） | 需引入 `configSchema` 驱动表单；路线 B 阶段可暂不做 |
| Key 复用边界 | 外部插件无 DI，拿不到模型 Key | 宿主解析后传参（SearchProvider 范式），写入契约 |
| 安全边界 | 外部插件无沙箱，文件与 Key 流经第三方代码 | 沿用供应商包的信任模型 + 明确文档警示 |
| ROI | OCR 供应商数量少、变化慢 | **这是不建议现在上路线 C 的核心原因**——基础设施成本远大于收益 |

**一句话建议**：先把 OCR 重构成「接口 + 内置注册表」（路线 B，1~2 天，风险低），把插件化需要的所有接口边界一次性留好；等真的出现「第三方 OCR 供应商包」需求时，再按第七节清单开路线 C，届时 `IOcrAdapter` 契约与 `OcrService` 编排层都不用推倒重来。
