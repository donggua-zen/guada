# 工具族（Tool Families）架构设计

## 📌 背景

随着系统功能不断扩展，单一的工具注册方式变得难以维护。工具族（Tool Families）模式应运而生，旨在：

1. **模块化管理**: 将相关工具组织成族（如记忆工具族、文件工具族）
2. **动态提示词注入**: 自动将工具描述注入 System Prompt
3. **可扩展性**: 新增工具类别无需修改核心代码
4. **依赖注入**: 每个工具族可独立管理依赖

## 🏗️ 架构设计

### 核心组件

```
IToolFamily (接口)
    ├── get_tools() -> Dict[str, Dict]
    ├── execute(tool_name, arguments) -> str
    ├── get_prompt_injection() -> str
    └── get_config() -> ToolFamilyConfig

IToolProvider (接口)
    ├── get_tools() -> Dict[str, Dict]
    ├── execute(request) -> ToolCallResponse
    ├── is_available(tool_name) -> bool
    ├── get_tool_families() -> List[IToolFamily]
    └── get_all_prompts() -> str

ToolOrchestrator (编排器)
    ├── add_provider(provider, priority)
    ├── get_all_tools() -> Dict[str, Dict]
    ├── execute(request) -> ToolCallResponse
    ├── execute_batch(requests) -> List[ToolCallResponse]
    └── get_all_tool_prompts() -> str
```

### 设计模式

1. **策略模式 (Strategy Pattern)**
   - 不同工具族实现同一接口
   - Orchestrator 根据工具名自动路由

2. **组合模式 (Composite Pattern)**
   - IToolProvider 可包含多个 IToolFamily
   - 形成树状结构

3. **依赖注入 (Dependency Injection)**
   - 通过 FastAPI Depends 机制自动注入
   - 便于测试和 Mock

## 📦 已实现工具族

### 1. 记忆工具族 (Memory Tools)

**功能**:
- `add_memory`: 添加长期记忆
- `search_memories`: 搜索记忆
- `edit_memory`: 编辑记忆
- `summarize_memories`: 总结记忆

**数据模型**:
```sql
CREATE TABLE memories (
    id VARCHAR(26) PRIMARY KEY,
    session_id VARCHAR(26) NOT NULL,
    content TEXT NOT NULL,
    memory_type VARCHAR(50) DEFAULT 'general',
    importance INT DEFAULT 5,
    tags JSON,
    metadata_ JSON,
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_memory_session_id ON memories(session_id);
CREATE INDEX idx_memory_type ON memories(memory_type);
CREATE INDEX idx_memory_importance ON memories(importance);
CREATE INDEX idx_memory_session_type ON memories(session_id, memory_type);
```

**提示词注入**:
```markdown
## 🧠 长期记忆工具

你拥有访问长期记忆的能力...
```

**使用示例**:
```python
# 添加记忆
await family.execute("add_memory", {
    "session_id": "session_123",
    "content": "用户喜欢蓝色",
    "memory_type": "factual",
    "importance": 8,
    "tags": ["偏好", "颜色"]
})

# 搜索记忆
result = await family.execute("search_memories", {
    "session_id": "session_123",
    "query": "颜色"
})
```

## 🔧 如何创建新的工具族

### Step 1: 继承 IToolFamily

```python
from app.services.tools.families.tool_family_base import IToolFamily, ToolFamilyConfig

class MyCustomToolFamily(IToolFamily):
    def get_tools(self) -> Dict[str, Dict[str, Any]]:
        return {
            "my_tool": {
                "type": "object",
                "properties": {...},
                "required": ["param1"],
                "description": "我的自定义工具"
            }
        }
    
    async def execute(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        if tool_name == "my_tool":
            return await self._my_tool(arguments)
        return f"Unknown tool: {tool_name}"
    
    def get_prompt_injection(self) -> str:
        return "## 我的工具描述..."
    
    def get_config(self) -> ToolFamilyConfig:
        return ToolFamilyConfig(enabled=True, priority=10)
```

### Step 2: 创建 IToolProvider 包装器

```python
from app.services.tools.providers.tool_provider_base import IToolProvider

class MyCustomToolProvider(IToolProvider):
    def __init__(self, session: AsyncSession):
        self.session = session
        self.family = MyCustomToolFamily()
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        tools = self.family.get_tools()
        return {f"custom__{k}": v for k, v in tools.items()}
    
    async def execute(self, request) -> ToolCallResponse:
        # 实现执行逻辑
        pass
    
    async def is_available(self, tool_name: str) -> bool:
        tools = await self.get_tools()
        return tool_name in tools
    
    async def get_tool_families(self) -> List[IToolFamily]:
        return [self.family]
    
    async def get_all_prompts(self) -> str:
        return self.family.get_prompt_injection()
```

### Step 3: 注册到依赖注入

```python
# app/dependencies.py

def get_custom_tool_provider(session: AsyncSession = Depends(get_db_session)):
    return MyCustomToolProvider(session)

def get_tool_orchestrator(session: AsyncSession = Depends(get_db_session)):
    orchestrator = ToolOrchestrator()
    orchestrator.add_provider(get_local_tool_provider(), priority=0)
    orchestrator.add_provider(get_custom_tool_provider(session), priority=5)  # ✅ 新增
    orchestrator.add_provider(get_mcp_tool_provider(session), priority=1)
    return orchestrator
```

## 📊 性能影响

| 指标 | 影响 | 优化措施 |
|------|------|----------|
| 提示词长度 | +500-800 tokens | 设置 max_tokens 限制 |
| 工具调用延迟 | < 1ms | 缓存工具 schema |
| 数据库查询 | 增加 | 使用索引优化 |

## 🔮 未来规划

- [ ] 文件工具族 (File Tools)
  - read_file, write_file, search_files, delete_file
- [ ] 网页抓取工具族 (Web Tools)
  - fetch_url, scrape_content, extract_links
- [ ] 数据分析工具族 (Analytics Tools)
  - analyze_data, generate_chart, compute_statistics
- [ ] 向量搜索支持（预留接口）
  - 在 metadata_中存储向量嵌入
  - 集成 FAISS、ChromaDB 或数据库原生向量插件

## 🛠️ 部署说明

### 数据库迁移

**开发环境（SQLite）**:
```bash
cd backend
python create_memory_table.py
```

**生产环境（MySQL）**:
```bash
cd backend
alembic upgrade head
```

### 验证安装

运行单元测试：
```bash
pytest app/tests/test_memory_tools.py -v
```

## ⚠️ 注意事项

1. **会话隔离**: 所有记忆操作都基于 `session_id` 进行隔离
2. **JSON 兼容**: 使用 JSON 字段存储 tags 和 metadata，确保 SQLite 和 MySQL 兼容
3. **级联删除**: 删除 session 时会自动删除关联的记忆
4. **向量搜索**: 预留接口暂未实现，后续可扩展

## 📝 变更记录

- **2026-03-28**: 初始版本，实现记忆工具族
- 基础设施：IToolFamily 接口、ToolOrchestrator 扩展
- 数据模型：Memory 表、Repository 层
- 工具功能：增删改查、总结、搜索
- 提示词注入：动态注入到 System Prompt
