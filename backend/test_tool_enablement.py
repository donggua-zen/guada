"""
测试工具启用状态和 ID 转换功能

验证:
1. resolve_enabled_tools() 方法正常工作
2. MCP Provider 的 ID 转换逻辑
3. ToolOrchestrator 的工具启用检查
"""

import asyncio
from typing import Any, Dict, List, Optional, Union
from app.services.tools.providers.tool_provider_base import IToolProvider
from app.services.tools.tool_orchestrator import (
    ToolOrchestrator, 
    ToolExecutionContext, 
    ProviderConfig,
    ToolCallRequest,
)


class MockProvider(IToolProvider):
    """模拟 Provider 用于测试"""
    
    def __init__(self, namespace: str, tools: dict):
        self._namespace = namespace
        self._tools = tools
    
    @property
    def namespace(self) -> str:
        return self._namespace
    
    async def get_tools_namespaced(self, enabled_ids: Optional[Union[list, bool]] = None) -> dict:
        # 如果明确禁用（False 或空列表），返回空字典
        if enabled_ids is False or enabled_ids == []:
            return {}
        
        # 如果有 enabled_ids 列表，进行过滤
        if isinstance(enabled_ids, list):
            filtered_tools = {
                name: schema 
                for name, schema in self._tools.items() 
                if name in enabled_ids
            }
        else:
            # None 或 True，返回所有工具
            filtered_tools = self._tools
        
        # 如果有命名空间，添加前缀
        if self.namespace:
            return {
                f"{self.namespace}__{name}": schema 
                for name, schema in filtered_tools.items()
            }
        return filtered_tools
    
    async def execute_with_namespace(self, request: ToolCallRequest) -> "ToolCallResponse":
        from app.services.tools.providers.tool_provider_base import ToolCallResponse
        # 移除命名空间前缀
        if self.namespace and request.name.startswith(f"{self.namespace}__"):
            stripped_name = request.name[len(self.namespace) + 2:]
            request = ToolCallRequest(
                id=request.id,
                name=stripped_name,
                arguments=request.arguments,
            )
        
        return await self._execute_internal(request)
    
    async def _execute_internal(self, request: ToolCallRequest) -> "ToolCallResponse":
        from app.services.tools.providers.tool_provider_base import ToolCallResponse
        return ToolCallResponse(
            tool_call_id=request.id,
            name=request.name,
            content=f"Executed {request.name}",
            is_error=False,
        )
    
    async def is_available(self, tool_name: str) -> bool:
        return tool_name in self._tools


async def test_resolve_enabled_tools():
    """测试 resolve_enabled_tools() 方法"""
    print("\n=== Test 1: resolve_enabled_tools() ===")
    
    # 创建模拟 Provider
    provider = MockProvider("test", {
        "tool1": {"name": "tool1"},
        "tool2": {"name": "tool2"},
        "tool3": {"name": "tool3"},
    })
    
    # 测试 1: enabled_ids=None，返回所有工具
    result = await provider.resolve_enabled_tools(None)
    assert result == ["tool1", "tool2", "tool3"], f"Expected all tools, got {result}"
    print("✅ Test 1.1 passed: enabled_ids=None returns all tools")
    
    # 测试 2: enabled_ids 为列表，返回过滤后的工具
    result = await provider.resolve_enabled_tools(["tool1", "tool3"])
    assert result == ["tool1", "tool3"], f"Expected filtered tools, got {result}"
    print("✅ Test 1.2 passed: enabled_ids filters tools correctly")
    
    # 测试 3: enabled_ids 为空列表，返回空
    result = await provider.resolve_enabled_tools([])
    assert result == [], f"Expected empty list, got {result}"
    print("✅ Test 1.3 passed: enabled_ids=[] returns empty list")


async def test_tool_context():
    """测试 ToolExecutionContext"""
    print("\n=== Test 2: ToolExecutionContext ===")
    
    context = ToolExecutionContext(
        session_id="session_123",
        mcp=ProviderConfig(enabled_tools=["id1", "id2"]),
        local=ProviderConfig(enabled_tools=["get_time"]),
        memory=ProviderConfig(enabled_tools=True),
    )
    
    # 测试获取配置
    mcp_config = context.get_provider_config("mcp")
    assert mcp_config is not None, "Expected MCP config"
    assert mcp_config.enabled_tools == ["id1", "id2"], f"Expected ['id1', 'id2'], got {mcp_config.enabled_tools}"
    print("✅ Test 2.1 passed: get_provider_config('mcp') works")
    
    local_config = context.get_provider_config("local")
    assert local_config is not None, "Expected Local config"
    assert local_config.enabled_tools == ["get_time"], f"Expected ['get_time'], got {local_config.enabled_tools}"
    print("✅ Test 2.2 passed: get_provider_config('local') works")
    
    memory_config = context.get_provider_config("memory")
    assert memory_config is not None, "Expected Memory config"
    assert memory_config.enabled_tools is True, f"Expected True, got {memory_config.enabled_tools}"
    print("✅ Test 2.3 passed: get_provider_config('memory') works")


async def test_orchestrator_execute():
    """测试 ToolOrchestrator.execute()"""
    print("\n=== Test 3: Orchestrator Execute ===")
    
    # 创建 Orchestrator 并添加 Provider
    orchestrator = ToolOrchestrator()
    orchestrator.add_provider(MockProvider("local", {
        "get_time": {"name": "get_time"},
        "get_weather": {"name": "get_weather"},
    }))
    orchestrator.add_provider(MockProvider("memory", {
        "add": {"name": "add"},
        "search": {"name": "search"},
    }))
    
    # 创建上下文（只启用部分工具）
    context = ToolExecutionContext(
        session_id="session_123",
        local=ProviderConfig(enabled_tools=["get_time"]),  # 只启用 get_time
        memory=ProviderConfig(enabled_tools=True),  # 启用所有
    )
    
    # 测试 1: 执行已启用的工具
    request = ToolCallRequest(
        id="call_1",
        name="local__get_time",
        arguments={},
    )
    response = await orchestrator.execute(request, context)
    assert response.is_error is False, f"Expected success, got error: {response.content}"
    print("✅ Test 3.1 passed: Execute enabled tool")
    
    # 测试 2: 执行未启用的工具
    request = ToolCallRequest(
        id="call_2",
        name="local__get_weather",
        arguments={},
    )
    response = await orchestrator.execute(request, context)
    assert response.is_error is True, f"Expected error for disabled tool"
    assert "not enabled" in response.content.lower(), f"Expected 'not enabled' error, got: {response.content}"
    print("✅ Test 3.2 passed: Execute disabled tool returns error")
    
    # 测试 3: 执行已启用的 memory 工具
    request = ToolCallRequest(
        id="call_3",
        name="memory__add",
        arguments={},
    )
    response = await orchestrator.execute(request, context)
    assert response.is_error is False, f"Expected success, got error: {response.content}"
    print("✅ Test 3.3 passed: Execute enabled memory tool")


async def test_orchestrator_get_all_tools():
    """测试 ToolOrchestrator.get_all_tools()"""
    print("\n=== Test 4: Orchestrator Get All Tools ===")
    
    orchestrator = ToolOrchestrator()
    orchestrator.add_provider(MockProvider("local", {
        "get_time": {"name": "get_time"},
        "get_weather": {"name": "get_weather"},
    }))
    orchestrator.add_provider(MockProvider("memory", {
        "add": {"name": "add"},
        "search": {"name": "search"},
    }))
    
    # 测试 1: 无上下文，返回所有工具
    all_tools = await orchestrator.get_all_tools()
    assert len(all_tools) == 4, f"Expected 4 tools, got {len(all_tools)}"
    assert "local__get_time" in all_tools
    assert "local__get_weather" in all_tools
    assert "memory__add" in all_tools
    assert "memory__search" in all_tools
    print("✅ Test 4.1 passed: Get all tools without context")
    
    # 测试 2: 有上下文，只返回启用的工具
    context = ToolExecutionContext(
        session_id="session_123",
        local=ProviderConfig(enabled_tools=["get_time"]),
        memory=ProviderConfig(enabled_tools=True),
    )
    all_tools = await orchestrator.get_all_tools(context)
    assert len(all_tools) == 3, f"Expected 3 tools with filtering, got {len(all_tools)}: {all_tools.keys()}"
    assert "local__get_time" in all_tools
    assert "local__get_weather" not in all_tools, "get_weather should be disabled"
    assert "memory__add" in all_tools
    assert "memory__search" in all_tools
    print("✅ Test 4.2 passed: Get filtered tools with context")


async def main():
    """运行所有测试"""
    print("=" * 60)
    print("🧪 Testing Tool Enablement & ID Conversion")
    print("=" * 60)
    
    try:
        await test_resolve_enabled_tools()
        await test_tool_context()
        await test_orchestrator_execute()
        await test_orchestrator_get_all_tools()
        
        print("\n" + "=" * 60)
        print("✅ All tests passed!")
        print("=" * 60)
        
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        raise
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
