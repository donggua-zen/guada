# 后端端口配置说明

## 📊 端口配置历史

### 问题根源

项目中有两种启动后端的方式，使用了**不同的端口**：

| 启动方式 | 命令 | 端口 | 配置文件 |
|---------|------|------|----------|
| **方式 1** | `uvicorn app:app --reload` | 8000 | 命令行参数 |
| **方式 2** | `python run.py` | 8800 | [`run.py`](d:/编程开发/AI/ai_chat/backend/run.py#L26) |

### 用户实际使用

根据终端日志，用户使用 **方式 2** 启动：
```bash
python run.py
# INFO: Uvicorn running on http://0.0.0.0:8800
```

**因此 Vite 代理应该配置为 8800 端口**。

---

## ✅ 修复内容

### 修改文件
[`vite.config.ts`](d:/编程开发/AI/ai_chat/frontend/vite.config.ts#L54-L67)

### 修改对比
```diff
server: {
  proxy: {
    // 代理 API 请求
    '/api/v1': {
-      target: 'http://localhost:8000',
+      target: 'http://localhost:8800', // 后端地址（run.py 启动的端口）
      changeOrigin: true,
    },
    // 代理静态资源请求
    '/static': {
-      target: 'http://localhost:8000',
+      target: 'http://localhost:8800',
      changeOrigin: true
    }
  }
}
```

---

## 🎯 正确的配置方案

### 方案 A: 统一使用 8800 端口（推荐）

**优点**:
- ✅ 与 `run.py` 一致，无需额外记忆
- ✅ 使用 `.env` 文件管理配置
- ✅ 符合项目现有规范

**配置**:
```typescript
// vite.config.ts
server: {
  proxy: {
    '/api/v1': {
      target: 'http://localhost:8800',
      changeOrigin: true,
    }
  }
}
```

**启动顺序**:
```bash
# 1. 启动后端（终端 1）
cd backend
python run.py

# 2. 启动前端（终端 2）
cd frontend
npm run dev
```

### 方案 B: 修改 run.py 使用 8000 端口

如果希望使用 8000 端口，可以修改 `run.py`:

```python
# run.py
uvicorn.run(
    "app:create_app",
    host="0.0.0.0",
    port=8000,  # 改为 8000
    reload=True,
)
```

然后更新 Vite 配置回 8000。

---

## 📋 当前配置状态

| 组件 | 配置值 | 说明 |
|------|--------|------|
| **后端启动** | 8800 | `run.py` 第 26 行 |
| **Vite 代理** | 8800 | `vite.config.ts` 已更新 |
| **前端访问** | 5173/5174 | Vite 自动分配 |

---

## 🔍 技术细节

### 为什么有两种启动方式？

#### uvicorn 直接启动
```bash
uvicorn app:app --reload --port 8000
```
- **用途**: 快速测试、调试
- **特点**: 灵活，可临时指定参数
- **缺点**: 每次都要输入完整命令

#### run.py 启动
```bash
python run.py
```
- **用途**: 正式开发、生产环境
- **特点**: 
  - 使用 `.env` 配置环境变量
  - 自动切换工作目录
  - 配置集中管理
- **优势**: 更符合工程化实践

### .env 配置文件

如果存在 `.env` 文件，可能包含：
```env
# .env
DATABASE_URL=sqlite+aiosqlite:///./data/app.db
API_HOST=0.0.0.0
API_PORT=8800
DEBUG=True
```

在代码中读取：
```python
import os
from dotenv import load_dotenv

load_dotenv()  # 加载 .env

port = int(os.getenv("API_PORT", "8800"))  # 默认 8800
```

---

## ⚠️ 常见问题

### 问题 1: 端口冲突

**现象**: 
```
Error: [Errno 10048] error while attempting to bind on address ('0.0.0.0', 8800): 
normally indicates only one usage of each socket address
```

**原因**: 8800 端口已被占用

**解决**:
```bash
# Windows: 查找占用端口的进程
netstat -ano | findstr :8800

# 杀死进程
taskkill /PID <PID> /F

# 或者修改端口
# 方法 1: 修改 run.py 的 port 参数
# 方法 2: 设置环境变量
set API_PORT=8801
python run.py
```

### 问题 2: 代理不生效

**检查清单**:
- [ ] `vite.config.ts` 配置正确
- [ ] 后端服务已启动（`curl http://localhost:8800/api/v1/user/profile`）
- [ ] 前端服务已重启（配置修改不会热重载）
- [ ] 浏览器缓存已清除

### 问题 3: CORS 错误

如果使用代理后还有 CORS 错误，检查后端 CORS 配置：

```python
# app/__init__.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 🚀 验证步骤

### 1. 确认后端端口

```bash
# 查看后端启动日志
# 应该看到：INFO: Uvicorn running on http://0.0.0.0:8800
```

### 2. 确认前端代理配置

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api/v1': {
      target: 'http://localhost:8800',  // ← 确认是 8800
      changeOrigin: true,
    }
  }
}
```

### 3. 测试 API 连接

访问 `http://localhost:5173`（或 5174），打开浏览器控制台：

```javascript
fetch('/api/v1/user/profile')
  .then(r => r.json())
  .then(console.log)
// 应该返回用户信息
```

### 4. 检查网络请求

在浏览器 Network 面板：
- Request URL: `http://localhost:5173/api/v1/knowledge-bases`
- Remote Address: `127.0.0.1:5173` (Vite)
- 实际请求会被转发到：`http://localhost:8800/api/v1/knowledge-bases`

---

## 📝 最佳实践建议

### 1. 使用环境变量

在项目根目录创建 `.env` 文件：
```env
# 后端配置
BACKEND_PORT=8800
BACKEND_HOST=0.0.0.0

# 前端配置
VITE_API_BASE_URL=http://localhost:8800
```

在代码中使用：
```python
# run.py
port = int(os.getenv("BACKEND_PORT", "8800"))
```

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api/v1': {
        target: `http://localhost:${process.env.VITE_API_BASE_URL || '8800'}`,
        changeOrigin: true,
      }
    }
  }
})
```

### 2. 添加启动脚本

**package.json**:
```json
{
  "scripts": {
    "dev": "vite",
    "dev:backend": "cd ../backend && python run.py",
    "dev:all": "concurrently \"npm run dev:backend\" \"npm run dev\""
  }
}
```

然后运行：
```bash
npm run dev:all
# 同时启动前后端服务
```

### 3. 文档化

在 README.md 中明确说明：
```markdown
## 开发环境启动

### 后端
```bash
cd backend
python run.py  # 启动在 http://localhost:8800
```

### 前端
```bash
cd frontend
npm run dev  # 启动在 http://localhost:5173
```

### 访问
- 前端：http://localhost:5173
- 后端 API: http://localhost:8800
- Swagger 文档：http://localhost:8800/docs
```

---

## ✅ 当前状态

**后端端口**: ✅ 8800 (run.py)  
**Vite 代理**: ✅ 8800 (已更新)  
**前端端口**: ✅ 5173/5174 (Vite 自动分配)  

**配置一致性**: ✅ 已完成  
**可以开始测试**！

---

**更新时间**: 2026-04-01  
**更新者**: AI Assistant  
**状态**: ✅ 完成
