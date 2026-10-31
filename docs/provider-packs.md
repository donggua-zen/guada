# 供应商包（Provider Pack）

供应商包是插件体系的一种贡献类型：用现有插件安装/启停/卸载机制，把「供应商类型卡」和/或「wire 协议适配器」带入运行时不改应用代码。

## 两种形态

| 形态 | 适用场景 | 是否执行代码 | 需要 `main` |
|------|----------|--------------|-------------|
| 声明式包 | 接入 OpenAI / Anthropic / Gemini / Responses 同协议的新品牌 | 否 | 否 |
| 代码包 | 新 wire 协议、自定义认证、自定义模型发现 | 是（同进程全权限） | 是 |

同协议的新供应商优先用声明式包：只需 YAML，无供应链/沙箱风险，安装即可用。

## 目录结构

```
provider-pack/
├── manifest.json
├── types/
│   ├── acme.yaml            # 声明式类型卡（可多个）
│   └── acme-eu.yaml
├── index.js                 # 代码包入口（声明式包可省略）
├── assets/
│   └── logo.svg
└── lang/
    └── zh.json              # 可选：插件 NLS 语言包
```

## manifest.json

```json
{
  "id": "provider-acme",
  "name": "Acme AI",
  "version": "1.0.0",
  "description": "Acme（OpenAI 兼容）",
  "category": "user",
  "providerApi": 1,
  "icon": "assets/logo.svg",
  "provides": {
    "providerTypes": ["types/*.yaml"],
    "providerAdapters": "index.js",
    "assets": "assets"
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `providerApi` | 供应商包必填 | 契约版本，当前为 `1`；高于宿主支持的版本会拒绝安装 |
| `provides.providerTypes` | 二选一 | 相对插件根的 YAML/JSON 路径，支持 glob；越界路径会被拒绝 |
| `provides.providerAdapters` | 二选一 | 代码入口；缺省用 `main` |
| `provides.assets` | 否 | 资源目录，默认 `assets` |

没有 `provides` 的普通插件保持原有约定（必须有 `main`）。

## 类型卡（YAML）

schema 与 `backend-ts/bundled-providers/*.yaml` 完全一致，权威说明见
[`backend-ts/bundled-providers/README.md`](../backend-ts/bundled-providers/README.md)。

最小示例：

```yaml
type: acme
name: Acme AI
description: Acme（OpenAI 兼容）
protocol: openai              # 必须指向已注册协议
defaultApiUrl: https://api.acme.example/v1/
avatarUrl: assets/logo.svg    # 相对插件根
models:
  - modelName: acme-chat-pro
    name: Acme Chat Pro
    supportsThinking: true
    thinkingEfforts: [none, low, medium, high]
    modelType: text
    config:
      inputCapabilities: [text, image]
      outputCapabilities: [text]
      features: [tools, vision]
      contextWindow: 128000
      maxOutputTokens: 8192
```

关键约束：

- `type` 是全局唯一键；**内置 `bundled-providers` 的 type 是保留位**，插件不得覆盖（防止伪装官方模板）。
- `protocol` 必须已注册；内置协议可直接使用，插件协议由代码包注册。
- 模型条目建议显式声明 `supportsThinking`（缺省按「不能思考」处理）。
- 思考差异优先用数据表达：`compat.thinkingFormat`、`thinkingEffortsMap`、
  `thinkingEffortsPatch`、`thinkingPatchExpr`（CEL）。只有这些表达不了时才需要代码适配器。

## 代码包

```js
// index.js（CommonJS；loader 也支持 default/命名导出的 class）
class AcmePlugin {
  constructor() {
    this.manifest = {
      id: 'provider-acme',
      name: 'Acme',
      version: '1.0.0',
      description: '...',
      category: 'user',
      providerApi: 1,
    };
  }

  async onLoad(api) {
    api.registerProtocolAdapter({
      protocol: 'acme-wire',
      displayName: 'Acme Wire',
      adapter: new AcmeAdapter(),
    });
    // 也可以在此调用 api.registerProviderType({...}) 内联注册类型卡
  }
}

module.exports = AcmePlugin;
```

### 适配器契约

> 类型卡二选一：用 `manifest.provides.providerTypes` 声明 YAML，或在 `onLoad` 内调用
> `api.registerProviderType()`。不要对同一个 `type` 同时使用两种方式（会被视为重复注册并拒绝）。

只有 `protocol` + `chatCompletion()` 必选：

```ts
interface IProtocolAdapter {
  readonly protocol: string;
  readonly displayName?: string;
  readonly capabilities?: ProtocolCapabilities;
  chatCompletion(params): AsyncGenerator<StreamChunk> | Promise<StreamChunk[]>;
  testConnection?(config): Promise<ConnectionTestResult>;
  syncRemoteModels?(config): Promise<RemoteModel[]>;
  embeddings?(params): Promise<EmbeddingResult>;
  prepareCall?(params): Promise<PreparedAdapterCall>;
}
```

流式义务（必须遵守）：

1. 块生命周期：`block_start` → `text_delta` / `reasoning_delta` / `tool_call_delta` → `block_end`（携带权威块）。
2. `usage` 必须在 `finish` 之前；`finish` 之后不得再产生 chunk。
3. `finish` 是终端事件：成功用 `stop` / `tool_calls` 等；失败可 throw，或用 in-band `finishReason: 'error' | 'aborted'`。
4. `argumentsDelta` / `arguments` 保持原始 JSON 字符串（工具参数不要提前对象化）。
5. 必须把 `params.abortSignal` 传给 fetch/SDK。

完整参考实现：`plugins/provider-ollama/index.js`（Ollama 原生 `/api/chat`，含工具调用、thinking、embedding、模型发现）。

## 生命周期与可见性

| 事件 | 行为 |
|------|------|
| 安装/启用 | 类型卡出现在「设置 → 模型供应商 → 可添加的供应商」；协议出现在协议下拉 |
| 禁用 | 类型卡与协议从可用列表消失；已有实例文件保留。使用内置协议的实例仍可工作，使用插件协议的请求报 `PROTOCOL_DISABLED` |
| 卸载 | 同上，定义从注册表移除；`providers/<id>.yaml` 不会被删除 |
| 重载 | 先校验新贡献，再原子替换；校验失败保留上一版 |

## 安全与信任

- 供应商包与普通插件一样在**后端主进程内执行**，没有沙箱。安装第三方代码包等价于授予其本机代码执行权限。
- 协议名与内置 type 是保留位，插件覆盖会被拒绝（避免劫持 `openai` 等协议把用户密钥发往其他地址）。
- 外部包不能自封 `system`/`essential`；trust 由 loader 按目录来源注入。
- 声明式包不执行代码，是第三方接入的推荐形态。

## 安装

复用插件安装入口（插件页 → 安装插件）：

```
# 路径相对后端进程 cwd（开发时通常是 backend-ts/，故项目根 plugins/ 用 ../plugins）
local:../plugins/provider-pack-example
github:owner/repo#ref
gitee:owner/repo
git:https://example.com/repo.git#ref
```

安装后：

- 声明式包：直接到「设置 → 模型供应商」点击对应模板添加实例。
- 代码包：先在插件页确认已启用，再添加实例并选择新协议。

## 测试建议

- 数据包：安装 → 模板出现 → 创建实例 → 连接测试/对话 → 禁用插件后模板消失、实例保留。
- 代码包：安装 → 协议下拉出现 → `custom` 实例选择该协议 → 流式对话 → 禁用后新请求报 `PROTOCOL_DISABLED` → 重载恢复。
- 适配器可用 `backend-ts/test/llm-core/provider-adapter-contract.spec.ts` 的契约测试作为参考。
