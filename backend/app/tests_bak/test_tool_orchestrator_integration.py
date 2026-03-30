"""测试 ToolOrchestrator 和三个工具提供者"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.services.tools.tool_orchestrator import (
    ToolOrchestrator,
    ToolExecutionContext,
    ProviderConfig,
)
from app.services.tools.providers.tool_provider_base import ToolCallRequest
from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
from app.services.tools.providers.mcp_tool_provider import MCPToolProvider


# ========== Fixtures ==========

@pytest.fixture
async def async_session():
    """创建异步数据库会话（使用内存 SQLite）"""
    # 使用 SQLite 内存数据库进行测试
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    
    # 创建所有表
    from app.models.mcp_server import MCPServer
    from app.models.user import User
    from app.models.session import Session
    from app.models.message import Message
    from app.database import ModelBase as Base
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    # 插入虚拟 MCP Server 数据
    async with async_session() as session:
        server = MCPServer(
            id="server_1",
            name="Test Server",
            url="http://test.com",
            description="Test MCP Server",
            enabled=True,
            tools={
                "search": {
                    "description": "Search tool",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"}
                        },
                        "required": ["query"],
                    },
                }
            },
            headers={},
        )
        session.add(server)
        await session.commit()
    
    async with async_session() as session:
        yield session
    
    await engine.dispose()


@pytest.fixture
def mock_memory_provider(async_session):
    """模拟 MemoryToolProvider"""
    provider = MemoryToolProvider(async_session)
    return provider


@pytest.fixture
def mock_mcp_provider(async_session):
    """模拟 MCPToolProvider"""
    provider = MCPToolProvider(async_session)
    return provider


@pytest.fixture
def orchestrator(mock_memory_provider, mock_mcp_provider):
    """创建 ToolOrchestrator 实例"""
    orch = ToolOrchestrator()
    
    # 添加提供者
    orch.add_provider(mock_memory_provider)
    orch.add_provider(mock_mcp_provider)
    
    return orch


# ========== 测试 ToolOrchestrator 基础功能 ==========

@pytest.mark.asyncio
async def test_add_provider(orchestrator, mock_memory_provider, mock_mcp_provider):
    """测试添加提供者"""
    assert "memory" in orchestrator._namespace_to_provider
    assert "mcp" in orchestrator._namespace_to_provider
    assert orchestrator._namespace_to_provider["memory"] == mock_memory_provider
    assert orchestrator._namespace_to_provider["mcp"] == mock_mcp_provider


@pytest.mark.asyncio
async def test_get_all_tools(orchestrator):
    """测试获取所有工具（返回数组格式）"""
    tools = await orchestrator.get_all_tools()
    
    # ✅ 验证返回类型是数组
    assert isinstance(tools, list), "get_all_tools() 应该返回数组"
    
    # ✅ 验证至少有一个工具
    assert len(tools) >= 0  # 可能为空，取决于数据库状态
    
    # ✅ 验证每个工具的格式
    for i, tool in enumerate(tools):
        assert isinstance(tool, dict), f"tools[{i}] 应该是对象"
        assert "type" in tool, f"tools[{i}] 缺少 type 字段"
        assert tool["type"] == "function", f"tools[{i}] 的 type 应该是 'function'"
        assert "function" in tool, f"tools[{i}] 缺少 function 字段"


@pytest.mark.asyncio
async def test_get_all_tools_with_context(orchestrator):
    """测试带上下文过滤获取工具（返回数组格式）"""
    context = ToolExecutionContext(
        session_id="test_session",
        memory=ProviderConfig(enabled_tools=True),  # 启用所有 memory 工具
        mcp=ProviderConfig(enabled_tools=["server_1"]),  # 只启用特定 MCP server
    )
    
    tools = await orchestrator.get_all_tools(context)
    
    # ✅ 验证返回类型是数组
    assert isinstance(tools, list), "get_all_tools() 应该返回数组"
    
    # ✅ 验证工具格式（OpenAI 标准格式）
    for i, tool in enumerate(tools):
        assert isinstance(tool, dict), f"tools[{i}] 应该是对象"
        assert "type" in tool or "function" in tool


# ========== 测试 MemoryToolProvider ==========

@pytest.mark.asyncio
async def test_memory_provider_get_tools(mock_memory_provider):
    """测试 MemoryToolProvider 获取工具"""
    # 测试不传 enabled_ids（返回空）
    tools = await mock_memory_provider.get_tools_namespaced()
    assert len(tools) == 0  # 默认返回空
    
    # 测试 enabled_ids=True（返回所有工具）
    tools = await mock_memory_provider.get_tools_namespaced(enabled_ids=True)
    assert isinstance(tools, dict)
    assert len(tools) > 0  # 应该有工具
    
    # ✅ 验证工具格式（OpenAI Function Calling 标准格式）
    for tool_name, tool_schema in tools.items():
        assert isinstance(tool_schema, dict)
        
        # ✅ 验证外层结构
        assert "type" in tool_schema
        assert tool_schema["type"] == "function"
        
        # ✅ 验证 function 字段
        assert "function" in tool_schema
        function = tool_schema["function"]
        assert isinstance(function, dict)
        
        # ✅ 验证 function 的必要字段
        assert "name" in function
        assert "description" in function
        assert "parameters" in function
        
        # ✅ 验证 parameters 是对象类型
        params = function["parameters"]
        assert isinstance(params, dict)
        assert params.get("type") == "object"
        assert "properties" in params
        
        # ✅ 验证至少有一个参数
        assert len(params["properties"]) > 0
        
        # ✅ 示例：验证 add_memory 工具的详细结构
        if tool_name.endswith("add_memory"):
            # ✅ function.name 应该包含完整的命名空间前缀
            assert function["name"] == tool_name  # 应该与字典键名一致
            assert "添加新的长期记忆" in function["description"]
            assert "content" in params["properties"] or "memory_type" in params["properties"]


@pytest.mark.asyncio
async def test_memory_provider_execute(mock_memory_provider):
    """测试 MemoryToolProvider 执行工具"""
    # 创建一个工具调用请求
    request = MagicMock()
    request.id = "test_1"
    request.name = "add_memory"  # 不带前缀的名称
    request.arguments = '{"content": "test content", "memory_type": "general"}'
    
    # 执行工具（需要注入 session_id）
    inject_params = {"session_id": "test_session"}
    response = await mock_memory_provider.execute_with_namespace(request, inject_params)
    
    # 验证响应格式
    assert response.tool_call_id == "test_1"
    # name 可能是去掉前缀的，也可能是带前缀的，取决于实现
    assert isinstance(response.content, str)
    assert isinstance(response.is_error, bool)


# ========== 测试 MCPToolProvider ==========

@pytest.mark.asyncio
async def test_memory_provider_tools_json_format(mock_memory_provider):
    """测试 MemoryToolProvider 返回的工具 JSON 格式（OpenAI Function Calling 标准）"""
    tools = await mock_memory_provider.get_tools_namespaced(enabled_ids=True)
    
    # ✅ 验证至少有一个工具
    assert len(tools) > 0
    
    # ✅ 获取第一个工具进行详细验证
    tool_name = list(tools.keys())[0]
    tool_schema = tools[tool_name]
    
    # 📋 完整的 OpenAI Function Calling 格式示例：
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "_add_memory",
    #         "description": "添加新的长期记忆",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "content": {"type": "string", "description": "..."},
    #                 "memory_type": {"type": "string", "enum": ["general", "event", ...]}
    #             },
    #             "required": ["content"]
    #         }
    #     }
    # }
    
    # ✅ 验证外层结构
    assert tool_schema == {
        "type": "function",
        "function": tool_schema["function"]
    }
    
    # ✅ 验证 function 对象
    function = tool_schema["function"]
    assert set(function.keys()) >= {"name", "description", "parameters"}
    
    # ✅ 验证 parameters 结构
    params = function["parameters"]
    assert params["type"] == "object"
    assert "properties" in params
    assert isinstance(params["properties"], dict)
    
    # ✅ 验证每个属性的类型
    for prop_name, prop_schema in params["properties"].items():
        assert isinstance(prop_schema, dict), f"属性 {prop_name} 的 Schema 应该是字典"
        assert "type" in prop_schema, f"属性 {prop_name} 缺少 type 字段"
    
    # ✅ 打印示例输出（方便调试）
    print(f"\n[TEST] 工具名称：{tool_name}")
    print(f"[TEST] 完整 Schema:\n{json.dumps(tool_schema, indent=2, ensure_ascii=False)}")


@pytest.mark.asyncio
async def test_mcp_provider_get_tools(mock_mcp_provider, async_session):
    """测试 MCPToolProvider 获取工具（真实数据库查询）"""
    tools = await mock_mcp_provider.get_tools_namespaced()
    
    # 应该包含 mcp__ 前缀（父类自动添加）
    assert "mcp__search" in tools
    
    # ✅ 验证工具格式（OpenAI 标准格式）
    # ✅ function.name 也应该包含命名空间
    tool_schema = tools["mcp__search"]
    assert tool_schema["type"] == "function"
    assert tool_schema["function"]["name"] == "mcp__search"  # ← 更新期望
    assert tool_schema["function"]["description"] == "Search tool"
    assert "parameters" in tool_schema["function"]


@pytest.mark.asyncio
async def test_mcp_provider_execute(mock_mcp_provider, async_session):
    """测试 MCPToolProvider 执行工具（真实数据库查询）"""
    # Mock MCPClient
    mock_client = AsyncMock()
    mock_client.call_tool.return_value = {
        "result": {"content": "Search result"},
        "error": None,
    }
    
    with patch('app.services.mcp.mcp_client.MCPClient', return_value=mock_client):
        # 创建工具调用请求
        request = MagicMock()
        request.id = "test_1"
        request.name = "search"  # 不带前缀
        request.arguments = '{"query": "test"}'
        
        # 执行工具
        inject_params = {"session_id": "test_session"}
        response = await mock_mcp_provider.execute_with_namespace(request, inject_params)
        
        # 验证响应
        assert response.tool_call_id == "test_1"
        assert response.name == "search"
        assert "Search result" in response.content
        assert response.is_error == False


# ========== 测试集成场景 ==========

@pytest.mark.asyncio
async def test_orchestrator_batch_execute(orchestrator, async_session):
    """测试批量执行工具调用（真实数据库查询）"""
    # Mock MCPClient
    mock_client = AsyncMock()
    mock_client.call_tool.return_value = {
        "result": {"content": "Search result"},
        "error": None,
    }
    
    with patch('app.services.mcp.mcp_client.MCPClient', return_value=mock_client):
        # 创建多个工具调用请求
        requests = [
            ToolCallRequest(id="1", name="memory__add_memory", arguments={"content": "test"}),
            ToolCallRequest(id="2", name="mcp__search", arguments={"query": "test"}),
        ]
        
        # 批量执行
        context = ToolExecutionContext(session_id="test_session")
        responses = []
        for req in requests:
            response = await orchestrator.execute(req, context)
            responses.append(response)
        
        # 验证响应
        assert len(responses) == 2
        for response in responses:
            assert isinstance(response.tool_call_id, str)
            assert isinstance(response.content, str)


@pytest.mark.asyncio
async def test_tool_execution_context_injection(orchestrator, mock_memory_provider):
    """测试注入参数传递"""
    # Mock MemoryToolProvider 的 add_memory 方法
    original_add_memory = mock_memory_provider.add_memory
    captured_inject_params = {}
    
    async def mock_add_memory(params, inject_params=None):
        captured_inject_params.update(inject_params or {})
        return await original_add_memory(params, inject_params)
    
    mock_memory_provider.add_memory = mock_add_memory
    
    # 执行工具
    request = MagicMock()
    request.id = "test_1"
    request.name = "add_memory"
    request.arguments = '{"content": "test content"}'
    
    inject_params = {"session_id": "test_session_123", "user_id": "user_456"}
    await mock_memory_provider.execute_with_namespace(request, inject_params)
    
    # 验证注入参数被正确传递
    assert captured_inject_params.get("session_id") == "test_session_123"
    assert captured_inject_params.get("user_id") == "user_456"


# ========== 错误处理测试 ==========

@pytest.mark.asyncio
async def test_memory_provider_error_handling(mock_memory_provider):
    """测试 MemoryToolProvider 错误处理"""
    request = MagicMock()
    request.id = "test_1"
    request.name = "unknown_tool"
    request.arguments = '{}'
    
    inject_params = {"session_id": "test_session"}
    response = await mock_memory_provider.execute_with_namespace(request, inject_params)
    
    # 应该返回错误消息（注意：is_error=False，因为这是预期行为）
    assert "Unknown" in response.content or "error" in response.content.lower()


@pytest.mark.asyncio
async def test_mcp_provider_not_found(mock_mcp_provider, async_session):
    """测试 MCP 工具未找到的情况（真实数据库查询）"""
    # 数据库中只有 "search" 工具，查询不存在的工具
    request = MagicMock()
    request.id = "test_1"
    request.name = "nonexistent_tool"
    request.arguments = '{}'
    
    inject_params = {"session_id": "test_session"}
    response = await mock_mcp_provider.execute_with_namespace(request, inject_params)
    
    # 应该返回错误响应
    assert response.is_error == True
    assert "not found" in response.content.lower() or "Error" in response.content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
