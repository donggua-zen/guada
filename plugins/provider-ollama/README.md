# 示例供应商包（代码型）：Ollama 原生协议

演示如何通过插件贡献一个**非 OpenAI 兼容**的 wire 协议：

- `index.js`：`onLoad(api)` 中 `api.registerProtocolAdapter()` 注册 `ollama-native`；
  实现 `/api/chat` 流式、`/api/tags` 模型发现、`/api/embed` embedding；
- `types/ollama.yaml`：类型卡（由 `manifest.provides.providerTypes` 自动注入）；
- `assets/logo.svg`：模板图标。

## 试装

```bash
# 在应用「插件 → 安装插件」输入（路径相对后端进程 cwd，开发时即 backend-ts/）：
local:../plugins/provider-ollama
```

安装后：

1. 插件页确认 **Ollama 供应商** 已启用；
2. 「设置 → 模型供应商 → 可添加的供应商」点击 **Ollama**；
3. `API 地址` 填 `http://localhost:11434`（本机 Ollama 默认端口），API Key 留空或填任意值；
4. 点击「测试」应看到模型数量；也可用「添加自定义」选择 `Ollama (native)` 协议。

## 适配器契约

该文件是 `IProtocolAdapter` 的最小参考实现：

- 只有 `protocol` + `chatCompletion()` 必选；
- 流式顺序：`block_start → *_delta → block_end → usage → finish`；
- `usage` 必须先于 `finish`，`finish` 后不得再发 chunk；
- 必须把 `params.abortSignal` 传给 fetch；
- 工具参数保持原始 JSON 字符串。

完整说明见 [`docs/provider-packs.md`](../../docs/provider-packs.md)。
