# API Key 配置指南

## 问题描述

在访问 `/api/v1/providers/{id}/remote_models` 接口时出现 **401 认证错误**：

```
AuthenticationError: 401 status code (no body)
```

这是因为数据库中存储的 API Key 无效或已过期。

---

## 原因分析

种子脚本 (`src/scripts/seed.ts`) 创建默认模型提供商时，使用了硬编码的测试 API Key：

```typescript
apiKey: 'ccdjtlfjhfrkyhcsiijmwahhxaqnfplyaesoqigjvbizbmsy', // ❌ 无效的测试 key
```

这个 key 不是真实的硅基流动 API Key，导致调用远程 API 时认证失败。

---

## 解决方案

### 方案 1：通过环境变量配置（推荐）✅

#### 步骤 1：获取真实的 API Key

1. 访问 [硅基流动官网](https://siliconflow.cn/)
2. 注册/登录账号
3. 进入「API Keys」页面
4. 创建新的 API Key（格式类似：`sk-xxxxxxxxxxxxxxxx`）

#### 步骤 2：配置环境变量

编辑 `backend-ts/.env` 文件：

```bash
# Model Provider API Keys (Optional)
# 硅基流动 API Key - 用于种子脚本创建默认提供商
SILICONFLOW_API_KEY=sk-your-real-api-key-here
```

将 `sk-your-real-api-key-here` 替换为你从硅基流动获取的真实 API Key。

#### 步骤 3：重新运行种子脚本

```bash
cd backend-ts
npm run seed
```

种子脚本会自动使用环境变量中的 API Key 创建模型提供商。

---

### 方案 2：通过管理界面配置

如果你已经运行了种子脚本，可以通过前端管理界面更新 API Key：

1. 登录系统（默认账号：`admin@dingd.cn` / `123456`）
2. 进入「模型管理」页面
3. 找到「硅基流动」提供商
4. 点击「编辑」按钮
5. 在「API Key」字段中输入真实的 API Key
6. 保存更改

---

### 方案 3：直接修改数据库（快速测试）

如果需要快速测试，可以直接更新数据库中的 API Key：

```bash
# 使用 Prisma Studio 可视化编辑
npx prisma studio
```

然后在浏览器中找到 `model_provider` 表，编辑对应记录的 `api_key` 字段。

或者使用 SQL：

```sql
UPDATE model_provider 
SET api_key = 'sk-your-real-api-key-here' 
WHERE provider = 'siliconflow';
```

---

## 验证配置

配置完成后，测试远程模型列表接口：

```bash
# 1. 获取 JWT Token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@dingd.cn", "password": "123456"}'

# 2. 获取提供商 ID
curl http://localhost:3000/api/v1/providers \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. 获取远程模型列表
curl http://localhost:3000/api/v1/providers/YOUR_PROVIDER_ID/remote_models \
  -H "Authorization: Bearer YOUR_TOKEN"
```

如果配置正确，应该返回模型列表：

```json
[
  {
    "model_name": "deepseek-ai/DeepSeek-V3.2",
    "model_type": "text",
    "features": []
  },
  ...
]
```

---

## 安全建议

⚠️ **重要安全提醒**：

1. **不要将真实的 API Key 提交到 Git 仓库**
   - `.env` 文件已在 `.gitignore` 中
   - 确保没有硬编码 API Key 到代码中

2. **定期轮换 API Key**
   - 建议每 3-6 个月更换一次
   - 如果发现泄露，立即在提供商控制台撤销

3. **限制 API Key 权限**
   - 如果提供商支持，为不同用途创建不同的 Key
   - 设置使用限额和 IP 白名单

4. **生产环境使用密钥管理服务**
   - 考虑使用 AWS Secrets Manager、Azure Key Vault 等
   - 避免在环境变量中明文存储

---

## 常见问题

### Q1: 如何知道 API Key 是否有效？

尝试调用提供商的模型列表 API：

```bash
curl https://api.siliconflow.cn/v1/models \
  -H "Authorization: Bearer sk-your-api-key"
```

如果返回 200 状态码和模型列表，说明 Key 有效。

### Q2: 为什么种子脚本不直接使用环境变量？

现在已经改为使用环境变量了！之前的版本是为了方便快速启动演示，但会导致认证错误。

### Q3: 可以有多个模型提供商吗？

可以！每个提供商可以配置不同的 API Key。系统支持同时配置多个提供商（如硅基流动、OpenAI、Anthropic 等）。

### Q4: API Key 错误会影响其他功能吗？

不会。只有调用该提供商的远程 API 时会失败，本地功能（如聊天、知识库等）不受影响。

---

## 相关文档

- [Prisma Json 类型升级方案](./PRISMA_JSON_TYPE_UPGRADE.md)
- [JSON 字段序列化修复完成报告](./JSON_FIELD_SERIALIZATION_COMPLETE.md)
- [分页格式统一修复报告](./PAGINATION_FIX_COMPLETE.md)
- [API 命名规范分析](./API_NAMING_CONVENTION_ANALYSIS.md)

---

**最后更新**: 2026-04-05  
**作者**: Lingma AI Assistant
