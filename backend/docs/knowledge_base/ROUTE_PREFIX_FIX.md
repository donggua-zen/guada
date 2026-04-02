# 知识库路由前缀修复报告

## 🐛 问题描述

**现象**: 
- 其他 API（如 `/api/v1/user/profile`）正常工作
- 知识库 API 返回 404 错误
  - `GET /api/v1/knowledge-bases` → 404
  - `POST /api/v1/knowledge-bases` → 404

**根本原因**: 知识库相关路由的 `prefix` 缺少 `/api/v1` 前缀

---

## 🔍 问题分析

### 路由注册对比

#### ✅ 正常工作的路由（以 users 为例）
```python
# app/routes/users.py
users_router = APIRouter(prefix="/api/v1")

# app/__init__.py
app.include_router(users_router, tags=["users"])
```

**完整路径**: `/api/v1/user/profile`

#### ❌ 有问题的路由（知识库）
```python
# app/routes/knowledge_bases.py (修复前)
router = APIRouter(prefix="/knowledge-bases")

# app/__init__.py
app.include_router(knowledge_bases_router)
```

**实际路径**: `/knowledge-bases`  
**期望路径**: `/api/v1/knowledge-bases`

---

## ✅ 修复内容

### 修复文件列表

| 文件 | 修复前缀 | 修复后前缀 |
|------|----------|------------|
| [`knowledge_bases.py`](d:/编程开发/AI/ai_chat/backend/app/routes/knowledge_bases.py#L25) | `/knowledge-bases` | `/api/v1/knowledge-bases` |
| [`kb_files.py`](d:/编程开发/AI/ai_chat/backend/app/routes/kb_files.py#L28) | `/knowledge-bases/{kb_id}/files` | `/api/v1/knowledge-bases/{kb_id}/files` |
| [`kb_search.py`](d:/编程开发/AI/ai_chat/backend/app/routes/kb_search.py#L22) | `/knowledge-bases/{kb_id}/search` | `/api/v1/knowledge-bases/{kb_id}/search` |

### 修改详情

#### 1. knowledge_bases.py
```diff
-router = APIRouter(prefix="/knowledge-bases", tags=["Knowledge Base"])
+router = APIRouter(prefix="/api/v1/knowledge-bases", tags=["Knowledge Base"])
```

**API 端点**:
- `POST /api/v1/knowledge-bases` - 创建知识库
- `GET /api/v1/knowledge-bases` - 获取知识库列表
- `GET /api/v1/knowledge-bases/{kb_id}` - 获取单个知识库
- `DELETE /api/v1/knowledge-bases/{kb_id}` - 删除知识库

#### 2. kb_files.py
```diff
-router = APIRouter(prefix="/knowledge-bases/{kb_id}/files", tags=["Knowledge Base Files"])
+router = APIRouter(prefix="/api/v1/knowledge-bases/{kb_id}/files", tags=["Knowledge Base Files"])
```

**API 端点**:
- `POST /api/v1/knowledge-bases/{kb_id}/files/upload` - 上传文件
- `GET /api/v1/knowledge-bases/{kb_id}/files` - 获取文件列表
- `GET /api/v1/knowledge-bases/{kb_id}/files/{file_id}` - 获取文件详情
- `DELETE /api/v1/knowledge-bases/{kb_id}/files/{file_id}` - 删除文件

#### 3. kb_search.py
```diff
-router = APIRouter(prefix="/knowledge-bases/{kb_id}/search", tags=["Knowledge Base Search"])
+router = APIRouter(prefix="/api/v1/knowledge-bases/{kb_id}/search", tags=["Knowledge Base Search"])
```

**API 端点**:
- `POST /api/v1/knowledge-bases/{kb_id}/search` - 搜索知识库
- `POST /api/v1/knowledge-bases/{kb_id}/search/chunks` - 搜索分块

---

## 📊 路由结构

### 修复后的完整路由树

```
/api/v1
├── user/                  # 用户相关
│   └── profile
├── models                 # 模型相关
├── chat                   # 聊天相关
├── sessions               # 会话相关
├── messages               # 消息相关
├── characters             # 角色相关
├── files                  # 文件相关
├── settings               # 设置相关
├── mcp_servers            # MCP 服务器相关
└── knowledge-bases/       # 知识库相关 ✅ 已修复
    ├── {kb_id}
    │   ├── files          # 文件管理
    │   │   ├── upload
    │   │   ├── {file_id}
    │   │   └── ...
    │   └── search         # 搜索
    │       └── chunks
    └── ...
```

---

## 🎯 技术说明

### FastAPI Router 前缀规则

当使用 `include_router()` 时：

```python
# 方式 1: 在 router 定义时指定 prefix（推荐）
router = APIRouter(prefix="/api/v1")
app.include_router(router)

# 方式 2: 在 include 时指定 prefix
router = APIRouter()
app.include_router(router, prefix="/api/v1")
```

**两种方式效果相同**，但方式 1 更清晰。

### 为什么需要统一前缀？

1. **API 版本管理**: `/api/v1`, `/api/v2`
2. **统一认证**: 可以在 `/api/v1` 级别添加中间件
3. **文档组织**: Swagger UI 会按前缀分组显示
4. **跨域配置**: 可以针对特定前缀配置 CORS

---

## 🚀 验证步骤

### 1. 重启后端服务

由于使用了 `reload=True`，uvicorn 会自动检测代码变化并重新加载。

或者手动重启：
```bash
cd backend
python run.py
```

### 2. 检查启动日志

应该看到类似输出：
```
INFO:     app: 路由注册完成 - 2026-04-01 11:22:36
INFO:     Application startup complete.
```

### 3. 测试 API 端点

#### 方法 1: 使用 Swagger UI
访问：`http://localhost:8800/docs`
查找 "Knowledge Base" 相关的端点
确认路径都以 `/api/v1/knowledge-bases` 开头

#### 方法 2: 使用 curl
```bash
# 获取知识库列表（需要认证）
curl -X GET http://localhost:8800/api/v1/knowledge-bases \
  -H "Authorization: Bearer YOUR_TOKEN"

# 应该返回 200 OK 或 401 Unauthorized（而不是 404）
```

#### 方法 3: 浏览器开发者工具
1. 打开前端应用（`http://localhost:5173`）
2. 进入知识库页面
3. 查看 Network 面板
4. 请求应该成功（状态码 200）

---

## ⚠️ 常见问题

### Q1: 为什么其他 API 正常？

**A**: 其他路由（如 users, models, chat 等）已经正确设置了 `/api/v1` 前缀。

### Q2: 为什么要用 `/api/v1` 前缀？

**A**: 
1. **版本控制**: 方便未来升级到 v2
2. **统一规范**: 所有 API 都在同一命名空间下
3. **网关配置**: 便于反向代理和负载均衡
4. **文档清晰**: Swagger UI 会自动分组

### Q3: 如何避免类似问题？

**A**: 
1. **统一规范**: 所有 router 都使用相同的前缀模式
2. **代码审查**: PR 时检查路由前缀
3. **自动化测试**: 编写路由注册测试
4. **文档化**: 在 README 中明确说明路由规范

---

## 📝 最佳实践建议

### 1. 使用常量定义前缀

```python
# app/config.py
API_V1_PREFIX = "/api/v1"

# app/routes/knowledge_bases.py
from app.config import API_V1_PREFIX

router = APIRouter(prefix=f"{API_V1_PREFIX}/knowledge-bases")
```

**优点**:
- ✅ 统一管理，易于修改
- ✅ 避免硬编码
- ✅ 类型安全

### 2. 创建基础路由类

```python
# app/routes/base.py
from fastapi import APIRouter

class BaseRouter(APIRouter):
    def __init__(self, prefix: str, **kwargs):
        super().__init__(prefix=f"/api/v1{prefix}", **kwargs)

# 使用
router = BaseRouter("/knowledge-bases")
```

### 3. 添加路由注册测试

```python
# tests/test_routes.py
def test_knowledge_base_routes():
    from app import create_app
    app = create_app()
    
    routes = [route.path for route in app.routes]
    
    assert "/api/v1/knowledge-bases" in routes
    assert "/api/v1/knowledge-bases/{kb_id}/files" in routes
    assert "/api/v1/knowledge-bases/{kb_id}/search" in routes
```

---

## ✅ 验收清单

- [x] **路由前缀已统一**
  - [x] knowledge_bases.py: `/api/v1/knowledge-bases`
  - [x] kb_files.py: `/api/v1/knowledge-bases/{kb_id}/files`
  - [x] kb_search.py: `/api/v1/knowledge-bases/{kb_id}/search`

- [ ] **后端服务已重启**
  - [ ] 使用 `python run.py` 启动
  - [ ] 日志显示路由注册成功

- [ ] **API 测试通过**
  - [ ] GET `/api/v1/knowledge-bases` → 200
  - [ ] POST `/api/v1/knowledge-bases` → 201
  - [ ] GET `/api/v1/knowledge-bases/{kb_id}/files` → 200
  - [ ] POST `/api/v1/knowledge-bases/{kb_id}/search` → 200

- [ ] **前端集成测试**
  - [ ] 知识库页面正常加载
  - [ ] 创建知识库成功
  - [ ] 文件上传成功
  - [ ] 搜索功能正常

---

## 🎉 当前状态

**路由前缀**: ✅ 已修复  
**后端服务**: ✅ 运行中（8800 端口）  
**Vite 代理**: ✅ 配置正确（8800 端口）  

**下一步**: 重启后端服务并测试 API

---

**修复时间**: 2026-04-01  
**修复者**: AI Assistant  
**状态**: ✅ 完成
