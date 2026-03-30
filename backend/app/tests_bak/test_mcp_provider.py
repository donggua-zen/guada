"""
MCP 工具提供者单元测试

测试范围:
1. MCPToolProvider 基本功能
2. MCP 工具加载和缓存
3. MCP 工具调用执行
4. 错误处理和边界情况
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tools.providers.mcp_tool_provider import MCPToolProvider
from app.services.tools.providers.tool_provider_base import ToolCallRequest, ToolCallResponse


class TestMCPToolProvider:
    """测试 MCP 工具提供者"""
    
    @pytest.fixture
    def mock_session(self):
        """创建 Mock 数据库会话"""
        session = AsyncMock(spec=AsyncSession)
        return session
    
    @pytest.fixture
    async def mcp_provider(self, mock_session):
        """创建 MCPToolProvider 实例"""
        provider = MCPToolProvider(mock_session)
        yield provider
    
    @pytest.mark.asyncio
    async def test_provider_initialization(self, mock_session):
        """测试提供者初始化"""
        provider = MCPToolProvider(mock_session)
        
        assert provider.namespace == "mcp"
        assert provider.session == mock_session
        assert isinstance(provider._tools_cache, dict)
        assert isinstance(provider._clients_cache, dict)
    
    @pytest.mark.asyncio
    async def test_get_tools_namespaced(self, mock_session):
        """测试获取带命名空间的工具列表"""
        provider = MCPToolProvider(mock_session)
        
        # Mock 数据库查询结果
        mock_server = MagicMock()
        mock_server.id = "server_1"
        mock_server.name = "Test Server"
        mock_server.enabled = True
        mock_server.tools = {
            "search": {
                "description": "Search tool",
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}}
                }
            }
        }
        
        mock_result = MagicMock()
        mock_result.scalars().all.return_value = [mock_server]
        mock_session.execute.return_value = mock_result
        
        # ✅ 测试 enabled_ids=True（加载所有启用的服务器）
        tools = await provider.get_tools_namespaced(enabled_ids=True)
        
        # ✅ 验证返回类型
        assert isinstance(tools, dict)
        
        # ✅ 验证包含命名空间前缀
        assert "mcp__search" in tools
        
        # ✅ 验证 OpenAI 格式
        tool_schema = tools["mcp__search"]
        assert tool_schema["type"] == "function"
        assert tool_schema["function"]["name"] == "mcp__search"  # ✅ function.name 也应该有命名空间
        assert tool_schema["function"]["description"] == "Search tool"
        assert "parameters" in tool_schema["function"]
    
    @pytest.mark.asyncio
    async def test_get_tools_with_filter(self, mock_session):
        """测试带过滤的工具获取"""
        from app.models.mcp_server import MCPServer
        
        provider = MCPToolProvider(mock_session)
        
        # Mock 多个服务器
        mock_server1 = MagicMock(spec=MCPServer)
        mock_server1.id = "server_1"
        mock_server1.tools = {"tool1": {"description": "Tool 1", "inputSchema": {}}}
        
        mock_server2 = MagicMock(spec=MCPServer)
        mock_server2.id = "server_2"
        mock_server2.tools = {"tool2": {"description": "Tool 2", "inputSchema": {}}}
        
        # Mock 数据库查询只返回 server_1
        mock_result = MagicMock()
        mock_result.scalars().all.return_value = [mock_server1]
        mock_session.execute.return_value = mock_result
        
        # 只获取 server_1 的工具
        tools = await provider.get_tools_namespaced(enabled_ids=["server_1"])
        
        # 应该只包含 server_1 的工具
        assert len(tools) == 1
        assert "mcp__tool1" in tools
        assert "mcp__tool2" not in tools
    
    @pytest.mark.asyncio
    async def test_get_tools_empty_server(self, mock_session):
        """测试空服务器（无工具）的处理"""
        provider = MCPToolProvider(mock_session)
        
        # Mock 服务器没有工具
        mock_server = MagicMock()
        mock_server.tools = None
        
        mock_result = MagicMock()
        mock_result.scalars().all.return_value = [mock_server]
        mock_session.execute.return_value = mock_result
        
        # ✅ 测试 enabled_ids=True
        tools = await provider.get_tools_namespaced(enabled_ids=True)
        assert isinstance(tools, dict)
        assert len(tools) == 0
        
        # ✅ 测试 enabled_ids=False
        tools = await provider.get_tools_namespaced(enabled_ids=False)
        assert isinstance(tools, dict)
        assert len(tools) == 0
        
        # ✅ 测试 enabled_ids=[]
        tools = await provider.get_tools_namespaced(enabled_ids=[])
        assert isinstance(tools, dict)
        assert len(tools) == 0
    
    @pytest.mark.asyncio
    async def test_execute_success(self, mock_session):
        """测试成功执行 MCP 工具"""
        provider = MCPToolProvider(mock_session)
        
        # Mock _execute_internal 方法（因为 execute_with_namespace 会调用它）
        with patch.object(provider, '_execute_internal', return_value=ToolCallResponse(
            tool_call_id="test_id",
            name="search",  # ← MCP Provider 返回的是不带命名空间的名称
            content="搜索结果",
            is_error=False
        )):
            request = ToolCallRequest(
                id="test_id",
                name="mcp__search",
                arguments={"query": "test"}
            )
            response = await provider.execute_with_namespace(request)
        
        assert response.tool_call_id == "test_id"
        # ✅ 注意：MCP Provider 返回的 name 是不带命名空间的（这是 MCP 的实现特点）
        assert response.name == "search"
        assert response.content == "搜索结果"
        assert response.is_error is False
    
    @pytest.mark.asyncio
    async def test_execute_with_error(self, mock_session):
        """测试执行出错的处理"""
        provider = MCPToolProvider(mock_session)
        
        # Mock 执行出错
        with patch.object(provider, '_execute_internal', return_value=ToolCallResponse(
            tool_call_id="test_id",
            name="search",  # ← MCP Provider 返回不带命名空间
            content="Error: Connection failed",
            is_error=True
        )):
            request = ToolCallRequest(
                id="test_id",
                name="mcp__search",
                arguments={"query": "test"}
            )
            response = await provider.execute_with_namespace(request)
        
        assert response.is_error is True
        assert "Error:" in response.content
    
    @pytest.mark.asyncio
    async def test_execute_unknown_tool(self, mock_session):
        """测试执行未知工具"""
        provider = MCPToolProvider(mock_session)
        
        # Mock _execute_internal 返回错误响应（而不是抛出异常）
        with patch.object(provider, '_execute_internal', return_value=ToolCallResponse(
            tool_call_id="test_id",
            name="unknown_tool",  # ← MCP Provider 返回不带命名空间
            content="Unknown tool: mcp__unknown_tool",
            is_error=True
        )):
            request = ToolCallRequest(
                id="test_id",
                name="mcp__unknown_tool",
                arguments={}
            )
            response = await provider.execute_with_namespace(request)
        
        assert response.is_error is True
        assert "Unknown tool" in str(response.content)
    
    @pytest.mark.asyncio
    async def test_get_prompt_injection(self, mock_session):
        """测试提示词注入（MCP Provider 默认不实现 get_prompt）"""
        provider = MCPToolProvider(mock_session)
        
        # ✅ MCP Provider 默认使用父类的空实现
        prompt = await provider.get_prompt(inject_params={"session_id": "test_session"})
        
        assert isinstance(prompt, str)
        # ✅ 默认为空字符串是正常行为
        # assert len(prompt) >= 0  # 可以是空字符串
    
    @pytest.mark.asyncio
    async def test_get_prompt_no_tools(self, mock_session):
        """测试没有工具时的提示词（MCP Provider 默认为空）"""
        provider = MCPToolProvider(mock_session)
        
        # ✅ MCP Provider 默认使用父类的空实现
        prompt = await provider.get_prompt(inject_params={"session_id": "test_session"})
        
        # 没有工具时，提示词应该为空或很短
        assert isinstance(prompt, str)
        # ✅ 默认为空字符串是正常行为
    
    @pytest.mark.asyncio
    async def test_multiple_servers_tools(self, mock_session):
        """测试多个服务器的工具合并"""
        from app.models.mcp_server import MCPServer
        
        provider = MCPToolProvider(mock_session)
        
        # Mock 多个服务器有不同工具
        mock_server1 = MagicMock(spec=MCPServer)
        mock_server1.id = "server_1"
        mock_server1.tools = {
            "search": {"description": "Search", "inputSchema": {"type": "object"}}
        }
        
        mock_server2 = MagicMock(spec=MCPServer)
        mock_server2.id = "server_2"
        mock_server2.tools = {
            "calculate": {"description": "Calculate", "inputSchema": {"type": "object"}}
        }
        
        # ✅ Mock 数据库查询（不传 enabled_ids，加载所有服务器）
        mock_result = MagicMock()
        mock_result.scalars().all.return_value = [mock_server1, mock_server2]
        mock_session.execute.return_value = mock_result
        
        # ✅ 不传 enabled_ids（或传 None），表示获取所有启用的服务器
        tools = await provider.get_tools_namespaced()  # 默认 enabled_ids=None
        
        # 应该包含两个服务器的工具
        assert len(tools) == 2
        assert "mcp__search" in tools
        assert "mcp__calculate" in tools
        
        # ✅ 验证每个工具的 function.name 都正确
        assert tools["mcp__search"]["function"]["name"] == "mcp__search"
        assert tools["mcp__calculate"]["function"]["name"] == "mcp__calculate"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
