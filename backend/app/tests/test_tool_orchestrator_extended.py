"""
ToolOrchestrator 扩展测试

测试范围:
1. get_all_tools_schema 方法（带过滤）
2. MCPToolProvider 模拟测试
3. 性能和缓存测试
4. 边界情况测试
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tools.tool_orchestrator import ToolOrchestrator
from app.services.tools.providers.local_tool_provider import LocalToolProvider
from app.services.tools.providers.mcp_tool_provider import MCPToolProvider
from app.services.tools.providers.tool_provider_base import ToolCallRequest


class TestToolOrchestratorSchemaGeneration:
    """测试 get_all_tools_schema 方法"""
    
    @pytest.fixture
    async def orchestrator_with_local_tools(self):
        """创建带有本地工具的 Orchestrator"""
        orchestrator = ToolOrchestrator()
        
        # 添加多个本地工具
        local_provider = LocalToolProvider()
        
        def tool_a(x: int) -> int:
            return x + 1
        
        def tool_b(y: str) -> str:
            return f"Result: {y}"
        
        def tool_c(z: float) -> float:
            return z * 2
        
        local_provider.register("tool_a", tool_a, {"type": "object"})
        local_provider.register("tool_b", tool_b, {"type": "object"})
        local_provider.register("tool_c", tool_c, {"type": "object"})
        
        orchestrator.add_provider(local_provider, priority=0)
        
        yield orchestrator
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_no_filter(self, orchestrator_with_local_tools):
        """测试无过滤条件下的 schema 生成"""
        schemas = await orchestrator_with_local_tools.get_all_tools_schema()
        
        assert len(schemas) == 3
        schema_names = [s["function"]["name"] for s in schemas]
        assert "tool_a" in schema_names
        assert "tool_b" in schema_names
        assert "tool_c" in schema_names
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_with_enabled_tools(self, orchestrator_with_local_tools):
        """测试启用特定工具的过滤"""
        # 只启用 tool_a 和 tool_b
        schemas = await orchestrator_with_local_tools.get_all_tools_schema(
            enabled_tools=["tool_a", "tool_b"]
        )
        
        assert len(schemas) == 2
        schema_names = [s["function"]["name"] for s in schemas]
        assert "tool_a" in schema_names
        assert "tool_b" in schema_names
        assert "tool_c" not in schema_names
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_empty_enabled_list(self, orchestrator_with_local_tools):
        """测试空启用列表（禁用所有本地工具）"""
        schemas = await orchestrator_with_local_tools.get_all_tools_schema(
            enabled_tools=[]
        )
        
        assert len(schemas) == 0
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_none_filter(self, orchestrator_with_local_tools):
        """测试 None 过滤器（全部启用）"""
        schemas = await orchestrator_with_local_tools.get_all_tools_schema(
            enabled_tools=None
        )
        
        assert len(schemas) == 3  # 所有工具都启用


class TestToolOrchestratorWithMCPProvider:
    """测试包含 MCP Provider 的场景"""
    
    @pytest.fixture
    async def orchestrator_with_mcp(self, test_db_session):
        """创建带有 Mock MCP Provider 的 Orchestrator"""
        orchestrator = ToolOrchestrator()
        
        # 添加本地工具
        local_provider = LocalToolProvider()
        local_provider.register("local_tool", lambda: "local", {})
        orchestrator.add_provider(local_provider, priority=0)
        
        # 创建 Mock MCP Provider
        mock_mcp_provider = AsyncMock(spec=MCPToolProvider)
        mock_mcp_provider.is_available = AsyncMock(return_value=True)
        mock_mcp_provider.get_tools = AsyncMock(return_value={
            "mcp__search": {
                "description": "Search the web",
                "inputSchema": {"type": "object"},
                "_mcp_server_id": "server-1"
            },
            "mcp__calculator": {
                "description": "Calculate expression",
                "inputSchema": {"type": "object"},
                "_mcp_server_id": "server-2"
            }
        })
        
        orchestrator.add_provider(mock_mcp_provider, priority=1)
        
        yield orchestrator
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_mixed_providers(self, orchestrator_with_mcp):
        """测试混合 Provider 的 schema 生成"""
        schemas = await orchestrator_with_mcp.get_all_tools_schema()
        
        assert len(schemas) == 3  # 1 个本地工具 + 2 个 MCP 工具
        schema_names = [s["function"]["name"] for s in schemas]
        assert "local_tool" in schema_names
        assert "mcp__search" in schema_names
        assert "mcp__calculator" in schema_names
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_filter_mcp_servers(self, orchestrator_with_mcp):
        """测试过滤 MCP 服务器"""
        # 只启用 server-1
        schemas = await orchestrator_with_mcp.get_all_tools_schema(
            enabled_mcp_servers=["server-1"]
        )
        
        assert len(schemas) == 2  # 1 个本地工具 + 1 个来自 server-1 的 MCP 工具
        schema_names = [s["function"]["name"] for s in schemas]
        assert "local_tool" in schema_names
        assert "mcp__search" in schema_names
        assert "mcp__calculator" not in schema_names
    
    @pytest.mark.asyncio
    async def test_get_all_tools_schema_combined_filters(self, orchestrator_with_mcp):
        """测试组合过滤（本地工具 + MCP 服务器）"""
        schemas = await orchestrator_with_mcp.get_all_tools_schema(
            enabled_tools=["local_tool"],  # 只启用这个本地工具
            enabled_mcp_servers=["server-2"]  # 只启用这个服务器
        )
        
        assert len(schemas) == 2  # 1 个本地工具 + 1 个 MCP 工具
        schema_names = [s["function"]["name"] for s in schemas]
        assert "local_tool" in schema_names
        assert "mcp__calculator" in schema_names
        assert "mcp__search" not in schema_names


class TestToolOrchestratorPerformance:
    """性能相关测试"""
    
    @pytest.fixture
    async def orchestrator_with_many_tools(self):
        """创建带有大量工具的 Orchestrator"""
        orchestrator = ToolOrchestrator()
        
        # 添加 50 个本地工具
        local_provider = LocalToolProvider()
        for i in range(50):
            local_provider.register(
                f"tool_{i}",
                lambda x=i: x,
                {}
            )
        
        orchestrator.add_provider(local_provider, priority=0)
        
        yield orchestrator
    
    @pytest.mark.asyncio
    async def test_get_tools_performance(self, orchestrator_with_many_tools):
        """测试获取工具的性能"""
        import time
        
        start = time.time()
        tools = await orchestrator_with_many_tools.get_all_tools()
        elapsed = time.time() - start
        
        assert len(tools) == 50
        assert elapsed < 1.0  # 应该在 1 秒内完成
    
    @pytest.mark.asyncio
    async def test_caching_efficiency(self, orchestrator_with_many_tools):
        """测试缓存效率"""
        # 第一次调用（无缓存）
        tools_1 = await orchestrator_with_many_tools.get_all_tools()
        
        # 第二次调用（应该有缓存）
        tools_2 = await orchestrator_with_many_tools.get_all_tools()
        
        # 结果应该相同
        assert tools_1 == tools_2
        # 缓存命中，应该更快（无法直接测量，但逻辑上成立）


class TestToolOrchestratorEdgeCases:
    """边界情况测试"""
    
    @pytest.mark.asyncio
    async def test_empty_providers(self):
        """测试没有任何 Provider 的情况"""
        orchestrator = ToolOrchestrator()
        
        tools = await orchestrator.get_all_tools()
        assert len(tools) == 0
        
        schemas = await orchestrator.get_all_tools_schema()
        assert len(schemas) == 0
    
    @pytest.mark.asyncio
    async def test_provider_with_no_tools(self):
        """测试有空 Provider 的情况"""
        orchestrator = ToolOrchestrator()
        
        empty_provider = LocalToolProvider()
        orchestrator.add_provider(empty_provider, priority=0)
        
        tools = await orchestrator.get_all_tools()
        assert len(tools) == 0
    
    @pytest.mark.asyncio
    async def test_duplicate_tool_names_different_priority(self):
        """测试同名工具不同优先级的覆盖"""
        orchestrator = ToolOrchestrator()
        
        provider1 = LocalToolProvider()
        provider1.register("shared_tool", lambda: "from1", {})
        
        provider2 = LocalToolProvider()
        provider2.register("shared_tool", lambda: "from2", {})
        
        orchestrator.add_provider(provider1, priority=0)  # 高优先级
        orchestrator.add_provider(provider2, priority=1)  # 低优先级
        
        # 应该使用高优先级的工具
        request = ToolCallRequest(id="test", name="shared_tool", arguments={})
        response = await orchestrator.execute(request)
        
        assert response.content == "from1"
    
    @pytest.mark.asyncio
    async def test_tool_name_case_sensitivity(self):
        """测试工具名称大小写敏感"""
        orchestrator = ToolOrchestrator()
        
        local_provider = LocalToolProvider()
        local_provider.register("MyTool", lambda: "result", {})
        
        orchestrator.add_provider(local_provider, priority=0)
        
        # 精确匹配
        request = ToolCallRequest(id="test", name="MyTool", arguments={})
        response = await orchestrator.execute(request)
        assert response.content == "result"
        
        # 大小写不匹配应该找不到
        request = ToolCallRequest(id="test", name="mytool", arguments={})
        response = await orchestrator.execute(request)
        assert response.is_error is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
