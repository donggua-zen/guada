# Guada Relay 供应商包

自家中转站（llm_proxy）的供应商类型卡。**声明式包，无后端代码**：

- 协议复用内置 `openai` 适配器（完整支持图片 base64、工具调用、thinking）；
- 宿主通用传输能力 `requestCompression: true`：请求体为 JSON 且 ≥64KB 时
  gzip 压缩后发送（`Content-Encoding: gzip`），线上字节约省一半；
- 只对声明了该字段的供应商生效——官方 API 等其他上游永远明文。

## 安装

插件页 → 安装插件：

```
local:../plugins/provider-guada-relay
```

安装后「设置 → 模型供应商 → 可添加的供应商」出现 Guada Relay 模板，
添加实例时填中转站 API Key 即可（默认地址 `https://easyapi.dingd.cn/v1`）。

## 行为说明

| 场景 | 行为 |
|---|---|
| 请求体 < 64KB | 明文发送（不值得压缩） |
| 请求体 ≥ 64KB | gzip 压缩（level 1）+ `Content-Encoding: gzip` |
| 上游拒绝该编码（415 / 400 提示编码） | 自动明文重发一次，该地址后续不再尝试压缩 |
| 实例 YAML 写 `requestCompression: false` | 单独关闭该实例的压缩 |

## 前置条件

网关侧需支持 gzip 请求体解压（llm_proxy 2026-10-31 起已支持，见
`DEPLOY_NAS.md`「已知坑 18」），并在响应头广播 `X-Request-Compression: gzip`。
