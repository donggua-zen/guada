"""
工具调用集成测试

测试范围:
1. LocalToolProvider 端到端执行
2. ToolOrchestrator 批量执行
3. 工具调用路由（通过 AgentService）
4. skip_tool_calls 策略（待实现）
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tools.providers.local_tool_provider import LocalToolProvider
from app.services.tools.tool_orchestrator import ToolOrchestrator, ToolExecutionContext, ProviderConfig
from app.services.tools.providers.tool_provider_base import ToolCallRequest


class TestLocalToolProviderIntegration:
    """测试 LocalToolProvider 集成"""
    
    @pytest.mark.asyncio
    async def test_local_tool_provider_when_register_and_execute_should_work(self):
        """测试本地工具提供者注册和执行"""
        # Arrange
        provider = LocalToolProvider()
        
        # 注册工具
        def get_current_time() -> str:
            return "2026-03-29 16:00:00"
        
        provider.register(
            name="get_current_time",
            func=get_current_time,
            schema={"type": "object", "properties": {}}
        )
        
        # Act: 执行工具（使用 execute_with_namespace 方法）
        request = ToolCallRequest(
            id="time-call-1",
            name="local__get_current_time",  # ✅ 使用命名空间前缀
            arguments={}
        )
        
        response = await provider.execute_with_namespace(request)
        
        # Assert
        assert response.tool_call_id == "time-call-1"
        assert response.name == "local__get_current_time"  # ✅ 返回带命名空间的名称
        assert response.is_error is False
        assert "2026-03-29" in response.content
    
    @pytest.mark.asyncio
    async def test_local_tool_provider_when_async_function_should_work(self):
        """测试异步函数支持"""
        # Arrange
        provider = LocalToolProvider()
        
        async def async_fetch_data(url: str) -> str:
            return f"Fetched: {url}"
        
        provider.register(
            name="fetch_url",
            func=async_fetch_data,
            schema={
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                }
            }
        )
        
        # Act
        request = ToolCallRequest(
            id="async-call-1",
            name="local__fetch_url",  # ✅ 使用命名空间前缀
            arguments={"url": "https://api.example.com"}
        )
        
        response = await provider.execute_with_namespace(request)
        
        # Assert
        assert response.is_error is False
        assert response.name == "local__fetch_url"  # ✅ 返回带命名空间的名称
        assert "Fetched: https://api.example.com" in response.content
    
    @pytest.mark.asyncio
    async def test_local_tool_provider_when_invalid_arguments_should_return_error(self):
        """测试参数验证失败处理"""
        # Arrange
        provider = LocalToolProvider()
        
        def require_param(value: str) -> str:
            if not value:
                raise ValueError("value is required")
            return f"Got: {value}"
        
        provider.register(
            name="require_param",
            func=require_param,
            schema={
                "type": "object",
                "properties": {
                    "value": {"type": "string"}
                },
                "required": ["value"]
            }
        )
        
        # Act: 不提供必需参数
        request = ToolCallRequest(
            id="bad-call-1",
            name="local__require_param",  # ✅ 使用命名空间前缀
            arguments={}  # ❌ 缺少必需的 value 参数
        )
        
        response = await provider.execute_with_namespace(request)
        
        # Assert
        assert response.is_error is True
        assert "error" in response.content.lower() or "missing" in response.content.lower()


class TestToolOrchestratorBatchExecution:
    """测试 ToolOrchestrator 批量执行"""
    
    @pytest.fixture
    async def orchestrator_with_tools(self, tool_provider_factory):
        """创建带有工具的 ToolOrchestrator"""
        orchestrator = ToolOrchestrator()
        
        # 添加本地工具提供者
        local_provider = tool_provider_factory.create_local()
        
        # 注册多个工具
        def add(a: int, b: int) -> int:
            return a + b
        
        def subtract(x: int, y: int) -> int:
            return x - y
        
        def multiply(m: int, n: int) -> int:
            return m * n
        
        tool_provider_factory.register_simple_tool(local_provider, "add", add)
        tool_provider_factory.register_simple_tool(local_provider, "subtract", subtract)
        tool_provider_factory.register_simple_tool(local_provider, "multiply", multiply)
        
        orchestrator.add_provider(local_provider, priority=0)
        
        yield orchestrator
    
    @pytest.mark.asyncio
    async def test_execute_batch_when_multiple_tools_should_execute_concurrently(
        self, orchestrator_with_tools
    ):
        """测试批量执行多个工具"""
        # Arrange
        requests = [
            ToolCallRequest(id="batch-1", name="local__add", arguments={"a": 5, "b": 3}),  # ✅ 使用命名空间
            ToolCallRequest(id="batch-2", name="local__subtract", arguments={"x": 10, "y": 4}),  # ✅ 使用命名空间
            ToolCallRequest(id="batch-3", name="local__multiply", arguments={"m": 2, "n": 6})  # ✅ 使用命名空间
        ]
        
        # ✅ 创建 ToolExecutionContext，启用所有工具
        context = ToolExecutionContext(
            session_id="test-session",
            local=ProviderConfig(enabled_tools=True)  # ✅ 启用所有本地工具
        )
        
        # Act
        responses = await orchestrator_with_tools.execute_batch(requests, context=context)
        
        # Assert
        assert len(responses) == 3
        
        # 验证每个工具的执行结果
        response_map = {r.tool_call_id: r for r in responses}
        
        assert response_map["batch-1"].content == "8"   # 5 + 3
        assert response_map["batch-2"].content == "6"   # 10 - 4
        assert response_map["batch-3"].content == "12"  # 2 * 6
    
    @pytest.mark.asyncio
    async def test_execute_batch_when_partial_failures_should_return_all_results(
        self, orchestrator_with_tools
    ):
        """测试部分失败时的批量执行"""
        # Arrange
        requests = [
            ToolCallRequest(id="good-call", name="local__add", arguments={"a": 1, "b": 2}),  # ✅ 使用命名空间
            ToolCallRequest(id="bad-call", name="nonexistent_tool", arguments={})  # ❌ 不存在的工具
        ]
        
        # ✅ 创建 ToolExecutionContext
        context = ToolExecutionContext(
            session_id="test-session",
            local=ProviderConfig(enabled_tools=True)
        )
        
        # Act
        responses = await orchestrator_with_tools.execute_batch(requests, context=context)
        
        # Assert: 应该返回所有结果（包括成功的和失败的）
        assert len(responses) == 2
        
        response_map = {r.tool_call_id: r for r in responses}
        
        # 成功的调用
        assert response_map["good-call"].is_error is False
        assert response_map["good-call"].content == "3"
        
        # 失败的调用
        assert response_map["bad-call"].is_error is True
        assert response_map["bad-call"].is_error is True
        assert "Unknown tool" in response_map["bad-call"].content or "nonexistent_tool" in response_map["bad-call"].content
    
    @pytest.mark.asyncio
    async def test_execute_batch_when_empty_requests_should_return_empty_list(
        self, orchestrator_with_tools
    ):
        """测试空请求列表"""
        # Act
        responses = await orchestrator_with_tools.execute_batch([])
        
        # Assert
        assert len(responses) == 0


class TestToolOrchestratorPriority:
    """测试工具优先级"""
    
    @pytest.fixture
    async def orchestrator_with_priority(self, tool_provider_factory):
        """创建带优先级设置的 ToolOrchestrator"""
        orchestrator = ToolOrchestrator()
        
        # Provider 1（高优先级）
        provider1 = tool_provider_factory.create_local()
        
        def get_version_v1() -> str:
            return "v1.0"
        
        tool_provider_factory.register_simple_tool(provider1, "get_version", get_version_v1)
        
        # Provider 2（低优先级）
        provider2 = tool_provider_factory.create_local()
        
        def get_version_v2() -> str:
            return "v2.0"
        
        tool_provider_factory.register_simple_tool(provider2, "get_version", get_version_v2)
        
        # 添加提供者（provider1 优先级更高）
        orchestrator.add_provider(provider1, priority=0)  # 高优先级
        orchestrator.add_provider(provider2, priority=1)  # 低优先级
        
        yield orchestrator
    
    @pytest.mark.skip(reason="当前实现不支持同一命名空间的多个 Provider 优先级选择")
    @pytest.mark.asyncio
    async def test_execute_when_same_tool_different_priority_should_use_high_priority(
        self, orchestrator_with_priority
    ):
        """测试同名工具使用高优先级的实现（待实现）"""
        # Arrange
        request = ToolCallRequest(
            id="priority-test",
            name="local__get_version",  # ✅ 使用命名空间前缀
            arguments={}
        )
        
        # ✅ 创建 ToolExecutionContext
        context = ToolExecutionContext(
            session_id="test-session",
            local=ProviderConfig(enabled_tools=True)
        )
        
        # Act
        response = await orchestrator_with_priority.execute(request, context=context)
        
        # Assert: 应该使用高优先级的工具（v1.0）
        assert response.content == "v1.0"


# 待确认事项测试
class TestToolCallingEdgeCases:
    """边界情况测试（待确认）"""
    
    @pytest.mark.asyncio
    async def test_skip_tool_calls_when_all_history_filtered_should_preserve_context(self):
        """
        测试 skip_tool_calls 边界情况：全部历史过滤后的保留策略
        
        业务规则:
        - skip_tool_calls=True: 跳过历史记录中含工具调用的轮次
        - 当前问答轮次不受影响（即使有工具调用也保留）
        - 如果历史全部被过滤，至少保留最近一轮对话
        
        场景设计:
        用户：北京天气如何
        AI：让我帮你查询天气 (tool_calls)
        AI：北京天气晴朗 (tool_response + response)
        用户：上海呢？
        AI：让我查询 (tool_calls) <- 当前轮次，必须保留
        AI：上海多云 (tool_response)
        
        skip_tool_calls=True 后应该保留:
        用户：上海呢？
        AI：让我查询 (tool_calls)
        AI：上海多云 (tool_response)
        """
        # Arrange: Mock get_conversation_messages 方法
        from app.services.chat.memory_manager_service import MemoryManagerService
        from unittest.mock import AsyncMock, MagicMock
        
        mock_message_repo = AsyncMock()
        memory_manager = MemoryManagerService(message_repo=mock_message_repo)
        
        # 模拟数据库返回的消息（所有历史都包含工具调用）
        mock_db_messages = [
            # 第 1 轮：历史 - 包含工具调用
            MagicMock(
                role="user",
                contents=[{"role": "user", "content": "北京天气如何", "type": "text"}],
                to_dict_async=AsyncMock(return_value={
                    "role": "user",
                    "contents": [{"role": "user", "content": "北京天气如何", "type": "text"}]
                })
            ),
            MagicMock(
                role="assistant",
                contents=[{
                    "role": "assistant",
                    "content": "让我帮你查询天气",
                    "type": "text",
                    "additional_kwargs": {
                        "tool_calls": [{"id": "call-1", "name": "weather_query", "arguments": {}}]
                    }
                }],
                to_dict_async=AsyncMock(return_value={
                    "role": "assistant",
                    "contents": [{
                        "role": "assistant",
                        "content": "让我帮你查询天气",
                        "additional_kwargs": {"tool_calls": [{"id": "call-1", "name": "weather_query", "arguments": {}}]}
                    }]
                })
            ),
            # 第 2 轮：当前 - 包含工具调用（必须保留）
            MagicMock(
                role="user",
                contents=[{"role": "user", "content": "上海呢？", "type": "text"}],
                to_dict_async=AsyncMock(return_value={
                    "role": "user",
                    "contents": [{"role": "user", "content": "上海呢？", "type": "text"}]
                })
            ),
            MagicMock(
                role="assistant",
                contents=[{
                    "role": "assistant",
                    "content": "上海天气晴朗",
                    "type": "text",
                    "additional_kwargs": {
                        "tool_calls": [{"id": "call-2", "name": "weather_query", "arguments": {"city": "上海"}}]
                    }
                }],
                to_dict_async=AsyncMock(return_value={
                    "role": "assistant",
                    "contents": [{
                        "role": "assistant",
                        "content": "上海天气晴朗",
                        "additional_kwargs": {"tool_calls": [{"id": "call-2", "name": "weather_query", "arguments": {"city": "上海"}}]}
                    }]
                })
            ),
        ]
        
        mock_message_repo.get_messages = AsyncMock(return_value=mock_db_messages)
        
        # Act: 测试 skip_tool_calls=True 的行为
        result_with_skip = await memory_manager.get_conversation_messages(
            session_id="session-1",
            max_messages=50,
            skip_tool_calls=True
        )
        
        # Act: 对比 skip_tool_calls=False 的行为
        result_without_skip = await memory_manager.get_conversation_messages(
            session_id="session-1",
            max_messages=50,
            skip_tool_calls=False
        )
        
        # Assert
        # 1. 跳过工具调用时，消息数量应该减少
        assert len(result_with_skip) < len(result_without_skip), "应该有历史消息被过滤"
        
        # 2. 当前问答轮次必须保留（最新消息）
        assert any(msg["content"] == "上海呢？" for msg in result_with_skip), "当前问题必须保留"
        
        # 3. 验证当前轮次的工具调用是否保留（根据业务需求）
        # 注意：根据用户需求，当前轮次的 tool_calls 和 tool_response 应该保留
        has_current_tool_call = any(
            "tool_calls" in msg and msg.get("tool_calls") 
            for msg in result_with_skip 
            if msg.get("role") == "assistant"
        )
        
        # 4. 历史工具调用应该被过滤
        # 检查是否过滤掉了"北京天气如何"相关的工具调用
        history_tool_calls = [
            msg for msg in result_with_skip 
            if "tool_calls" in msg and msg.get("tool_calls")
            and any(tc.get("id") == "call-1" for tc in msg.get("tool_calls", []))
        ]
        assert len(history_tool_calls) == 0, "历史工具调用应该被过滤"
    
    @pytest.mark.skip(reason="需要完整的 AgentService 集成环境")
    @pytest.mark.asyncio
    async def test_end_to_end_tool_calling_with_agent_service(self):
        """
        待实现：需要完整的 AgentService 集成测试环境
        包括 Mock LLM 响应、消息历史等
        """
        pass
