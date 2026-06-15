# 多模型管理

统一 LLM 适配层，灵活接入多种模型供应商，支持多层级模型配置与动态切换。

## 架构

```
llm-core/
├── adapters/              → LLM 供应商适配器
│   ├── openai.adapter.ts
│   ├── anthropic.adapter.ts
│   ├── azure-openai.adapter.ts
│   ├── google.adapter.ts
│   └── ollama.adapter.ts
├── providers/             → 供应商配置管理
├── provider-hub.service.ts → 供应商注册中心
├── llm.service.ts         → LLM 调用统一入口
├── types/
│   └── llm.types.ts       → 类型定义
└── utils/
    └── tokenizer.service.ts → Token 计数服务
```

## 供应商抽象

每个供应商通过 `LLMProvider` 接口封装：

```typescript
interface LLMProvider {
  // 基础信息
  readonly name: string;
  readonly models: ModelConfig[];
  
  // 核心方法
  complete(params: LLMCompletionParams): AsyncGenerator<LLMResponseChunk>;
  countTokens(model: string, messages: MessageRecord[]): Promise<number>;
  
  // 能力检查
  supportsFeature(feature: ModelFeature): boolean;
}
```

`ProviderHubService` 统一管理所有已注册的供应商，根据 `modelId` 自动路由到对应适配器。

## 配置层级

| 层级 | 优先级 | 说明 | 配置位置 |
|------|--------|------|----------|
| **全局级** | 低 | 系统默认模型 | 系统设置 |
| **角色级** | 中 | 角色绑定的默认模型 | 角色设置（`modelId`） |
| **会话级** | 高 | 当前对话临时切换 | 会话设置 |

优先级：**会话级 > 角色级 > 全局级**

## 支持供应商

| 供应商 | 适配器 | 支持流式 | 支持 Thinking |
|--------|--------|----------|---------------|
| **OpenAI** | `OpenAIAdapter` | ✅ | ✅ (o1/o3) |
| **Anthropic** | `AnthropicAdapter` | ✅ | ✅ (Claude 3.5+) |
| **Azure OpenAI** | `AzureOpenAIAdapter` | ✅ | ✅ |
| **Google** | `GoogleAdapter` | ✅ | ❌ |
| **Ollama** | `OllamaAdapter` | ✅ | 取决于模型 |

可通过自定义适配器接入更多供应商。

## 核心能力

### Thinking 配置

支持推理强度控制，通过 `thinkingEffort` 参数配置：

| 级别 | 说明 | 适用场景 |
|------|------|----------|
| `off` | 关闭推理，直接生成 | 简单问答、翻译 |
| `low` | 轻度推理 | 常规对话 |
| `medium` | 中等推理 | 复杂分析 |
| `high` | 深度推理 | 数学、逻辑、代码 |

同时支持为压缩任务指定专用模型（`compressionModel`），避免使用高推理模型执行压缩，降低成本。

### Token 精准计数

使用 `@huggingface/tokenizers` 进行精准 Token 计数：

```typescript
// 计数文本 Token
countTextTokens(modelName: string, text: string): Promise<number>

// 计数消息列表 Token
countTokens(modelName: string, messages: MessageRecord[]): Promise<number>
```

避免字符预估误差，支持按模型选择对应 tokenizer。System Prompt 的 Token 数单独统计并从上下文窗口中扣除，确保可用空间计算准确。

### 模型参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `temperature` | number (0-2) | 生成随机性，越高越随机 |
| `topP` | number (0-1) | 核采样，动态选择 Token 集合 |
| `frequencyPenalty` | number (-2~2) | 频率惩罚，降低重复 |
| `maxTokens` | number | 最大输出 Token 数 |
| `thinkingEffort` | string | 推理强度（off/low/medium/high） |

## 错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| **超时** | 捕获并重试（可配置超时时间） |
| **速率限制** | 指数退避重试 |
| **上下文过长** | 触发压缩后重试 |
| **模型不可用** | 回退到默认模型 |

## Provider Hub

`ProviderHubService` 作为供应商注册中心，提供：
- 供应商注册与发现
- 模型列表查询（支持按能力过滤）
- 模型路由（根据 modelId 自动选择供应商）
- 健康检查（定期检测供应商可用性）
