# 供应商配置目录（providers/）

本目录是**模型供应商与模型的唯一权威配置**（供应商就是数据）。每个 YAML 文件
是一个供应商实例，AI 助手与用户都可直接读写本目录，后端监听文件变化热加载。

## 文件命名

- 文件名（去 `.yaml`）= **实例 id**，同时是模型 id 的前缀：`{实例id}:{模型名}`（如 `openai:gpt-4o`）。
- id 一旦被会话/角色/知识库引用就不可改名（改名=删除旧文件+新建，旧引用失效）。

## 字段说明

```yaml
id: openai            # = 文件名；不可与目录内其他实例重复
type: openai          # 类型键（决定协议默认值与展示信息）；同类型可建多个实例
name: OpenAI          # 显示名
enabled: true         # 启用/禁用（false = 不进入模型选择器，调用直接报错）
protocol: openai      # wire 协议：openai | openai-response | anthropic | gemini | mock
apiUrl: https://api.openai.com/v1/
apiKey: sk-xxx        # 明文（与旧 DB 存储同级）；请勿提交到版本库
headers:              # 可选，附加请求头
  X-Custom: value
thinking:             # 可选，思考（reasoning）声明
  style: thinking-toggle   # wire 拼法，见下表；缺省用协议默认（类型卡只声明拼法，
                           # 不提供档位兜底——能力必须逐模型声明）
models:               # 可选；缺省时回退类型内置目录
  - modelName: deepseek-v4-pro
    modelType: text           # text | embedding | image
    name: DeepSeek V4 Pro     # 可选显示名
    config:                   # 可选能力参数
      contextWindow: 1000000
      maxOutputTokens: 384000
      features: [tools]
      inputCapabilities: [text]
    thinkingEfforts: [none, high, max]  # 该模型档位菜单；false=不能思考；**未声明 = 不能思考**
    thinking: { style: reasoning-effort }  # 可选，模型级拼法覆盖（同供应商不同模型不同参数时用）
    isFavorite: false
    isActive: true    # false = 从选择器隐藏但保留配置
```

> **能力 = 档位声明（对齐 DSH）**：一个模型能不能思考，由它声明的档位唯一表达。
> 空菜单 / 未声明即不能思考——不发思考参数、不回传推理内容、UI 不显示档位控件。
> 实例文件也可以在 provider 级写 `thinking.defaultEfforts`（显式声明，供整组
> 未单独声明的模型继承）；类型卡**不再**预置这种兜底，避免任意模型白得档位。
> 档位声明链：模型条目 > 实例 provider 级 > preset 目录（按模型名的内置目录）。
> `catalog-lint.spec.ts` 会拦截漏声明的条目。

## thinking.style（wire 拼法）

style 只表达**供应商方言**（三种）；报文信封（chat completions vs responses）
由实例的 `protocol` 决定——声明 `thinking-toggle` 的实例在 Responses 协议下
自动升级为 `reasoning.effort` + `thinking:{type}` 拼法，无需单独声明。

| style | wire 行为 | 典型供应商 |
|---|---|---|
| `reasoning-effort`（协议默认） | 档位直传 `reasoning_effort`；`none` → `thinking:{type:disabled}` | OpenAI、Azure、智谱、自定义网关 |
| `thinking-toggle` | `none`/`on` → `thinking:{type:disabled/enabled}`；强度 → `reasoning_effort` | DeepSeek、火山引擎（Responses 协议自动升级） |
| `enable-thinking` | `enable_thinking: 档位≠none` | 百炼、Moonshot、百度千帆、硅基流动 |

> 历史遗留：曾存在 `thinking-toggle-response`（Responses 变体）与
> `reasoning-split`（MiniMax 自家 `reasoning_split` 参数）两种拼法。前者语义与
> `thinking-toggle` 在 Responses 侧完全一致，后者随 MiniMax 切到 Anthropic 兼容
> 端点（`api.minimax.io/anthropic`，对齐 DSH/pi-ai）而废弃。均已删除——旧文件
> 若含这些值按未知风格处理，回退协议默认。

档位中立词表：`none | minimal | low | medium | high | xhigh | max`
（`off` 为兼容别名，加载时归一为 `none`；`on` 为存量兼容档位，新配置请勿使用。）

## thinkingEffortsMap（显示与 wire 值解耦）

前端菜单永远只显示中立档位；本表决定**实际发给网关的字符串**（对齐 DSH
thinkingLevelMap）。声明在模型条目上，目录卡与实例条目均可写；实例 map 整体
覆盖目录 map。

```yaml
models:
  - modelName: acme-think
    thinkingEffortsMap:
      none: null          # 不支持关闭 → 菜单不显示 none
      low: low
      medium: high        # 钳制：本模型无 medium 档，选 medium 时发 "high"
      high: high
      max: ultra          # 网关自定义词汇
      # minimal / xhigh 键缺失 → 菜单不提供
```

- 值 = 非空字符串：该档可选，wire 写该字符串
- 值 = `null` 或键缺失：该档不支持（菜单隐藏）
- 键名仅规范档位；`off` 归一为 `none`，`on` 不允许
- **开关态（none/on）的 wire 行为仍由 thinking.style 决定**（如
  `thinking:{type:disabled}`、`enable_thinking:false`）；map 的字符串值只对
  非 none/on 档生效
- `enable-thinking`（布尔承载）忽略 map 的字符串值，map 只影响菜单
- 与 `thinkingEfforts` 数组的关系：`false` > `map` > 数组；三者并存时高优先者
  生效并告警。数组是「wire 值=档位名」的缩写

## 常见操作

- **换 API Key**：改 `apiKey` 字段保存即可（热加载，无需重启）。
- **临时停用**：`enabled: false`（比删除好——保留配置与引用）。
- **同一供应商开两个账号**：复制文件、改 `id` 文件名与 `apiKey`。
- **接入 one-api/new-api 网关**：`type: custom` + 任选 `protocol: openai`，
  `models` 留空时按模型名自动匹配内置预设参数；也可显式声明 `thinkingEfforts`。
- **实例零复制**：新建实例的 `models` 留空即完整继承 bundled 类型目录，目录随
  应用升级自动生效；只写需要覆盖/禁用/删除的条目（`isActive: false` 禁用、
  `deleted: true` 删除继承模型）。
- **删除模型**：目录继承模型写 `deleted: true` 覆盖条目；自建模型直接移除条目。


## 一次性迁移与标记文件

`.migrated-from-db` 是本目录唯一的迁移标记：旧版数据库里的供应商/模型导出为实例
文件、以及存量模型引用改写为 `{实例id}:{模型名}`，是**同一次**迁移的两个阶段，
共用一个标记，只执行一次。

- 全新安装没有 DB 行，两个阶段都是 no-op，只落一个标记。
- 引用改写的映射来自旧 DB 的 `model` 表（`旧id → {provider_id}:{modelName}`），
  逐条用本目录校验目标是否存在；解析不到的引用**保持原值**并在日志里列出，
  运行期遇到会明确报错（不会静默换用别的模型），在界面重新选一次模型即可。
- **重新运行**：删掉 `.migrated-from-db` 再启动即可（改写是幂等的，已迁移的引用会跳过）。
  还原旧数据库快照后如果引用回退成旧 id，就需要这样重跑一次。

模型选择与解析全部以本目录为唯一来源：会话只记录 `{实例id}:{模型名}`，
解析不到就报错，不会再回退到「系统默认模型」顶替。
