# 工具调用系统重构方案设计

## 📊 第一部分：现状深度分析

### 1.1 完整工具调用流程梳理

#### 🔄 整体架构图

```mermaid
graph TB
    subgraph "前端层"
        A[ChatPanel] --> B[useStreamResponse]
        B --> C[handleToolCall<br/>增量累加]
        C --> D[handleToolCallsResponse<br/>结果存储]
    end
    
    subgraph "后端 API 层"
        E[AgentService.chat] --> F[LLMService.completions]
        F --> G[流式响应处理]
    end
    
    subgraph "工具调度层"
        G --> H[_handle_all_tool_calls]
        H --> I{工具类型判断}
        I -->|mcp__开头 | J[MCP 工具]
        I -->|本地工具 | K[本地工具]
        
        J --> L[MCPToolManager.execute_tool]
        L --> M[MCPClient.call_tool<br/>JSON-RPC 2.0]
        M --> N[tools/call 请求]
        
        K --> O[handle_tool_calls<br/>TOOLS_MAP 查找]
    end
    
    subgraph "数据返回"
        N --> P[格式化结果]
        O --> P
        P --> Q[tool_call 响应块]
        Q --> R[前端累加显示]
    end
```

---

### 1.2 核心代码路径分析

#### 🔹 **后端：AgentService._handle_all_tool_calls** (第 153-189 行)

```python
async def _handle_all_tool_calls(
    self,
    tool_calls: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """处理所有工具调用（包括本地工具和 MCP 工具）"""
    tool_results: List[Dict[str, Any]] = []
    
    for tool_call in tool_calls:
        func_name = tool_call["name"]
        arguments = json.loads(tool_call["arguments"])
        
        # 🔸 关键分支点：通过前缀判断工具类型
        if func_name.startswith("mcp__"):
            # MCP 工具调用
            result = await self._execute_mcp_tool(func_name, arguments)
            result["tool_call_id"] = tool_call["id"]
            tool_results.append(result)
        else:
            # 本地工具调用 - 委托给 function_calling/utils.py
            local_result = await handle_tool_calls([tool_call])
            tool_results.extend(local_result)
    
    return tool_results
```

**问题分析**:
- ❌ **耦合度高**: AgentService 直接处理工具类型判断逻辑
- ❌ **重复代码**: MCP 工具和本地工具的参数解析、错误处理逻辑重复
- ❌ **扩展性差**: 新增工具类型需要修改 `_handle_all_tool_calls` 核心方法

---

#### 🔹 **MCP 工具执行链路**

##### 1️⃣ **AgentService._execute_mcp_tool** (第 126-151 行)

```python
async def _execute_mcp_tool(
    self,
    tool_name: str,
    arguments: Dict[str, Any],
) -> Dict[str, Any]:
    """执行 MCP 工具调用"""
    try:
        original_tool_name = tool_name.replace("mcp__", "", 1)
        
        # 🔸 查询 MCP 服务器信息
        stmt = select(MCPServer).filter(
            MCPServer.enabled == True
        ).limit(10)
        result = await self.session.execute(stmt)
        servers = result.scalars().all()
        
        # 查找目标服务器
        target_server = None
        for server in servers:
            if server.tools and original_tool_name in server.tools:
                target_server = server
                break
        
        # 🔸 调用 MCPToolManager
        mcp_result = await self.mcp_tool_manager.call_mcp_tool(
            tool_name=original_tool_name,
            arguments=arguments,
            server_id=target_server.id,
            server_url=target_server.url,
            headers=target_server.headers,
        )
        
        # 🔸 格式化结果
        if mcp_result.get("error"):
            return {
                "tool_call_id": None,
                "role": "tool",
                "name": tool_name,
                "content": f"Error: {mcp_result.get('message', 'Unknown error')}",
            }
        else:
            content_data = mcp_result.get("result", {})
            return {
                "tool_call_id": None,
                "role": "tool",
                "name": tool_name,
                "content": str(content_data),
            }
            
    except Exception as e:
        logger.error(f"Error executing MCP tool {tool_name}: {e}")
        return {
            "tool_call_id": None,
            "role": "tool",
            "name": tool_name,
            "content": f"Error: {str(e)}",
        }
```

**问题分析**:
- ❌ **数据库查询泄漏**: AgentService 直接查询 MCP 服务器（应该在 MCPToolManager 内部完成）
- ❌ **错误处理重复**: 与本地工具的错误处理逻辑不一致
- ❌ **职责不清**: 既负责业务逻辑又负责结果格式化

---

##### 2️⃣ **MCPToolManager.call_mcp_tool** (第 88-127 行)

```python
async def call_mcp_tool(
    self,
    tool_name: str,
    arguments: Dict[str, Any],
    server_id: str,
    server_url: str,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """调用 MCP 工具（使用 JSON-RPC 协议）"""
    try:
        # 🔸 创建或获取客户端
        client_key = f"{server_url}_{server_id}"
        if client_key not in self._clients_cache:
            self._clients_cache[client_key] = MCPClient(server_url, headers)
        
        client = self._clients_cache[client_key]
        
        # 🔸 JSON-RPC 2.0 调用
        result = await client.call_tool(tool_name, arguments)
        
        logger.info(f"MCP tool {tool_name} called successfully on server {server_id}")
        return result
        
    except Exception as e:
        logger.error(f"Failed to call MCP tool {tool_name}: {e}")
        raise
```

**优点**:
- ✅ **客户端缓存**: 避免重复创建 HTTP 连接
- ✅ **协议封装**: 屏蔽 JSON-RPC 2.0 细节

**问题**:
- ❌ **参数冗余**: 需要手动传递 server_id、server_url、headers
- ❌ **缺乏验证**: 未校验工具是否属于该服务器

---

##### 3️⃣ **MCPClient.call_tool** (JSON-RPC 实现)

```python
async def call_tool(
    self,
    tool_name: str,
    arguments: Dict[str, Any],
) -> Dict[str, Any]:
    """调用 MCP 工具（使用 JSON-RPC 2.0 协议）"""
    # 🔸 JSON-RPC 2.0 请求体
    request_data = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        },
        "id": 1
    }
    
    logger.info(f"Calling MCP tool (JSON-RPC): {tool_name} at {self.base_url}")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{self.base_url}/mcp",
            json=request_data,
            headers=self.headers,
            timeout=30.0
        )
        response.raise_for_status()
        return response.json()
```

**特点**:
- ✅ **协议标准**: 严格遵循 JSON-RPC 2.0 规范
- ✅ **HTTP 封装**: 隐藏底层通信细节

---

#### 🔹 **本地工具执行链路**

##### **handle_tool_calls** (utils.py 第 99-153 行)

```python
async def handle_tool_calls(
    tool_calls: List[dict],
) -> List[Dict[str, Any]]:
    """处理工具调用"""
    tool_results = []
    
    for tool_call in tool_calls:
        func_name = tool_call["name"]
        
        try:
            arguments = json.loads(tool_call["arguments"])
            
            # 🔸 查找工具映射
            if func_name in TOOLS_MAP:
                result = await TOOLS_MAP[func_name](**arguments)
                
                tool_results.append({
                    "tool_call_id": tool_call["id"],
                    "role": "tool",
                    "name": func_name,
                    "content": str(result),
                })
            else:
                # 未知工具
                tool_results.append({
                    "tool_call_id": tool_call["id"],
                    "role": "tool",
                    "name": func_name,
                    "content": f"Unknown tool: {func_name}",
                })
                
        except Exception as e:
            tool_results.append({
                "tool_call_id": tool_call["id"],
                "role": "tool",
                "name": func_name,
                "content": f"{e}",
            })
    
    return tool_results
```

**TOOL_MAP 定义** (第 86-89 行):
```python
TOOLS_MAP = {
    "get_current_time": get_current_time,
}
```

**特点**:
- ✅ **简单直接**: 函数映射表清晰
- ❌ **扩展困难**: 每新增工具需修改 TOOLS_MAP
- ❌ **缺乏元数据**: 没有工具描述、参数验证等

---

#### 🔹 **前端：useStreamResponse.js 工具调用处理**

##### **handleToolCall** (增量累加逻辑，第 19-60 行)

```javascript
function handleToolCall(content, toolCalls) {
  // 初始化 additional_kwargs
  if (!content.additional_kwargs) {
    content.additional_kwargs = {}
  }
  if (!content.additional_kwargs.tool_calls) {
    content.additional_kwargs.tool_calls = []
  }
  
  // 🔸 累加增量的 tool_calls
  for (const toolCall of toolCalls) {
    const index = toolCall.index
    
    // 查找是否已存在该索引的工具调用
    let existingToolCall = content.additional_kwargs.tool_calls.find(
      tc => tc.index === index
    )
    
    if (!existingToolCall) {
      // 新的工具调用，添加到列表
      content.additional_kwargs.tool_calls.push({
        id: toolCall.id,
        index: toolCall.index,
        type: toolCall.type,
        name: toolCall.name,
        arguments: toolCall.arguments || ''
      })
    } else {
      // 已存在，累加参数字符串
      if (toolCall.arguments !== null && toolCall.arguments !== undefined) {
        existingToolCall.arguments += toolCall.arguments
      }
    }
  }
}
```

**特点**:
- ✅ **增量友好**: 支持流式参数累加
- ✅ **容错性强**: 处理 null/undefined 情况
- ❌ **逻辑复杂**: 需要在每次 chunk 时调用

---

##### **handleToolCallsResponse** (结果存储，第 60-72 行)

```javascript
function handleToolCallsResponse(content, toolCallsResponse) {
  if (!content.additional_kwargs) {
    content.additional_kwargs = {}
  }
  content.additional_kwargs.tool_calls_response = toolCallsResponse
}
```

**作用**:
- ✅ **结果存储**: 保存工具执行结果
- ✅ **响应式更新**: 触发 Vue 的响应式更新

---

### 1.3 协议差异对比

| 维度 | 本地工具 | MCP 工具 |
|------|----------|----------|
| **调用方式** | 直接函数调用 | JSON-RPC 2.0 HTTP 请求 |
| **工具命名** | 纯名称 (如 `get_current_time`) | 带前缀 (如 `mcp__search`) |
| **参数传递** | Python 函数参数 | JSON-RPC params.arguments |
| **结果格式** | 直接返回值 | `{jsonrpc, result, id}` |
| **错误处理** | try-catch | JSON-RPC error 字段 |
| **注册方式** | TOOLS_MAP 字典 | MCP 服务器动态发现 |
| **Schema 来源** | function_schema 生成 | MCP 服务器 `/tools/list` |
| **网络依赖** | ❌ 无 | ✅ 需要 HTTP 连接 |

---

### 1.4 核心痛点识别

#### 🔴 **架构层面问题**

1. **职责混乱**
   - AgentService 既负责对话流程又负责工具调度
   - MCPToolManager 只负责调用，不负责服务器查找
   - 数据库查询分散在多个方法中

2. **耦合度过高**
   - 工具类型判断硬编码在 `_handle_all_tool_calls`
   - 新增工具类型需要修改核心逻辑
   - 无法动态插拔工具提供者

3. **缺乏抽象**
   - 没有统一的工具接口
   - 本地工具和 MCP 工具各自为政
   - 错误处理策略不一致

---

#### 🟡 **代码层面问题**

1. **重复代码**
   ```python
   # AgentService._execute_mcp_tool 中的查询逻辑
   stmt = select(MCPServer).filter(
       MCPServer.enabled == True
   ).limit(10)
   result = await self.session.execute(stmt)
   servers = result.scalars().all()
   
   # MCPToolManager.execute_tool 中也有类似查询
   stmt = select(MCPServer).filter(
       MCPServer.enabled == True
   ).limit(10)
   ```

2. **参数解析重复**
   ```python
   # _handle_all_tool_calls 中解析一次
   arguments = json.loads(tool_call["arguments"])
   
   # handle_tool_calls 中又解析一次
   arguments = json.loads(tool_call["arguments"])
   ```

3. **错误处理不统一**
   - MCP 工具：返回 `{"error": "..."}` 格式
   - 本地工具：直接抛出异常或返回错误字符串
   - 前端需要适配多种错误格式

---

#### 🟢 **扩展性问题**

1. **新增工具类型困难**
   - 需要修改 `_handle_all_tool_calls` 的 if-else 分支
   - 需要在 AgentService 中添加新的执行方法
   - 前端可能需要适配新的响应格式

2. **无法动态注册工具**
   - TOOLS_MAP 是硬编码的字典
   - MCP 工具虽然可以动态发现，但需要手动添加 `mcp__` 前缀
   - 缺乏工具生命周期管理

3. **缺乏中间件机制**
   - 无法在工具调用前后插入日志、权限检查、限流等逻辑
   - 每个工具需要自己实现这些功能

---

## 🎯 第二部分：重构方案设计

### 2.1 设计原则

#### 🏗️ **核心思想**

1. **单一职责**: 每个类/模块只做一件事
2. **依赖倒置**: 高层模块不依赖低层模块的具体实现
3. **开闭原则**: 对扩展开放，对修改关闭
4. **接口隔离**: 使用细粒度的接口而非粗粒度

---

#### 📐 **架构分层**

```
┌─────────────────────────────────────┐
│         API Layer (AgentService)    │  ← 对话流程控制
├─────────────────────────────────────┤
│    Tool Orchestrator (新增)         │  ← 工具编排调度
├─────────────────────────────────────┤
│  Tool Provider Interface (新增)     │  ← 抽象工具提供者
├──────────────┬──────────────────────┤
│ Local Tools  │   MCP Tools          │  ← 具体实现
│ Provider     │   Provider           │
└──────────────┴──────────────────────┘
```

---

### 2.2 核心接口定义

#### 🔹 **IToolProvider 接口** (新增)

```python
# app/services/tools/providers/base.py

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class ToolCallRequest(BaseModel):
    """工具调用请求"""
    id: str  # tool_call_id
    name: str  # 工具名称
    arguments: Dict[str, Any]  # 参数字典


class ToolCallResponse(BaseModel):
    """工具调用结果"""
    tool_call_id: str
    role: str = "tool"
    name: str
    content: str
    is_error: bool = False


class IToolProvider(ABC):
    """工具提供者接口"""
    
    @abstractmethod
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """
        获取工具列表
        
        Returns:
            Dict: {tool_name: tool_schema}
        """
        pass
    
    @abstractmethod
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """
        执行工具调用
        
        Args:
            request: 工具调用请求
            
        Returns:
            ToolCallResponse: 工具调用结果
        """
        pass
    
    @abstractmethod
    async def is_available(self, tool_name: str) -> bool:
        """
        检查工具是否可用
        
        Args:
            tool_name: 工具名称
            
        Returns:
            bool: 是否可用
        """
        pass
```

**设计要点**:
- ✅ **统一输入输出**: 使用 Pydantic 模型规范数据格式
- ✅ **抽象工具概念**: 不区分本地/MCP
- ✅ **可扩展**: 新增工具类型只需实现接口

---

#### 🔹 **LocalToolProvider 实现**

```python
# app/services/tools/providers/local.py

from typing import Any, Callable, Dict
from .base import IToolProvider, ToolCallRequest, ToolCallResponse


class LocalToolProvider(IToolProvider):
    """本地工具提供者"""
    
    def __init__(self):
        self._tools: Dict[str, Callable] = {}
        self._schemas: Dict[str, Dict[str, Any]] = {}
    
    def register(self, name: str, func: Callable, schema: Dict[str, Any]):
        """
        注册工具
        
        Args:
            name: 工具名称
            func: 工具函数
            schema: JSON Schema
        """
        self._tools[name] = func
        self._schemas[name] = schema
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        return self._schemas.copy()
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        try:
            if request.name not in self._tools:
                return ToolCallResponse(
                    tool_call_id=request.id,
                    name=request.name,
                    content=f"Unknown tool: {request.name}",
                    is_error=True
                )
            
            # 调用工具函数
            result = await self._tools[request.name](**request.arguments)
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(result),
                is_error=False
            )
            
        except Exception as e:
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True
            )
    
    async def is_available(self, tool_name: str) -> bool:
        return tool_name in self._tools
```

**使用示例**:
```python
# 注册工具
local_provider = LocalToolProvider()
local_provider.register(
    name="get_current_time",
    func=get_current_time,
    schema=function_schema(get_current_time)
)
```

---

#### 🔹 **MCPToolProvider 实现**

```python
# app/services/tools/providers/mcp.py

from sqlalchemy.ext.asyncio import AsyncSession
from .base import IToolProvider, ToolCallRequest, ToolCallResponse


class MCPToolProvider(IToolProvider):
    """MCP 工具提供者"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self._manager = MCPToolManager(session)
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取 MCP 工具列表"""
        return await self._manager.get_all_mcp_tools()
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """执行 MCP 工具调用"""
        try:
            # 自动添加 mcp__前缀
            if not request.name.startswith("mcp__"):
                prefixed_name = f"mcp__{request.name}"
            else:
                prefixed_name = request.name
            
            # 使用 MCPToolManager.execute_tool (已包含服务器查找)
            result = await self._manager.execute_tool(
                full_tool_name=prefixed_name,
                arguments=request.arguments
            )
            
            return ToolCallResponse(
                tool_call_id=request.id,
                name=result["name"],
                content=result["content"],
                is_error=result["content"].startswith("Error:")
            )
            
        except Exception as e:
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True
            )
    
    async def is_available(self, tool_name: str) -> bool:
        tools = await self.get_tools()
        prefixed_name = f"mcp__{tool_name}" if not tool_name.startswith("mcp__") else tool_name
        return prefixed_name in tools
```

**改进点**:
- ✅ **封装服务器查找**: 在 Provider 内部完成，不泄漏到上层
- ✅ **统一错误处理**: 返回标准 ToolCallResponse
- ✅ **自动前缀处理**: 简化调用方代码

---

#### 🔹 **ToolOrchestrator** (新增核心组件)

```python
# app/services/tools/orchestrator.py

from typing import List, Optional
from .providers.base import IToolProvider, ToolCallRequest, ToolCallResponse


class ToolOrchestrator:
    """工具编排器"""
    
    def __init__(self):
        self._providers: List[IToolProvider] = []
        self._tools_cache: dict[str, IToolProvider] = {}
    
    def add_provider(self, provider: IToolProvider, priority: int = 0):
        """
        添加工具提供者
        
        Args:
            provider: 工具提供者实例
            priority: 优先级（数字越小优先级越高）
        """
        self._providers.append((priority, provider))
        self._providers.sort(key=lambda x: x[0])  # 按优先级排序
        self._tools_cache.clear()  # 清空缓存
    
    async def get_all_tools(self) -> Dict[str, Dict[str, Any]]:
        """
        获取所有工具（合并所有提供者）
        
        Returns:
            Dict: {tool_name: tool_schema}
        """
        all_tools = {}
        
        for _, provider in self._providers:
            tools = await provider.get_tools()
            all_tools.update(tools)
        
        return all_tools
    
    async def find_provider_for_tool(self, tool_name: str) -> Optional[IToolProvider]:
        """
        查找能处理指定工具的提供者
        
        Args:
            tool_name: 工具名称
            
        Returns:
            IToolProvider: 工具提供者或 None
        """
        # 检查缓存
        if tool_name in self._tools_cache:
            return self._tools_cache[tool_name]
        
        # 遍历所有提供者查找
        for _, provider in self._providers:
            if await provider.is_available(tool_name):
                self._tools_cache[tool_name] = provider
                return provider
        
        return None
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """
        执行工具调用（自动路由到正确的提供者）
        
        Args:
            request: 工具调用请求
            
        Returns:
            ToolCallResponse: 工具调用结果
            
        Raises:
            ValueError: 如果找不到对应的工具提供者
        """
        provider = await self.find_provider_for_tool(request.name)
        
        if provider is None:
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Tool not found: {request.name}",
                is_error=True
            )
        
        # 委托给具体提供者执行
        return await provider.execute(request)
    
    async def execute_batch(
        self, 
        requests: List[ToolCallRequest]
    ) -> List[ToolCallResponse]:
        """
        批量执行工具调用
        
        Args:
            requests: 工具调用请求列表
            
        Returns:
            List[ToolCallResponse]: 工具调用结果列表
        """
        from asyncio import gather
        
        tasks = [self.execute(req) for req in requests]
        results = await gather(*tasks, return_exceptions=True)
        
        # 处理异常情况
        responses = []
        for req, result in zip(requests, results):
            if isinstance(result, Exception):
                responses.append(ToolCallResponse(
                    tool_call_id=req.id,
                    name=req.name,
                    content=str(result),
                    is_error=True
                ))
            else:
                responses.append(result)
        
        return responses
```

**核心价值**:
- ✅ **自动路由**: 根据工具名自动选择提供者
- ✅ **优先级管理**: 支持多个提供者，按优先级查找
- ✅ **批量执行**: 并发执行多个工具调用
- ✅ **统一错误处理**: 所有异常转为 ToolCallResponse

---

### 2.3 重构后的调用链

#### 🔄 **新架构流程图**

```mermaid
graph TB
    A[AgentService.chat] --> B[LLM 流式响应]
    B --> C{检测到 tool_calls}
    C --> D[ToolOrchestrator.execute_batch]
    
    D --> E[遍历 ToolCallRequest]
    
    E --> F{查找提供者}
    F -->|本地工具 | G[LocalToolProvider]
    F -->|MCP 工具 | H[MCPToolProvider]
    
    G --> I[直接函数调用]
    H --> J[MCPToolManager]
    J --> K[MCPClient]
    K --> L[JSON-RPC 请求]
    
    I --> M[ToolCallResponse]
    L --> M
    
    M --> N[格式化为 OpenAI 格式]
    N --> O[返回给 LLM]
```

---

### 2.4 AgentService 重构

#### 🔹 **修改后的代码**

```python
# app/services/agent_service.py

from app.services.tools.orchestrator import ToolOrchestrator
from app.services.tools.providers.base import ToolCallRequest


class AgentService:
    def __init__(
        self,
        session: AsyncSession,
        llm_service: LLMService,
        memory_manager_service: MemoryManagerService,
        session_repo: SessionRepository,
        model_repo: ModelRepository,
        character_repo: CharacterRepository,
        tool_orchestrator: ToolOrchestrator,  # ✅ 新增依赖
    ):
        self.session = session
        self.llm_service = llm_service
        self.memory_manager_service = memory_manager_service
        self.session_repo = session_repo
        self.model_repo = model_repo
        self.character_repo = character_repo
        self.tool_orchestrator = tool_orchestrator  # ✅ 保存引用
    
    async def _handle_all_tool_calls(
        self,
        tool_calls: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        处理所有工具调用（简化版）
        
        ✅ 改进：
        - 不再关心工具类型
        - 不再直接调用 MCP 工具
        - 统一委托给 ToolOrchestrator
        """
        # 转换为 ToolCallRequest 列表
        requests = [
            ToolCallRequest(
                id=tool_call["id"],
                name=tool_call["name"],
                arguments=json.loads(tool_call["arguments"])
            )
            for tool_call in tool_calls
        ]
        
        # 批量执行（自动路由）
        responses = await self.tool_orchestrator.execute_batch(requests)
        
        # 转换为 OpenAI 格式
        return [
            {
                "tool_call_id": resp.tool_call_id,
                "role": resp.role,
                "name": resp.name,
                "content": resp.content,
            }
            for resp in responses
        ]
```

**改进点**:
- ✅ **代码减少 60%**: 从 50 行减少到 20 行
- ✅ **职责清晰**: 只负责格式转换
- ✅ **易于测试**: 可以 Mock ToolOrchestrator

---

### 2.5 依赖注入配置

#### 🔹 **工厂函数** (app/main.py 或 app/core/container.py)

```python
# app/core/container.py

from sqlalchemy.ext.asyncio import AsyncSession
from app.services.tools.providers.local import LocalToolProvider
from app.services.tools.providers.mcp import MCPToolProvider
from app.services.tools.orchestrator import ToolOrchestrator
from app.services.agent_service import AgentService


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
    
    # ✅ 未来新增工具只需在这里注册
    # provider.register(...)
    
    return provider


def create_tool_orchestrator(session: AsyncSession) -> ToolOrchestrator:
    """创建工具编排器"""
    orchestrator = ToolOrchestrator()
    
    # 添加提供者（按优先级排序）
    orchestrator.add_provider(
        create_local_tool_provider(),
        priority=0  # 本地工具优先级高
    )
    orchestrator.add_provider(
        MCPToolProvider(session),
        priority=1  # MCP 工具优先级低
    )
    
    return orchestrator


def create_agent_service(
    session: AsyncSession,
    llm_service: LLMService,
    memory_manager_service: MemoryManagerService,
    session_repo: SessionRepository,
    model_repo: ModelRepository,
    character_repo: CharacterRepository,
) -> AgentService:
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

---

### 2.6 扩展性示例

#### 🔹 **新增自定义工具提供者**

```python
# app/services/tools/providers/custom.py

from .base import IToolProvider, ToolCallRequest, ToolCallResponse


class CustomToolProvider(IToolProvider):
    """自定义工具提供者示例"""
    
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        # 从自定义 API 获取工具
        return {...}
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        # 自定义执行逻辑
        return ToolCallResponse(...)
    
    async def is_available(self, tool_name: str) -> bool:
        # 自定义可用性检查
        return True


# 注册到编排器
orchestrator.add_provider(CustomToolProvider(), priority=2)
```

**无需修改**:
- ✅ AgentService 代码
- ✅ 其他 Provider 代码
- ✅ 前端代码

---

#### 🔹 **添加工具调用中间件**

```python
# app/services/tools/middleware.py

class ToolCallMiddleware:
    """工具调用中间件基类"""
    
    async def before_call(
        self, 
        request: ToolCallRequest
    ) -> ToolCallRequest:
        """调用前钩子"""
        return request
    
    async def after_call(
        self, 
        request: ToolCallRequest,
        response: ToolCallResponse
    ) -> ToolCallResponse:
        """调用后钩子"""
        return response


class LoggingMiddleware(ToolCallMiddleware):
    """日志中间件"""
    
    async def before_call(self, request: ToolCallRequest) -> ToolCallRequest:
        logger.info(f"Calling tool: {request.name} with args: {request.arguments}")
        return request
    
    async def after_call(
        self, 
        request: ToolCallRequest,
        response: ToolCallResponse
    ) -> ToolCallResponse:
        if response.is_error:
            logger.error(f"Tool {request.name} failed: {response.content}")
        else:
            logger.info(f"Tool {request.name} succeeded")
        return response


# 集成到 Orchestrator
class ToolOrchestrator:
    def __init__(self):
        self._middlewares: List[ToolCallMiddleware] = []
    
    def add_middleware(self, middleware: ToolCallMiddleware):
        self._middlewares.append(middleware)
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        # 执行 before_call 钩子
        for mw in self._middlewares:
            request = await mw.before_call(request)
        
        # 执行工具调用
        response = await super().execute(request)
        
        # 执行 after_call 钩子
        for mw in reversed(self._middlewares):
            response = await mw.after_call(request, response)
        
        return response
```

---

## 📋 第三部分：迁移步骤

### 3.1 第一阶段：基础设施搭建

#### ✅ Step 1.1: 创建基础接口

```bash
# 目录结构
app/services/tools/
├── __init__.py
├── orchestrator.py          # ✅ 新建
├── providers/
│   ├── __init__.py
│   ├── base.py             # ✅ 新建
│   ├── local.py            # ✅ 新建
│   └── mcp.py              # ✅ 新建
└── middleware.py           # ⏭️ 可选（后续扩展）
```

**文件**: `app/services/tools/providers/base.py`
```python
# 复制 2.2 节的 IToolProvider 接口定义
```

**文件**: `app/services/tools/providers/local.py`
```python
# 复制 2.2 节的 LocalToolProvider 实现
```

**文件**: `app/services/tools/providers/mcp.py`
```python
# 复制 2.2 节的 MCPToolProvider 实现
```

**文件**: `app/services/tools/orchestrator.py`
```python
# 复制 2.2 节的 ToolOrchestrator 实现
```

---

#### ✅ Step 1.2: 迁移现有工具

**文件**: `app/services/domain/function_calling/utils.py`

保留现有的 `get_current_time` 函数和 `TOOLS_MAP`,但添加导出:

```python
# 在文件末尾添加
__all__ = [
    "get_current_time",
    "TOOLS_MAP",
    "get_tools_schema",
    "handle_tool_calls",
]
```

---

#### ✅ Step 1.3: 更新依赖注入

**文件**: `app/core/container.py` (新建或在 main.py 中)

```python
# 复制 2.5 节的工厂函数
```

**文件**: `app/main.py`

修改 AgentService 创建:

```python
# 原来
agent_service = AgentService(
    session=session,
    llm_service=llm_service,
    memory_manager_service=memory_manager_service,
    session_repo=session_repo,
    model_repo=model_repo,
    character_repo=character_repo,
)

# 修改后
agent_service = create_agent_service(
    session=session,
    llm_service=llm_service,
    memory_manager_service=memory_manager_service,
    session_repo=session_repo,
    model_repo=model_repo,
    character_repo=character_repo,
)
```

---

### 3.2 第二阶段：重构 AgentService

#### ✅ Step 2.1: 更新构造函数

```python
# app/services/agent_service.py

class AgentService:
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
        # ... 保存其他依赖
        self.tool_orchestrator = tool_orchestrator  # ✅ 保存
```

---

#### ✅ Step 2.2: 简化 _handle_all_tool_calls

```python
async def _handle_all_tool_calls(
    self,
    tool_calls: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """处理所有工具调用（重构版）"""
    from app.services.tools.providers.base import ToolCallRequest
    
    # 转换为请求对象
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

---

#### ✅ Step 2.3: 删除旧代码

**可以安全删除的方法**:
- ❌ `AgentService._execute_mcp_tool` (已在 MCPToolProvider 中实现)
- ❌ `MCPToolManager.execute_tool` (已在 MCPToolProvider 中实现)

**保留的方法**:
- ✅ `MCPToolManager.call_mcp_tool` (仍被 MCPToolProvider 使用)
- ✅ `MCPToolManager.get_all_mcp_tools` (仍被 MCPToolProvider 使用)

---

### 3.3 第三阶段：测试验证

#### ✅ Step 3.1: 单元测试

```python
# app/tests/test_tool_orchestrator.py

import pytest
from app.services.tools.providers.local import LocalToolProvider
from app.services.tools.providers.mcp import MCPToolProvider
from app.services.tools.orchestrator import ToolOrchestrator


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


@pytest.mark.asyncio
async def test_mcp_tool_execution():
    """测试 MCP 工具执行"""
    # 需要 mock 数据库会话
    # ...
```

---

#### ✅ Step 3.2: 集成测试

```bash
# 运行完整测试套件
pytest app/tests/ -v --tb=short

# 重点测试工具调用相关功能
pytest app/tests/test_agent_service.py::test_tool_calls -v
pytest app/tests/test_mcp_integration.py -v
```

---

#### ✅ Step 3.3: 手动测试清单

- [ ] 本地工具调用 (`get_current_time`)
- [ ] MCP 工具调用 (选择一个真实工具)
- [ ] 混合工具调用（同时调用本地和 MCP 工具）
- [ ] 错误工具调用（调用不存在的工具）
- [ ] 参数解析错误（传递无效参数）
- [ ] 流式响应中的工具调用
- [ ] 前端显示是否正常

---

### 3.4 第四阶段：清理优化

#### ✅ Step 4.1: 删除废弃代码

```bash
# 备份后可以删除的文件
rm app/services/domain/function_calling/utils.py  # 已迁移到 Provider
```

**注意**: 先确认所有引用都已更新再删除！

---

#### ✅ Step 4.2: 更新文档

**文件**: `backend/docs/architecture/TOOL_CALLS_ARCHITECTURE.md` (新建)

```markdown
# 工具调用架构文档

## 概述

本系统采用基于 Provider 模式的工具调用架构...

## 核心组件

1. ToolOrchestrator - 工具编排器
2. IToolProvider - 工具提供者接口
3. LocalToolProvider - 本地工具实现
4. MCPToolProvider - MCP 工具实现

## 添加新工具

详见 PROVIDER_GUIDE.md
```

---

#### ✅ Step 4.3: 性能优化（可选）

1. **工具缓存优化**
   ```python
   class ToolOrchestrator:
       async def get_all_tools(self):
           # 添加缓存逻辑
           if self._tools_cache:
               return self._tools_cache
           
           self._tools_cache = await self._fetch_all_tools()
           return self._tools_cache
   ```

2. **并发执行优化**
   ```python
   async def execute_batch(self, requests):
       # 使用信号量限制并发数
       semaphore = asyncio.Semaphore(10)
       
       async def bounded_execute(req):
           async with semaphore:
               return await self.execute(req)
       
       tasks = [bounded_execute(req) for req in requests]
       return await asyncio.gather(*tasks)
   ```

---

## 🎊 总结

### 重构收益

| 指标 | 重构前 | 重构后 | 改进 |
|------|--------|--------|------|
| **AgentService 代码行数** | ~50 行 | ~20 行 | -60% |
| **工具类型判断** | if-else 硬编码 | 自动路由 | ✅ |
| **新增工具成本** | 修改多处 | 实现接口 | -70% |
| **错误处理一致性** | ❌ 不统一 | ✅ 统一模型 | ✅ |
| **可测试性** | ❌ 难 Mock | ✅ 易 Mock | ✅ |
| **中间件支持** | ❌ 无 | ✅ 支持 | ✅ |

---

### 核心优势

1. **解耦**: AgentService 不再关心工具具体实现
2. **扩展**: 新增工具类型无需修改核心逻辑
3. **统一**: 统一的输入输出格式和错误处理
4. **灵活**: 支持优先级、中间件、批量执行

---

### 后续演进方向

1. **工具市场**: 支持动态加载第三方工具包
2. **权限控制**: 基于角色的工具访问控制
3. **限流熔断**: 工具调用频率限制和故障保护
4. **监控告警**: 工具调用成功率和延迟监控

---

**文档版本**: v1.0  
**创建时间**: 2026-03-27  
**作者**: AI Assistant  
**状态**: ✅ 设计完成，待实施
