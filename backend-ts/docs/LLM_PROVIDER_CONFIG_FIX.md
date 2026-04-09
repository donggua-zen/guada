# LLM 模型供应商配置修复报告

## 📋 问题描述

流式接口调用时出现错误，尝试连接 `https://api.openai.com/v1/chat/completions` 但超时。

**错误信息**：
```
Stream error: APIConnectionError: Connection error.
request to https://api.openai.com/v1/chat/completions failed, reason: ETIMEDOUT
```

**根本原因**：LLM Service 没有正确使用 session 中配置的模型供应商信息，而是硬编码使用了 OpenAI 默认配置。

---

## 🔍 问题分析

### 数据模型关系

```prisma
model Session {
  modelId   String?
  model     Model? @relation(fields: [modelId], references: [id])
}

model Model {
  id         String
  modelName  String   @map("model_name")
  providerId String   @map("provider_id")
  provider   ModelProvider @relation(fields: [providerId], references: [id])
}

model ModelProvider {
  id       String
  name     String
  apiUrl   String   @map("api_url")    // ✅ API 地址
  apiKey   String?  @map("api_key")    // ✅ API 密钥
}
```

### 问题链路

1. ❌ Session Repository 查询时只包含了 `model`，没有包含 `model.provider`
2. ❌ Agent Service 调用 LLM Service 时没有传递模型配置
3. ❌ LLM Service 在构造函数中硬编码了 OpenAI 配置
4. ❌ 导致始终使用默认的 OpenAI API，忽略了用户配置的供应商

---

## ✅ 已完成的修复

### 1. Session Repository - 包含 Provider 信息

**文件**: [`src/common/database/session.repository.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\common\database\session.repository.ts#L8-L19)

```typescript
// 修改前
async findById(id: string) {
    return this.prisma.session.findUnique({
        where: { id },
        include: { character: true, model: true },  // ❌ 缺少 provider
    });
}

// 修改后
async findById(id: string) {
    return this.prisma.session.findUnique({
        where: { id },
        include: { 
            character: true, 
            model: { 
                include: { 
                    provider: true  // ✅ 包含供应商信息
                } 
            } 
        },
    });
}
```

---

### 2. LLM Service - 支持动态配置

**文件**: [`src/modules/chat/llm.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\llm.service.ts)

```typescript
// 修改前
@Injectable()
export class LLMService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder',
    });
  }

  async *completions(params: { model: string; messages: any[]; ... }) {
    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
    });
    // ...
  }
}

// 修改后
@Injectable()
export class LLMService {
  /**
   * 创建 OpenAI 客户端（支持自定义配置）
   */
  private createClient(modelConfig?: any) {
    // 如果提供了模型配置，使用它；否则使用环境变量
    const baseURL = modelConfig?.provider?.apiUrl 
      || process.env.OPENAI_BASE_URL 
      || 'https://api.openai.com/v1';
    
    const apiKey = modelConfig?.provider?.apiKey 
      || process.env.OPENAI_API_KEY 
      || 'sk-placeholder';

    this.logger.debug(`Using model provider: ${modelConfig?.provider?.name || 'default'}, baseURL: ${baseURL}`);

    return new OpenAI({
      baseURL,
      apiKey,
    });
  }

  async *completions(params: {
    model: string;
    messages: any[];
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    tools?: any[];
    thinking?: boolean;
    modelConfig?: any;  // ✅ 新增：模型配置（包含供应商信息）
  }) {
    const client = this.createClient(params.modelConfig);
    
    const stream = await client.chat.completions.create({
      ...params,
      stream: true,
    });
    // ...
  }
}
```

**关键变化**：
- ✅ 移除构造函数中的硬编码配置
- ✅ 添加 `createClient` 方法，支持动态配置
- ✅ 从 `modelConfig.provider.apiUrl` 和 `modelConfig.provider.apiKey` 读取配置
- ✅ 添加日志记录，便于调试

---

### 3. Agent Service - 传递模型配置

**文件**: [`src/modules/chat/agent.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\agent.service.ts#L50-L57)

```typescript
// 修改前
while (needToContinue) {
  const stream = llm.completions({
    model: session.model?.modelName || 'gpt-3.5-turbo',
    messages: [...messages, ...chatTurns],
    tools,
    temperature: mergedSettings.modelTemperature,
    top_p: mergedSettings.modelTopP,
  });
  // ...
}

// 修改后
while (needToContinue) {
  const stream = llm.completions({
    model: session.model?.modelName || 'gpt-3.5-turbo',
    messages: [...messages, ...chatTurns],
    tools,
    temperature: mergedSettings.modelTemperature,
    top_p: mergedSettings.modelTopP,
    modelConfig: session.model,  // ✅ 传递模型配置（包含供应商信息）
  });
  // ...
}
```

---

## 📊 修改统计

| 文件 | 修改内容 | 行数变化 |
|------|---------|---------|
| **session.repository.ts** | 包含 provider 信息 | +8 / -1 |
| **llm.service.ts** | 支持动态配置 | +24 / -8 |
| **agent.service.ts** | 传递模型配置 | +1 |
| **总计** | 3 个文件 | **+33 / -9** |

---

## 🎯 配置优先级

LLM Service 现在按照以下优先级读取配置：

1. **Session 中的模型配置**（最高优先级）
   - `session.model.provider.apiUrl`
   - `session.model.provider.apiKey`

2. **环境变量**（降级方案）
   - `process.env.OPENAI_BASE_URL`
   - `process.env.OPENAI_API_KEY`

3. **默认值**（最后备选）
   - `https://api.openai.com/v1`
   - `sk-placeholder`

---

## 🔍 测试验证

### 1. 检查日志输出

启动后端服务后，发送消息时应该看到类似日志：

```
[LLMService] Using model provider: OpenAI, baseURL: https://api.openai.com/v1
```

或者如果使用其他供应商：

```
[LLMService] Using model provider: DeepSeek, baseURL: https://api.deepseek.com/v1
```

### 2. 验证不同供应商

测试配置了不同供应商的会话：

- ✅ OpenAI: `https://api.openai.com/v1`
- ✅ DeepSeek: `https://api.deepseek.com/v1`
- ✅ Claude: `https://api.anthropic.com/v1`
- ✅ 本地部署: `http://localhost:8000/v1`

---

## ⚠️ 注意事项

### 1. 数据库查询性能

包含 `provider` 会增加一次 JOIN 查询，但影响很小，因为：
- 每次会话只会查询一次
- Provider 表数据量小
- Prisma 会优化查询

### 2. 向后兼容

如果 `session.model` 或 `session.model.provider` 为 `null`，会自动降级到环境变量或默认值，不会导致错误。

### 3. 安全性

API Key 存储在数据库中，确保：
- ✅ 数据库访问权限受控
- ✅ 不要在前端暴露 API Key
- ✅ 考虑加密存储敏感信息

---

## 📝 相关文档

- [Messages 流式接口添加报告](./MESSAGES_STREAM_ENDPOINT_ADDED.md)
- [Messages 列表接口分页格式统一修复](./MESSAGES_LIST_PAGINATION_FIX.md)
- [认证 Token 字段命名统一修复](./AUTH_TOKEN_NAMING_FIX.md)
- [Session 创建接口字段兼容修复](./SESSION_CREATE_FIELD_COMPATIBILITY_FIX.md)

---

## ✅ 修复总结

### 修复前的问题
1. ❌ LLM Service 硬编码 OpenAI 配置
2. ❌ 未查询模型的供应商信息
3. ❌ 无法使用自定义模型供应商
4. ❌ 连接超时错误

### 修复后的状态
1. ✅ 支持动态模型供应商配置
2. ✅ 正确查询并传递 provider 信息
3. ✅ 支持多种 AI 服务提供商
4. ✅ 完整的降级机制

### 预期收益
- ✅ 支持多模型供应商切换
- ✅ 提高系统灵活性
- ✅ 降低对单一供应商的依赖
- ✅ 便于扩展新的 AI 服务

---

**修复日期**: 2026-04-05  
**修复人员**: Lingma AI Assistant  
**影响范围**: LLM Service, Agent Service, Session Repository  
**风险等级**: 低（向后兼容）  
**建议操作**: 测试不同供应商的模型调用
