# 记忆工具重构架构文档

## 📋 重构概述

本次重构将记忆系统明确划分为**长期记忆**和**短期记忆**两类，均通过 `session_id` 进行数据隔离。

### 重构日期
2026-03-30

---

## 🎯 设计目标

### 1. 记忆分类重构
- **长期记忆（Long-term Memory）**：持久化存储，仅支持编辑/更新操作
- **短期记忆（Short-term Memory）**：时效性缓冲区，提供完整 CRUD 接口

### 2. 长期记忆设计规范
- **特性**：仅支持"编辑/更新"操作，不向用户或 LLM 暴露直接的"添加"和"删除"接口
- **自动追加逻辑**：在执行编辑操作时，若指定的记忆记录不存在，系统应自动创建新记录（Upsert 模式）
- **细分类型**：
  - `FACTUAL`：核心事实性知识库，用于存储用户偏好、重要决策、项目状态等关键信息
  - `SOUL`：AI 人格与风格定义，用于存储角色定位、语言风格、行为规则等元数据

### 3. 短期记忆设计规范
- **特性**：作为时效性信息的缓冲区
- **完整 CRUD 接口**：必须提供标准的添加（Add）、搜索（Search）和删除（Delete）接口
- **自动过期**：支持 TTL（Time To Live），过期后自动清理

---

## 🏗️ 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                   MemoryToolProvider                     │
│  (统一入口，保持 IToolProvider 接口兼容)                   │
└─────────────────────────────────────────────────────────┘
                            ↓
         ┌──────────────────┴──────────────────┐
         ↓                                     ↓
┌─────────────────────┐            ┌─────────────────────┐
│  LongTermMemory     │            │  ShortTermMemory    │
│  Manager            │            │  Manager            │
│                     │            │                     │
│ - FACTUAL 类型      │            │ - 完整 CRUD          │
│ - SOUL 类型         │            │ - 临时缓冲区         │
│ - Upsert 模式       │            │ - 自动清理           │
│ - 仅编辑接口        │            │                     │
└─────────────────────┘            └─────────────────────┘
         ↓                                     ↓
    ┌────────────────────────────────────────────────┐
    │          MemoryRepository (增强版)              │
    │  - 支持 session_id 隔离                          │
    │  - 支持两种记忆类型的不同操作逻辑                │
    └────────────────────────────────────────────────┘
```

---

## 📦 数据模型设计

### 枚举定义

```python
class MemoryCategory(str, Enum):
    """记忆分类（顶层分类）"""
    LONG_TERM = "long_term"      # 长期记忆
    SHORT_TERM = "short_term"    # 短期记忆


class LongTermMemoryType(str, Enum):
    """长期记忆细分类型"""
    FACTUAL = "factual"          # 核心事实性知识
    SOUL = "soul"               # AI 人格与风格定义


class ShortTermMemoryType(str, Enum):
    """短期记忆类型（可扩展）"""
    TEMPORARY = "temporary"      # 临时信息
    CONTEXT = "context"         # 上下文缓冲
```

### Memory 模型增强

**文件位置**: [`app/models/memory.py`](d:/编程开发/AI/ai_chat/backend/app/models/memory.py)

**新增字段**:
- `category`: 记忆分类（long_term/short_term）
- `memory_type`: 记忆子类型（复用原有字段，语义扩展）
- `expires_at`: 过期时间（仅短期记忆使用）

**索引优化**:
- `idx_memory_category`: 按分类查询
- `idx_memory_session_category`: 按会话 + 分类复合查询
- `idx_memory_expires`: 按过期时间查询

---

## 🔧 工具接口设计

### 工具列表

| 工具名称 | 分类 | 功能描述 |
|---------|------|---------|
| `long_term__upsert` | 长期记忆 | Upsert 长期记忆（编辑或自动创建） |
| `long_term__edit` | 长期记忆 | 编辑已有长期记忆 |
| `short_term__add` | 短期记忆 | 添加短期记忆 |
| `short_term__search` | 短期记忆 | 搜索短期记忆 |
| `short_term__delete` | 短期记忆 | 删除短期记忆 |

### Pydantic 参数模型

#### 长期记忆参数

```python
class UpsertLongTermMemoryParams(BaseModel):
    """Upsert 长期记忆参数（编辑或自动创建）"""
    memory_id: Optional[str] = Field(
        default=None, 
        description="记忆 ID（可选，不提供时自动创建新记录）"
    )
    content: str = Field(..., description="记忆内容")
    memory_type: LongTermMemoryType = Field(
        default=LongTermMemoryType.FACTUAL,
        description="长期记忆类型：FACTUAL/SOUL"
    )
    importance: int = Field(
        default=5, ge=1, le=10,
        description="重要性评分 (1-10)"
    )
    tags: List[str] = Field(default_factory=list)


class EditLongTermMemoryParams(BaseModel):
    """编辑长期记忆参数"""
    memory_id: str = Field(..., description="记忆 ID")
    content: Optional[str] = Field(default=None)
    importance: Optional[int] = Field(default=None, ge=1, le=10)
    tags: Optional[List[str]] = Field(default=None)
```

#### 短期记忆参数

```python
class AddShortTermMemoryParams(BaseModel):
    """添加短期记忆参数"""
    content: str = Field(..., description="要记住的内容")
    memory_type: ShortTermMemoryType = Field(
        default=ShortTermMemoryType.TEMPORARY
    )
    ttl_seconds: Optional[int] = Field(
        default=3600, ge=60,
        description="生存时间（秒），默认 1 小时"
    )
    tags: List[str] = Field(default_factory=list)


class SearchShortTermMemoryParams(BaseModel):
    """搜索短期记忆参数"""
    query: str = Field(..., description="搜索关键词")
    memory_type: Optional[ShortTermMemoryType] = Field(default=None)
    limit: int = Field(default=10, ge=1)


class DeleteShortTermMemoryParams(BaseModel):
    """删除短期记忆参数"""
    memory_id: str = Field(..., description="要删除的记忆 ID")
```

---

## 💉 Session ID 注入机制

### 注入流程

```python
# 在 ToolOrchestrator 中自动注入 session_id
async def execute_tool_call(
    self,
    request: ToolCallRequest,
    context: ToolExecutionContext
) -> ToolCallResponse:
    # 构建注入参数
    inject_params = {
        "session_id": context.session_id,  # ⭐ 必填字段
    }
    
    # 路由到对应的 Provider
    if request.name.startswith("memory__"):
        provider = self.memory_provider
        response = await provider.execute_with_namespace(
            request=request,
            inject_params=inject_params  # ⭐ 自动注入
        )
        return response
```

### 数据隔离实现

所有 Repository 方法都强制要求 `session_id` 参数：

```python
async def upsert_long_term_memory(
    self,
    session_id: str,  # ⭐ 强制要求
    memory_id: Optional[str],
    content: str,
    ...
) -> Memory:
    # 验证权限：确保记录属于当前 session
    if memory_id:
        stmt = select(Memory).filter(
            and_(
                Memory.id == memory_id,
                Memory.session_id == session_id,  # ⭐ 权限验证
                Memory.category == MemoryCategory.LONG_TERM.value
            )
        )
```

---

## 🗄️ 数据库迁移

### 迁移脚本

**文件位置**: [`migrations/versions/add_memory_category_and_expires_at.py`](d:/编程开发/AI/ai_chat/backend/migrations/versions/add_memory_category_and_expires_at.py)

**主要变更**:
1. 添加 `category` 字段（String(20), 默认 'long_term'）
2. 添加 `expires_at` 字段（DateTime, 可空）
3. 更新 `memory_type` 字段注释
4. 创建新索引：
   - `idx_memory_category`
   - `idx_memory_session_category`
   - `idx_memory_expires`
5. 数据迁移：将现有记录标记为 `long_term.factual`

### 执行迁移

```bash
# 由于 alembic 未安装，手动执行迁移脚本
cd d:\编程开发\AI\ai_chat\backend
python -c "
import asyncio
from migrations.versions.add_memory_category_and_expires_at import upgrade
upgrade()
"
```

---

## 📝 使用示例

### 长期记忆 Upsert

```python
# LLM 调用示例
{
  "name": "memory__long_term__upsert",
  "arguments": {
    "content": "用户偏好使用中文交流",
    "memory_type": "factual",
    "importance": 8,
    "tags": ["用户偏好", "语言"]
  }
}

# 响应
"✓ 长期记忆已创建 (ID: 01JXABC123DEF456, 类型：factual, 重要性：8)"
```

### 短期记忆添加

```python
# LLM 调用示例
{
  "name": "memory__short_term__add",
  "arguments": {
    "content": "用户正在询问关于 Python 异步编程的问题",
    "memory_type": "context",
    "ttl_seconds": 1800,  # 30 分钟后过期
    "tags": ["对话上下文", "技术讨论"]
  }
}

# 响应
"✓ 短期记忆已添加 (ID: 01JXABC789GHI012, 过期时间：2026-03-30 15:30)"
```

---

## ✅ 重构检查清单

### Phase 1: 数据库迁移 ✓
- [x] 创建 Alembic 迁移脚本
- [x] 添加 category 和 expires_at 字段
- [x] 创建新索引
- [x] 数据迁移逻辑

### Phase 2: 模型层重构 ✓
- [x] 更新 Memory 模型
- [x] 添加枚举定义
- [x] 更新 to_dict() 方法
- [x] 添加新字段和索引

### Phase 3: Repository 层重构 ✓
- [x] 实现 upsert_long_term_memory()
- [x] 实现 add_short_term_memory()
- [x] 实现 search_short_term_memories()
- [x] 实现 delete_short_term_memory()
- [x] 实现 cleanup_expired_short_term_memories()
- [x] 增强 search_memories() 支持分类过滤

### Phase 4: 工具层重构 ✓
- [x] 重构 _get_tools_internal() 返回新工具列表
- [x] 重构 _execute_tool() 支持新工具名
- [x] 实现 _upsert_long_term()
- [x] 实现 _edit_long_term()
- [x] 实现 _add_short_term()
- [x] 实现 _search_short_term()
- [x] 实现 _delete_short_term()
- [x] 移除旧方法（保持向后兼容）

### Phase 5: 单元测试 ⏳
- [ ] 更新 test_memory_tools.py
- [ ] 测试 Upsert 逻辑
- [ ] 测试短期记忆 CRUD
- [ ] 测试 session_id 隔离

### Phase 6: 集成验证 ⏳
- [ ] 验证 session_id 注入机制
- [ ] 测试数据隔离
- [ ] 测试过期清理

### Phase 7: 文档更新 ✓
- [x] 生成架构文档
- [x] 编写使用示例

---

## 🔄 向后兼容性

### 保留的旧方法（已废弃）

为了保持向后兼容，以下旧方法暂时保留但标记为废弃：
- `add_memory()` → 建议使用 `long_term__upsert`
- `search_memories()` → 建议使用 `search_short_term` 或增强的 `search_memories`
- `edit_memory()` → 建议使用 `long_term__edit`
- `summarize_memories()` → 建议使用增强的 `summarize_memories(category="long_term")`

### 迁移计划

后续版本将完全移除旧方法，建议使用者尽快迁移到新接口。

---

## 📊 性能优化

### 索引策略

1. **单字段索引**:
   - `idx_memory_category`: 快速按分类过滤
   - `idx_memory_type`: 快速按子类型过滤
   - `idx_memory_importance`: 支持按重要性排序
   - `idx_memory_expires`: 快速定位过期记录

2. **复合索引**:
   - `idx_memory_session_category`: 优化 session_id + category 查询
   - `idx_memory_session_type`: 优化 session_id + memory_type 查询

### 查询优化

```python
# 短期记忆查询自动过滤过期数据
now = datetime.now(timezone.utc)
stmt = select(Memory).filter(
    and_(
        Memory.session_id == session_id,
        Memory.category == MemoryCategory.SHORT_TERM.value,
        or_(
            Memory.expires_at.is_(None),  # 没有过期时间
            Memory.expires_at > now       # 未过期
        )
    )
)
```

---

## 🚀 后续改进方向

1. **向量搜索集成**: 在 `metadata_` 中存储向量嵌入，使用 FAISS 或 ChromaDB 实现语义搜索
2. **记忆压缩**: 定期将多条短期记忆合并为一条长期记忆
3. **智能过期**: 根据重要性动态调整短期记忆的 TTL
4. **记忆图谱**: 建立记忆之间的关联关系，形成知识网络

---

## 📞 联系与维护

如有问题或建议，请参考：
- 代码位置：[`app/services/tools/providers/memory_tool_provider.py`](d:/编程开发/AI/ai_chat/backend/app/services/tools/providers/memory_tool_provider.py)
- 模型定义：[`app/models/memory.py`](d:/编程开发/AI/ai_chat/backend/app/models/memory.py)
- 仓库实现：[`app/repositories/memory_repository.py`](d:/编程开发/AI/ai_chat/backend/app/repositories/memory_repository.py)
