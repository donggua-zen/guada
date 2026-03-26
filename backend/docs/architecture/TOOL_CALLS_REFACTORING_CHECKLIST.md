# 工具调用系统重构 - 实施检查清单

## 📋 Phase 1: 基础设施搭建 (预计 1-2 天)

### ✅ Step 1.1: 创建目录结构
```bash
cd backend/app/services
mkdir -p tools/providers
touch tools/__init__.py
touch tools/orchestrator.py
touch tools/providers/__init__.py
touch tools/providers/base.py
touch tools/providers/local.py
touch tools/providers/mcp.py
```

**检查项**:
- [ ] 目录结构正确
- [ ] `__init__.py` 文件存在
- [ ] 文件编码为 UTF-8

---

### ✅ Step 1.2: 实现基础接口

**文件**: `tools/providers/base.py`

**检查项**:
- [ ] `IToolProvider` 接口定义完整
- [ ] `ToolCallRequest` Pydantic 模型正确
- [ ] `ToolCallResponse` Pydantic 模型正确
- [ ] 所有抽象方法都有类型注解
- [ ] 文档字符串完整

**代码审查要点**:
```python
# ✅ 必须包含
class IToolProvider(ABC):
    @abstractmethod
    async def get_tools(self) -> Dict[str, Dict[str, Any]]: ...
    
    @abstractmethod
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse: ...
    
    @abstractmethod
    async def is_available(self, tool_name: str) -> bool: ...
```

---

### ✅ Step 1.3: 实现 LocalToolProvider

**文件**: `tools/providers/local.py`

**检查项**:
- [ ] 继承 `IToolProvider`
- [ ] 实现 `register` 方法
- [ ] 正确实现 `get_tools`
- [ ] 正确实现 `execute`
- [ ] 错误处理返回 `is_error=True`
- [ ] 参数验证逻辑完整

**测试用例**:
```python
def test_local_provider():
    provider = LocalToolProvider()
    provider.register("test", lambda: "ok", {})
    
    assert await provider.is_available("test") == True
    assert await provider.get_tools() == {"test": {}}
```

---

### ✅ Step 1.4: 实现 MCPToolProvider

**文件**: `tools/providers/mcp.py`

**检查项**:
- [ ] 注入 `AsyncSession`
- [ ] 使用 `MCPToolManager`
- [ ] 自动添加 `mcp__` 前缀
- [ ] 内部处理服务器查找
- [ ] 错误转换为 `ToolCallResponse`

**依赖检查**:
- [ ] `MCPToolManager` 可用
- [ ] `MCPServer` 模型可访问
- [ ] 数据库会话传递正确

---

### ✅ Step 1.5: 实现 ToolOrchestrator

**文件**: `tools/orchestrator.py`

**检查项**:
- [ ] `add_provider` 支持优先级
- [ ] `get_all_tools` 合并所有 Provider
- [ ] `find_provider_for_tool` 使用缓存
- [ ] `execute` 自动路由
- [ ] `execute_batch` 并发执行
- [ ] 异常处理返回错误响应

**性能关键点**:
```python
# ✅ 必须实现缓存
self._tools_cache: dict[str, IToolProvider] = {}

# ✅ 批量执行使用 gather
results = await asyncio.gather(*tasks, return_exceptions=True)
```

---

### ✅ Step 1.6: 更新导出

**文件**: `tools/__init__.py`

```python
from .orchestrator import ToolOrchestrator
from .providers.base import (
    IToolProvider,
    ToolCallRequest,
    ToolCallResponse
)
from .providers.local import LocalToolProvider
from .providers.mcp import MCPToolProvider

__all__ = [
    "ToolOrchestrator",
    "IToolProvider",
    "ToolCallRequest",
    "ToolCallResponse",
    "LocalToolProvider",
    "MCPToolProvider",
]
```

**检查项**:
- [ ] 所有公共类都导出
- [ ] 循环导入检查通过
- [ ] IDE 可以识别导入

---

## 📋 Phase 2: 重构 AgentService (预计 1 天)

### ✅ Step 2.1: 添加依赖

**文件**: `agent_service.py`

**修改构造函数**:
```python
def __init__(
    self,
    session: AsyncSession,
    llm_service: LLMService,
    memory_manager_service: MemoryManagerService,
    session_repo: SessionRepository,
    model_repo: ModelRepository,
    character_repo: CharacterRepository,
    tool_orchestrator: ToolOrchestrator,  # ✅ 新增
):
    # ... 其他初始化
    self.tool_orchestrator = tool_orchestrator  # ✅ 保存引用
```

**检查项**:
- [ ] 参数类型注解正确
- [ ] 依赖保存为实例变量
- [ ] 文档字符串更新

---

### ✅ Step 2.2: 简化 _handle_all_tool_calls

**原方法** (约 50 行) → **新方法** (约 20 行)

```python
async def _handle_all_tool_calls(
    self,
    tool_calls: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """处理所有工具调用（重构版）"""
    from app.services.tools.providers.base import ToolCallRequest
    
    # 转换为标准请求
    requests = [
        ToolCallRequest(
            id=tc["id"],
            name=tc["name"],
            arguments=json.loads(tc["arguments"])
        )
        for tc in tool_calls
    ]
    
    # 批量执行
    responses = await self.tool_orchestrator.execute_batch(requests)
    
    # 格式化返回
    return [
        {
            "tool_call_id": r.tool_call_id,
            "role": r.role,
            "name": r.name,
            "content": r.content,
        }
        for r in responses
    ]
```

**检查项**:
- [ ] 导入语句正确
- [ ] 列表推导式语法正确
- [ ] 异步调用使用 await
- [ ] 返回格式与原来一致

---

### ✅ Step 2.3: 删除废弃方法

**需要删除的方法**:
- ❌ `_execute_mcp_tool` (已在 MCPToolProvider 中实现)
- ❌ `MCPToolManager.execute_tool` (已在 MCPToolProvider 中实现)

**检查项**:
- [ ] 确认无其他地方调用
- [ ] 备份后再删除
- [ ] 更新文档注释

---

### ✅ Step 2.4: 更新依赖注入

**文件**: `app/core/container.py` (或在 `main.py` 中)

```python
def create_local_tool_provider() -> LocalToolProvider:
    """创建本地工具提供者"""
    from app.services.domain.function_calling.utils import (
        get_current_time,
        function_schema
    )
    
    provider = LocalToolProvider()
    provider.register(
        name="get_current_time",
        func=get_current_time,
        schema=function_schema(get_current_time)
    )
    
    return provider


def create_tool_orchestrator(session: AsyncSession) -> ToolOrchestrator:
    """创建工具编排器"""
    orchestrator = ToolOrchestrator()
    
    orchestrator.add_provider(
        create_local_tool_provider(),
        priority=0
    )
    orchestrator.add_provider(
        MCPToolProvider(session),
        priority=1
    )
    
    return orchestrator


def create_agent_service(...) -> AgentService:
    """创建 AgentService（自动注入依赖）"""
    tool_orchestrator = create_tool_orchestrator(session)
    
    return AgentService(
        session=session,
        llm_service=llm_service,
        memory_manager_service=memory_manager_service,
        session_repo=session_repo,
        model_repo=model_repo,
        character_repo=character_repo,
        tool_orchestrator=tool_orchestrator,  # ✅ 自动注入
    )
```

**检查项**:
- [ ] 工厂函数命名规范
- [ ] 依赖注入顺序正确
- [ ] 循环导入检查

---

## 📋 Phase 3: 测试验证 (预计 1-2 天)

### ✅ Step 3.1: 单元测试

**文件**: `app/tests/test_tool_orchestrator.py`

**测试用例清单**:
- [ ] `test_local_tool_execution` - 本地工具执行
- [ ] `test_mcp_tool_execution` - MCP 工具执行（Mock DB）
- [ ] `test_tool_not_found` - 工具不存在
- [ ] `test_batch_execution` - 批量并发
- [ ] `test_provider_priority` - 优先级机制
- [ ] `test_error_handling` - 错误处理

**示例测试**:
```python
@pytest.mark.asyncio
async def test_local_tool_execution():
    """测试本地工具执行"""
    provider = LocalToolProvider()
    provider.register(
        name="get_current_time",
        func=lambda: "12:00",
        schema={}
    )
    
    orchestrator = ToolOrchestrator()
    orchestrator.add_provider(provider)
    
    response = await orchestrator.execute(
        ToolCallRequest(
            id="1",
            name="get_current_time",
            arguments={}
        )
    )
    
    assert response.is_error == False
    assert "12:00" in response.content
```

**运行命令**:
```bash
pytest app/tests/test_tool_orchestrator.py -v
```

---

### ✅ Step 3.2: 集成测试

**文件**: `app/tests/test_agent_service_integration.py`

**测试场景**:
- [ ] 单次工具调用流程
- [ ] 多次工具调用流程
- [ ] 混合工具调用（本地+MCP）
- [ ] 流式响应中的工具调用
- [ ] 工具调用失败场景

**检查项**:
- [ ] 数据库使用测试库
- [ ] Mock 外部 API 调用
- [ ] 清理测试数据

---

### ✅ Step 3.3: 手动测试清单

**本地工具测试**:
- [ ] 调用 `get_current_time`
- [ ] 验证返回格式
- [ ] 检查前端显示

**MCP 工具测试**:
- [ ] 选择一个真实 MCP 工具
- [ ] 调用并验证结果
- [ ] 检查 HTTP 请求日志

**边界测试**:
- [ ] 调用不存在的工具
- [ ] 传递无效参数
- [ ] 模拟网络超时
- [ ] 并发调用多个工具

**前端验证**:
- [ ] 工具调用卡片显示正常
- [ ] 参数和结果格式正确
- [ ] 错误信息显示正常

---

## 📋 Phase 4: 清理优化 (预计 0.5 天)

### ✅ Step 4.1: 删除废弃代码

**可删除的文件**:
- ❌ `app/services/domain/function_calling/utils.py` (如果完全迁移)

**可删除的方法**:
- ❌ `AgentService._execute_mcp_tool`
- ❌ `MCPToolManager.execute_tool`

**检查项**:
- [ ] 使用 grep 确认无引用
  ```bash
  grep -r "_execute_mcp_tool" app/
  grep -r "execute_tool" app/
  ```
- [ ] 备份后删除
- [ ] 更新 git 仓库

---

### ✅ Step 4.2: 代码优化

**性能优化**:
- [ ] 添加工具缓存 TTL
- [ ] 实现连接池复用
- [ ] 添加限流保护

**代码质量**:
- [ ] 统一日志格式
- [ ] 添加类型注解
- [ ] 完善文档字符串

**安全检查**:
- [ ] 参数验证逻辑
- [ ] SQL 注入防护
- [ ] XSS 防护

---

### ✅ Step 4.3: 文档更新

**新建文档**:
- [ ] `TOOL_CALLS_ARCHITECTURE.md` - 架构说明
- [ ] `PROVIDER_GUIDE.md` - Provider 开发指南
- [ ] `MIGRATION_GUIDE.md` - 迁移指南

**更新文档**:
- [ ] API 文档（Swagger/OpenAPI）
- [ ] README.md
- [ ] 部署文档

---

### ✅ Step 4.4: 监控指标

**添加监控点**:
```python
# 工具调用成功率
metrics.tool_call_success_rate.inc()

# 工具调用延迟
@instrument(duration_metric="tool_call_duration")
async def execute(...):
    ...
```

**检查项**:
- [ ] Prometheus metrics 配置
- [ ] Grafana 仪表板
- [ ] 告警规则设置

---

## 🎯 验收标准

### 功能验收
- [x] 本地工具调用正常
- [ ] MCP 工具调用正常
- [ ] 批量工具调用正常
- [ ] 错误处理符合预期
- [ ] 前端显示正常

### 性能验收
- [ ] 单次调用延迟 <100ms
- [ ] 批量调用并发效率 >80%
- [ ] 内存占用无明显增长
- [ ] CPU 使用率稳定

### 质量验收
- [ ] 单元测试覆盖率 >90%
- [ ] 集成测试全部通过
- [ ] 无 Pylint/MyPy 警告
- [ ] 代码审查通过

### 文档验收
- [ ] 架构文档完整
- [ ] API 文档更新
- [ ] 迁移指南清晰
- [ ] 示例代码可用

---

## ⚠️ 风险控制

### 回滚方案

**Step 1: 保留旧代码**
```python
# 在删除前添加标记
USE_NEW_TOOL_SYSTEM = True  # 配置开关

if USE_NEW_TOOL_SYSTEM:
    # 新实现
else:
    # 旧实现（备份）
```

**Step 2: 快速回滚脚本**
```bash
#!/bin/bash
# rollback.sh
git revert <commit-hash>
systemctl restart backend
```

### 应急预案

**问题发现**:
- 监控告警 → 立即查看日志
- 用户反馈 → 确认影响范围

**响应措施**:
1. 轻微问题 → 修复并部署
2. 严重问题 → 回滚到旧版本
3. 灾难问题 → 停机维护

---

## 📊 进度跟踪

### 任务分解

| 阶段 | 任务数 | 预计工时 | 实际工时 | 完成度 |
|------|--------|----------|----------|--------|
| Phase 1 | 6 | 2 天 | - | 0% |
| Phase 2 | 4 | 1 天 | - | 0% |
| Phase 3 | 3 | 2 天 | - | 0% |
| Phase 4 | 4 | 0.5 天 | - | 0% |
| **总计** | **17** | **5.5 天** | **-** | **0%** |

### 里程碑

- [ ] **M1**: Phase 1 完成（基础设施就绪）
- [ ] **M2**: Phase 2 完成（AgentService 重构）
- [ ] **M3**: Phase 3 完成（测试通过）
- [ ] **M4**: Phase 4 完成（上线部署）

---

**检查清单版本**: v1.0  
**创建时间**: 2026-03-27  
**适用项目**: AI Chat Backend  
**目标读者**: 开发工程师、测试工程师、运维工程师
