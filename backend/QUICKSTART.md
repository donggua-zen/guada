# MCP 服务器功能 - 快速启动指南

## 🚀 快速开始

### 步骤 1: 激活虚拟环境

```bash
cd "d:\编程开发\AI\ai_chat\backend"
.venv\Scripts\activate
```

### 步骤 2: 运行数据库迁移

```bash
alembic upgrade head
```

这将创建 `mcp_server` 表。验证是否成功：

```bash
# 查看迁移历史
alembic history

# 查看当前版本
alembic current
```

你应该能看到最新的迁移记录：`175ed05a2735 -> add mcp_server table`

### 步骤 3: 启动后端服务

```bash
python run.py
```

服务将在 `http://localhost:8800` 启动。

### 步骤 4: 访问 API 文档

打开浏览器访问 Swagger UI：
```
http://localhost:8800/docs
```

在文档中你可以找到 **MCP Servers** 标签页，里面包含所有 MCP 相关的接口。

---

## 🧪 测试 API

### 方法一：自动测试脚本

确保服务已启动，然后在新终端窗口运行：

```bash
cd "d:\编程开发\AI\ai_chat\backend"
.venv\Scripts\activate
python test_mcp_api.py
```

测试脚本会自动执行完整的 CRUD 流程并显示结果。

### 方法二：手动测试（使用 cURL）

#### 1. 创建 MCP 服务器

```bash
curl -X POST http://localhost:8800/api/v1/mcp-servers ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"测试服务器\",\"url\":\"https://mcp.test.com/api\",\"description\":\"我的第一个 MCP 服务器\",\"headers\":{\"Authorization\":\"Bearer test-token\"},\"enabled\":true}"
```

#### 2. 获取所有服务器

```bash
curl http://localhost:8800/api/v1/mcp-servers
```

#### 3. 更新服务器

```bash
# 替换 {server_id} 为实际 ID
curl -X PUT http://localhost:8800/api/v1/mcp-servers/{server_id} ^
  -H "Content-Type: application/json" ^
  -d "{\"enabled\":false}"
```

#### 4. 删除服务器

```bash
# 替换 {server_id} 为实际 ID
curl -X DELETE http://localhost:8800/api/v1/mcp-servers/{server_id}
```

### 方法三：使用前端界面

1. 启动前端服务：
   ```bash
   cd "d:\编程开发\AI\ai_chat\frontend"
   npm run dev
   ```

2. 访问：`http://localhost:3000`

3. 进入设置页面 → MCP 服务器管理

4. 点击"+"按钮添加新服务器，配置以下信息：
   - **服务器名称**：例如 "生产环境 MCP"
   - **服务地址**：例如 "https://mcp.production.com/api"
   - **描述信息**：可选
   - **HTTP 请求头**：每行一个，格式为 `Header-Name: value`
     ```
     Authorization: Bearer your_token_here
     X-API-Key: your_api_key
     ```

---

## 📋 验证清单

完成以上步骤后，你应该能够：

- [ ] 成功启动后端服务（无报错）
- [ ] 访问 Swagger 文档看到 MCP Servers 接口
- [ ] 成功创建 MCP 服务器
- [ ] 在数据库中看到 `mcp_server` 表
- [ ] 前端界面能正常显示和管理 MCP 服务器

---

## 🔍 常见问题

### Q1: 迁移失败怎么办？

**A:** 检查以下几点：
1. 确保虚拟环境已激活
2. 确认 alembic 已安装：`pip show alembic`
3. 检查数据库连接配置（在 `.env` 文件中）

### Q2: 服务启动失败？

**A:** 
1. 检查端口 8800 是否被占用
2. 查看日志文件：`logs/` 目录
3. 确认所有依赖已安装：`pip install -r requirements.txt`

### Q3: 前端无法连接后端？

**A:**
1. 确认后端服务正在运行
2. 检查 CORS 配置（在 `app/__init__.py` 中）
3. 查看浏览器控制台的网络请求错误信息

### Q4: 如何重置数据库？

**A:**
```bash
# 降级到初始状态
alembic downgrade base

# 重新升级
alembic upgrade head
```

---

## 📚 更多信息

- 详细 API 文档：[MCP_SERVER_API.md](./MCP_SERVER_API.md)
- 项目架构说明：查看各层的实现代码
- 前端使用：参考前端组件 `src/components/settings/MCPServers.vue`

---

## ✅ 完成！

现在你已经成功部署并可以使用 MCP 服务器管理功能了！🎉

如有问题，请查看详细文档或联系开发团队。