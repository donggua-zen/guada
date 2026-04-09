# 硅基流动 API Key 配置问题

## 📋 问题描述

调用硅基流动 API 时返回 `401 AuthenticationError`。

**错误信息**：
```
AuthenticationError: 401 status code (no body)
```

---

## 🔍 根本原因

数据库中存储的 API Key 是**占位符**，不是真实的 API Key。

**检查结果**：
```
Provider: 硅基流动
API URL: https://api.siliconflow.cn/v1/
API Key: "sk-your-api-key-here"  ❌ 这是占位符！
API Key length: 20
```

---

## ✅ 解决方案

### 方案 1：通过前端界面配置（推荐）

1. 登录系统
2. 进入 **设置** → **模型管理**
3. 找到 **硅基流动** 供应商
4. 点击 **编辑**
5. 填入真实的 API Key
6. 保存

### 方案 2：直接更新数据库

```sql
UPDATE model_provider 
SET api_key = '你的真实API密钥' 
WHERE name = '硅基流动';
```

### 方案 3：使用种子脚本更新

修改 `src/scripts/seed.ts` 中的 API Key：

```typescript
await prisma.modelProvider.upsert({
  where: { id: 'cmnlpwt5x0001xhrry7vk3wf9' },
  update: {
    apiKey: process.env.SILICONFLOW_API_KEY || '你的真实API密钥',  // ✅ 修改这里
  },
  create: {
    // ...
  },
});
```

然后运行：
```bash
npm run db:seed
```

---

## 🔑 如何获取硅基流动 API Key

1. 访问 [硅基流动官网](https://siliconflow.cn/)
2. 注册/登录账号
3. 进入 **控制台** → **API Keys**
4. 创建新的 API Key
5. 复制并保存到安全位置

**注意**：
- API Key 格式通常为 `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- 长度通常在 40-60 个字符
- 妥善保管，不要泄露

---

## 🧪 验证 API Key

更新 API Key 后，运行测试脚本验证：

```bash
cd d:\编程开发\AI\ai_chat\backend-ts
node test-siliconflow.js
```

**成功输出**：
```
✅ API Connection Successful!
Response: Hello! How can I help you today?
Usage: {"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}
```

**失败输出**：
```
❌ API Connection Failed!
Status: 401
Message: 401 status code (no body)
```

---

## ⚠️ 注意事项

### 1. API Key 格式

硅基流动的 API Key 通常以 `sk-` 开头，后面跟着随机字符串。

**示例**：
```
sk-abc123def456ghi789jkl012mno345pqr678stu901vwx
```

### 2. 安全性

- ✅ 不要在代码中硬编码 API Key
- ✅ 使用环境变量或数据库加密存储
- ✅ 定期轮换 API Key
- ❌ 不要将 API Key 提交到版本控制系统

### 3. 其他供应商

如果使用其他 AI 服务提供商，也需要配置相应的 API Key：

| 供应商 | API URL | 需要 API Key |
|--------|---------|-------------|
| OpenAI | https://api.openai.com/v1 | ✅ |
| 硅基流动 | https://api.siliconflow.cn/v1 | ✅ |
| DeepSeek | https://api.deepseek.com/v1 | ✅ |
| Claude | https://api.anthropic.com/v1 | ✅ |

---

## 📝 相关文档

- [LLM Service 字段命名统一与非流式接口补充](./LLM_SERVICE_CAMELCASE_AND_NONSTREAM_FIX.md)
- [LLM Service TypeScript vs Python 对比分析](./LLM_SERVICE_TS_VS_PYTHON_COMPARISON.md)
- [LLM 模型供应商配置修复](./LLM_PROVIDER_CONFIG_FIX.md)

---

## ✅ 检查清单

- [ ] 获取硅基流动的真实 API Key
- [ ] 通过前端界面或数据库更新 API Key
- [ ] 运行测试脚本验证连接
- [ ] 测试流式对话功能
- [ ] 确认日志中显示正确的 API Key 长度（应 > 20）

---

**问题日期**: 2026-04-05  
**诊断人员**: Lingma AI Assistant  
**风险等级**: 低（配置问题）  
**建议操作**: 立即更新 API Key
