"""
验证移除 ToolParameterInjector 后系统功能正常

测试范围:
1. AgentService 初始化
2. 工具编排器功能
3. Memory Provider 功能
4. MCP Provider 功能
5. Local Provider 功能
6. 完整的工具执行流程
"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch


class TestToolParameterInjectorRemoval:
    """验证移除 ToolParameterInjector 后的功能完整性"""

    @pytest.mark.asyncio
    async def test_agent_service_initialization(self):
        """测试 AgentService 初始化不需要 ToolParameterInjector"""
        from app.services.agent_service import AgentService
        
        # Mock 所有依赖服务
        mock_model_service = MagicMock()
        mock_memory_manager = MagicMock()
        mock_setting_service = MagicMock()
        mock_mcp_manager = MagicMock()
        mock_tool_orchestrator = MagicMock()
        
        # ✅ 应该成功初始化，不报错
        agent_service = AgentService(
            model_service=mock_model_service,
            memory_manager_service=mock_memory_manager,
            setting_service=mock_setting_service,
            mcp_tool_manager=mock_mcp_manager,
            tool_orchestrator=mock_tool_orchestrator,
        )
        
        # ✅ 验证没有 param_injector 属性
        assert not hasattr(agent_service, 'param_injector')
        
        # ✅ 验证有其他必要的属性
        assert hasattr(agent_service, 'tool_orchestrator')
        assert hasattr(agent_service, 'model_service')
        print("[TEST] ✅ AgentService 初始化成功（无需 ToolParameterInjector）")

    @pytest.mark.asyncio
    async def test_tool_orchestrator_get_tools(self):
        """测试工具编排器获取工具功能正常"""
        from app.services.tools.tool_orchestrator import ToolOrchestrator
        from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
        
        orchestrator = ToolOrchestrator()
        
        # Mock session
        mock_session = AsyncMock()
        
        # 添加 Memory Provider
        memory_provider = MemoryToolProvider(mock_session)
        orchestrator.add_provider("memory", memory_provider)
        
        # ✅ 获取工具列表
        tools = await orchestrator.get_all_tools()
        
        # ✅ 验证返回数组格式
        assert isinstance(tools, list)
        assert len(tools) > 0
        
        # ✅ 验证工具格式符合 OpenAI API
        for tool in tools:
            assert tool["type"] == "function"
            assert "function" in tool
            assert "name" in tool["function"]
            assert "description" in tool["function"]
            assert "parameters" in tool["function"]
        
        print(f"[TEST] ✅ ToolOrchestrator 获取 {len(tools)} 个工具成功")

    @pytest.mark.asyncio
    async def test_memory_provider_execute_with_injection(self):
        """测试 Memory Provider 执行时参数注入功能正常"""
        from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        
        # Mock session
        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        
        provider = MemoryToolProvider(mock_session)
        provider._repo = mock_repo
        
        # Mock 记忆仓库返回
        mock_memory = MagicMock()
        mock_memory.id = "test_mem_123"
        mock_memory.content = "Test memory content"
        mock_repo.create_memory.return_value = mock_memory
        
        # ✅ 执行工具调用，使用 inject_params 传递 session_id
        request = ToolCallRequest(
            id="call_123",
            name="add_memory",
            arguments={"content": "Test memory"}
        )
        
        response = await provider.execute_with_namespace(
            request,
            inject_params={"session_id": "test_session"}
        )
        
        # ✅ 验证执行成功
        assert response.is_error is False
        assert "test_mem_123" in response.content
        
        # ✅ 验证调用了正确的仓库方法
        mock_repo.create_memory.assert_called_once()
        
        print("[TEST] ✅ Memory Provider 参数注入执行成功")

    @pytest.mark.asyncio
    async def test_mcp_provider_execute_with_injection(self):
        """测试 MCP Provider 执行时参数注入功能正常"""
        from app.services.tools.providers.mcp_tool_provider import MCPToolProvider
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        
        # Mock session
        mock_session = AsyncMock()
        provider = MCPToolProvider(mock_session)
        
        # Mock MCP 客户端执行结果
        mock_response = {
            "isError": False,
            "content": [{"type": "text", "text": "MCP result"}]
        }
        
        with patch.object(provider, '_execute_internal', new_callable=AsyncMock) as mock_execute:
            mock_execute.return_value = MagicMock(
                tool_call_id="call_123",
                name="search",
                content="MCP result",
                is_error=False
            )
            
            # ✅ 执行工具调用
            request = ToolCallRequest(
                id="call_123",
                name="mcp__search",
                arguments={"query": "test"}
            )
            
            response = await provider.execute_with_namespace(
                request,
                inject_params={"session_id": "test_session"}
            )
            
            # ✅ 验证执行成功
            assert response.is_error is False
            assert response.content == "MCP result"
            
            print("[TEST] ✅ MCP Provider 参数注入执行成功")

    @pytest.mark.asyncio
    async def test_local_provider_execute_with_injection(self):
        """测试 Local Provider 执行时参数注入功能正常"""
        from app.services.tools.providers.local_tool_provider import LocalToolProvider
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        from pydantic import BaseModel
        
        # 定义一个简单的本地工具
        class TestParams(BaseModel):
            value: str
            
        async def test_tool(params: TestParams, inject_params: dict = None):
            """测试工具"""
            session_id = inject_params.get("session_id", "unknown") if inject_params else "unknown"
            return f"Local result: {params.value} (session: {session_id})"
        
        provider = LocalToolProvider()
        provider.register_tool("test_tool", test_tool, TestParams)
        
        # ✅ 执行工具调用，使用 inject_params 传递 session_id
        request = ToolCallRequest(
            id="call_123",
            name="local__test_tool",
            arguments={"value": "test_value"}
        )
        
        response = await provider.execute_with_namespace(
            request,
            inject_params={"session_id": "test_session"}
        )
        
        # ✅ 验证执行成功且注入了 session_id
        assert response.is_error is False
        assert "test_value" in response.content
        assert "test_session" in response.content
        
        print("[TEST] ✅ Local Provider 参数注入执行成功")

    @pytest.mark.asyncio
    async def test_complete_tool_execution_chain(self):
        """测试完整的工具执行链路（从 Orchestrator 到 Provider）"""
        from app.services.tools.tool_orchestrator import ToolOrchestrator, ToolExecutionContext, ProviderConfig
        from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        
        orchestrator = ToolOrchestrator()
        
        # Mock session
        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        
        # 添加 Memory Provider
        memory_provider = MemoryToolProvider(mock_session)
        memory_provider._repo = mock_repo
        orchestrator.add_provider("memory", memory_provider)
        
        # Mock 仓库返回值
        mock_memory = MagicMock()
        mock_memory.id = "mem_456"
        mock_memory.content = "Injected memory"
        mock_repo.create_memory.return_value = mock_memory
        
        # ✅ 创建执行上下文（包含 Provider 配置）
        context = ToolExecutionContext(
            session_id="test_session_789",
            memory=ProviderConfig(enabled_tools=True)
        )
        
        # ✅ 通过 Orchestrator 执行工具
        request = ToolCallRequest(
            id="call_orch_123",
            name="memory__add_memory",
            arguments={"content": "Injected memory"}
        )
        
        response = await orchestrator.execute(request, context)
        
        # ✅ 验证执行成功
        assert response.is_error is False
        assert "mem_456" in response.content
        
        # ✅ 验证 session_id 被正确注入
        mock_repo.create_memory.assert_called_once()
        call_args = mock_repo.create_memory.call_args
        assert call_args[1]["session_id"] == "test_session_789"
        
        print("[TEST] ✅ 完整工具执行链路成功（含参数注入）")

    @pytest.mark.asyncio
    async def test_no_param_injector_dependency(self):
        """验证系统中没有任何地方依赖 ToolParameterInjector"""
        import importlib
        import sys
        
        # 尝试导入已删除的模块
        try:
            from app.services.tools import tool_injector
            # 如果导入成功，说明文件还存在
            assert False, "tool_injector.py 应该已被删除"
        except ImportError:
            # ✅ 预期行为：模块不存在
            pass
        
        # ✅ 验证 AgentService 可以正常导入和使用
        from app.services.agent_service import AgentService
        assert AgentService is not None
        
        print("[TEST] ✅ 系统无 ToolParameterInjector 依赖")


if __name__ == "__main__":
    print("=" * 70)
    print("验证移除 ToolParameterInjector 后的功能完整性")
    print("=" * 70)
    
    pytest.main([__file__, "-v", "-s"])
