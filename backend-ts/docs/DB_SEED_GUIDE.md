# 数据库种子初始化指南

本文档介绍如何使用 TypeScript 后端的数据库种子脚本，快速初始化默认测试数据。

## 📋 功能说明

种子脚本 (`src/scripts/seed.ts`) 会执行以下操作：

1. **重置数据库**：清空所有现有数据并重建表结构
2. **创建默认管理员用户**
3. **创建默认模型提供商和模型**
4. **创建示例角色（Character）**
5. **创建全局设置**

## 🚀 使用方法

### 方式一：交互式模式（推荐）

```bash
npm run db:seed
```

系统会提示确认操作，输入 `yes` 继续。

### 方式二：强制模式（无需确认）

```bash
npm run db:seed:force
```

或

```bash
npm run db:seed -- --force
```

适用于自动化脚本或 CI/CD 流程。

### 方式三：验证数据

```bash
npm run db:verify
```

用于检查种子数据是否正确导入。

## 📊 默认数据

### 管理员用户

| 字段 | 值 |
|------|-----|
| 邮箱 | `admin@dingd.cn` |
| 密码 | `123456` |
| 手机号 | `13800138000` |
| 昵称 | `管理员` |
| 角色 | `primary` |

### 模型提供商

| 字段 | 值 |
|------|-----|
| 名称 | 硅基流动 |
| Provider | `siliconflow` |
| API URL | `https://api.siliconflow.cn/v1/` |

### 默认模型

1. **DeepSeek V3.2**
   - 类型：文本生成
   - Model Name: `deepseek-ai/DeepSeek-V3.2`
   - Max Tokens: 128,000
   - Features: thinking, tools

2. **Qwen3 Embedding 8B**
   - 类型：Embedding
   - Model Name: `Qwen/Qwen3-Embedding-8B`
   - Max Tokens: 32,000
   - Features: embedding

### 示例角色

- **名称**：智能助手
- **描述**：一个友好、专业的 AI 助手
- **系统提示**：你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。
- **Temperature**: 0.7
- **Max Tokens**: 2048

### 全局设置

| Key | Value | 说明 |
|-----|-------|------|
| `default_chat_model` | (动态) | 默认聊天模型 ID |
| `max_upload_size_mb` | `10` | 最大上传文件大小（MB） |
| `allowed_file_types` | `["txt", "pdf", "docx", "md", "json"]` | 允许的文件类型 |

## ⚠️ 注意事项

1. **数据丢失警告**：此操作会**清空所有现有数据**，请确保已备份重要数据！
2. **仅用于开发环境**：不建议在生产环境使用此脚本。
3. **Prisma 依赖**：确保已正确配置 Prisma Schema 并安装了 `@prisma/client`。
4. **bcrypt 依赖**：密码哈希使用 bcrypt，确保已安装该依赖。

## 🔧 自定义默认数据

如需修改默认数据，编辑 `src/scripts/seed.ts` 文件中的以下函数：

- `createDefaultUser()` - 修改管理员用户信息
- `createModelProvider()` - 修改模型提供商配置
- `createModels()` - 修改默认模型列表
- `createCharacter()` - 修改示例角色
- `createGlobalSettings()` - 修改全局设置

## 🐛 故障排查

### 问题 1：Prisma Client 未生成

**错误信息**：`Cannot find module '@prisma/client'`

**解决方案**：
```bash
npx prisma generate
```

### 问题 2：数据库连接失败

**错误信息**：`Can't reach database server`

**解决方案**：
1. 检查 `.env` 文件中的 `DATABASE_URL` 配置
2. 确保数据库服务正在运行
3. 对于 SQLite，确保路径正确

### 问题 3：权限不足

**错误信息**：`Permission denied`

**解决方案**：
- Windows：以管理员身份运行终端
- Linux/Mac：使用 `sudo` 或检查文件权限

## 📝 与 Python 版本对比

| 特性 | Python 版本 | TS 版本 | 状态 |
|------|-----------|---------|------|
| 数据库重置 | `drop_all` + `create_all` | `prisma db push --force-reset` | ✅ 等效 |
| 密码哈希 | `hash_password()` | `bcrypt.hash()` | ✅ 一致 |
| 默认用户 | admin@example.com / admin123 | admin@dingd.cn / 123456 | ⚠️ 不同 |
| ULID ID | 使用 ulid 库 | Prisma CUID | ⚠️ 不同 |
| 事务支持 | async session | Prisma 自动事务 | ✅ 等效 |

> **注意**：TS 版本使用 Prisma 默认的 CUID 作为 ID，而 Python 版本使用 ULID。这是两种不同的 ID 生成策略，但都具备时间有序性。

## 🎯 最佳实践

1. **开发环境**：每次开始新功能开发前，可以运行种子脚本重置数据库
2. **团队协作**：将种子脚本纳入团队开发流程，确保所有人使用相同的初始数据
3. **测试环境**：在运行集成测试前，先执行种子脚本确保数据一致性
4. **文档同步**：修改默认数据后，及时更新本文档

---

**最后更新**：2026-04-05
