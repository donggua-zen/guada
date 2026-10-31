# 示例供应商包（声明式）

演示如何用「零后端代码」的方式接入一个 OpenAI 兼容供应商：

- `manifest.json`：`providerApi: 1` + `provides.providerTypes`
- `types/acme.yaml`：类型卡（协议、默认地址、模型目录、思考能力）
- `assets/logo.svg`：模板图标

## 试装

```bash
# 在应用「插件 → 安装插件」输入（路径相对后端进程 cwd，开发时即 backend-ts/）：
local:../plugins/provider-pack-example
```

安装后到「设置 → 模型供应商 → 可添加的供应商」点击 **Acme AI**，
填入任意 apiKey 即可创建实例（示例地址不会真实连通，仅用于验证流程）。

## 改造为真实供应商

1. 把 `types/acme.yaml` 的 `type` 改成你的品牌键（不能与 `bundled-providers/` 重名）；
2. 修改 `name` / `defaultApiUrl` / `models`；
3. 如思考参数有方言，用 `compat.thinkingFormat` 或 `thinkingPatchExpr` 表达；
4. 替换 `assets/logo.svg`；
5. 重新打包安装即可。

完整 schema 见 [`docs/provider-packs.md`](../../docs/provider-packs.md)。
