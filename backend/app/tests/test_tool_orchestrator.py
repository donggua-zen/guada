"""
工具调用系统重构 - 单元测试

测试范围:
1. LocalToolProvider 基本功能
2. ToolOrchestrator 路由和批量执行
3. AgentService 集成（需要进一步完成）
"""

import pytest
from app.services.tools.providers.tool_provider_base import ToolCallRequest, ToolCallResponse
from app.services.tools.providers.local_tool_provider import LocalToolProvider
from app.services.tools.tool_orchestrator import ToolOrchestrator


class TestLocalToolProvider:
    """测试 LocalToolProvider"""
    
    @pytest.mark.asyncio
    async def test_register_and_execute(self):
        """测试工具注册和执行"""
        provider = LocalToolProvider()
        
        # 注册一个简单的工具
        def simple_tool(x: int) -> int:
            return x * 2
        
        provider.register(
            name="simple_tool",
            func=simple_tool,
            schema={"type": "object", "properties": {"x": {"type": "integer"}}}
        )
        
        # 执行工具
        request = ToolCallRequest(
            id="test-1",
            name="simple_tool",
            arguments={"x": 5}
        )
        
        response = await provider.execute(request)
        
        assert response.tool_call_id == "test-1"
        assert response.name == "simple_tool"
        assert response.is_error == False
        assert response.content == "10"
    
    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        """测试未知工具处理"""
        provider = LocalToolProvider()
        
        request = ToolCallRequest(
            id="test-2",
            name="unknown_tool",
            arguments={}
        )
        
        response = await provider.execute(request)
        
        assert response.is_error == True
        assert "Unknown tool" in response.content
    
    @pytest.mark.asyncio
    async def test_async_function(self):
        """测试异步函数支持"""
        provider = LocalToolProvider()
        
        async def async_tool(value: str) -> str:
            return f"Async: {value}"
        
        provider.register(
            name="async_tool",
            func=async_tool,
            schema={}
        )
        
        request = ToolCallRequest(
            id="test-3",
            name="async_tool",
            arguments={"value": "hello"}
        )
        
        response = await provider.execute(request)
        
        assert response.is_error == False
        assert "Async: hello" in response.content


class TestToolOrchestrator:
    """测试 ToolOrchestrator"""
    
    @pytest.mark.asyncio
    async def test_add_provider_and_get_tools(self):
        """测试添加提供者和获取工具"""
        orchestrator = ToolOrchestrator()
        
        # 添加本地工具提供者
        local_provider = LocalToolProvider()
        local_provider.register(
            name="test_tool",
            func=lambda: "ok",
            schema={}
        )
        
        orchestrator.add_provider(local_provider, priority=0)
        
        # 获取所有工具
        tools = await orchestrator.get_all_tools()
        
        assert "test_tool" in tools
    
    @pytest.mark.asyncio
    async def test_find_provider(self):
        """测试查找提供者"""
        orchestrator = ToolOrchestrator()
        
        local_provider = LocalToolProvider()
        local_provider.register(name="local_tool", func=lambda: "ok", schema={})
        
        orchestrator.add_provider(local_provider, priority=0)
        
        # 查找提供者
        provider = await orchestrator.find_provider_for_tool("local_tool")
        
        assert provider is not None
        assert isinstance(provider, LocalToolProvider)
    
    @pytest.mark.asyncio
    async def test_batch_execution(self):
        """测试批量执行"""
        orchestrator = ToolOrchestrator()
        
        local_provider = LocalToolProvider()
        local_provider.register(name="tool1", func=lambda x: x + 1, schema={})
        local_provider.register(name="tool2", func=lambda x: x * 2, schema={})
        
        orchestrator.add_provider(local_provider, priority=0)
        
        # 批量请求
        requests = [
            ToolCallRequest(id="batch-1", name="tool1", arguments={"x": 5}),
            ToolCallRequest(id="batch-2", name="tool2", arguments={"x": 3}),
        ]
        
        responses = await orchestrator.execute_batch(requests)
        
        assert len(responses) == 2
        assert responses[0].content == "6"  # 5 + 1
        assert responses[1].content == "6"  # 3 * 2
    
    @pytest.mark.asyncio
    async def test_priority_order(self):
        """测试优先级顺序"""
        orchestrator = ToolOrchestrator()
        
        # 添加两个同名工具，优先级不同
        provider1 = LocalToolProvider()
        provider1.register(name="shared_tool", func=lambda: "from1", schema={})
        
        provider2 = LocalToolProvider()
        provider2.register(name="shared_tool", func=lambda: "from2", schema={})
        
        orchestrator.add_provider(provider1, priority=0)  # 高优先级
        orchestrator.add_provider(provider2, priority=1)  # 低优先级
        
        # 应该使用高优先级的工具
        request = ToolCallRequest(id="priority-test", name="shared_tool", arguments={})
        response = await orchestrator.execute(request)
        
        assert response.content == "from1"


# 集成测试示例（需要数据库支持）
# class TestAgentServiceIntegration:
#     """测试 AgentService 集成"""
#     
#     @pytest.mark.asyncio
#     async def test_handle_all_tool_calls(self):
#         """测试新的 _handle_all_tool_calls 实现"""
#         # 需要创建完整的依赖环境
#         # 这是后续工作
#         pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
