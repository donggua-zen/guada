"""
记忆工具单元测试

测试范围:
1. MemoryToolProvider 基本功能
2. MemoryRepository 数据库操作
3. MemoryToolProvider 集成
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
from app.repositories.memory_repository import MemoryRepository


class TestMemoryToolProvider:
    """测试记忆工具提供者"""
    
    @pytest.fixture
    def mock_session(self):
        """创建 Mock 数据库会话"""
        session = AsyncMock(spec=AsyncSession)
        return session
    
    @pytest.fixture
    async def memory_provider(self, mock_session):
        """创建记忆工具提供者实例"""
        provider = MemoryToolProvider(mock_session)
        await provider.initialize()
        yield provider
    
    @pytest.mark.asyncio
    async def test_add_memory(self, memory_provider, mock_session):
        """测试添加记忆"""
        # Mock repository 返回
        mock_memory = MagicMock()
        mock_memory.id = "test_memory_id"
        mock_memory.importance = 8
        
        with patch.object(MemoryRepository, 'create_memory', return_value=mock_memory):
            result = await memory_provider.execute_with_namespace(
                "add_memory",
                {
                    "session_id": "test_session",
                    "content": "用户喜欢蓝色",
                    "memory_type": "factual",
                    "importance": 8,
                    "tags": ["偏好", "颜色"]
                }
            )
        
        assert "✓ 记忆已添加" in result
        assert "ID: test_memory_id" in result
        assert "重要性：8" in result
    
    @pytest.mark.asyncio
    async def test_search_memories(self, memory_provider, mock_session):
        """测试搜索记忆"""
        # Mock 搜索结果
        mock_memory1 = MagicMock()
        mock_memory1.importance = 7
        mock_memory1.memory_type = "factual"
        mock_memory1.content = "用户最喜欢的水果是苹果"
        mock_memory1.tags = ["食物", "水果"]
        
        with patch.object(MemoryRepository, 'search_memories', return_value=[mock_memory1]):
            # ✅ 使用 execute_with_namespace 直接执行（去除前缀）
            result = await memory_provider.execute_with_namespace(
                "search_memories",  # ← 已经去除了 memory__ 前缀
                {
                    "session_id": "test_session",
                    "query": "苹果",
                    "limit": 5
                }
            )
        
        assert "找到 1 条记忆" in result
        assert "苹果" in result
        assert "7⭐" in result
    
    @pytest.mark.asyncio
    async def test_search_no_results(self, memory_provider, mock_session):
        """测试搜索无结果"""
        with patch.object(MemoryRepository, 'search_memories', return_value=[]):
            result = await memory_provider.execute_with_namespace(
                "search_memories",
                {
                    "session_id": "test_session",
                    "query": "不存在的关键词"
                }
            )
        
        assert "未找到相关记忆" == result
    
    @pytest.mark.asyncio
    async def test_edit_memory(self, memory_provider, mock_session):
        """测试编辑记忆"""
        # Mock 更新结果
        mock_memory = MagicMock()
        mock_memory.id = "test_memory_id"
        
        with patch.object(MemoryRepository, 'update_memory', return_value=mock_memory):
            result = await memory_provider.execute_with_namespace(
                "edit_memory",
                {
                    "memory_id": "test_memory_id",
                    "content": "更新后的内容",
                    "importance": 9
                }
            )
        
        assert "✓ 记忆已更新" in result
        assert "ID: test_memory_id" in result
    
    @pytest.mark.asyncio
    async def test_edit_memory_not_found(self, memory_provider, mock_session):
        """测试编辑不存在的记忆"""
        with patch.object(MemoryRepository, 'update_memory', return_value=None):
            result = await memory_provider.execute_with_namespace(
                "edit_memory",
                {
                    "memory_id": "nonexistent_id",
                    "content": "更新内容"
                }
            )
        
        assert "❌ 未找到记忆" in result
        assert "nonexistent_id" in result
    
    @pytest.mark.asyncio
    async def test_summarize_memories(self, memory_provider, mock_session):
        """测试总结记忆"""
        with patch.object(MemoryRepository, 'summarize_memories', return_value="摘要内容"):
            result = await memory_provider.execute_with_namespace(
                "summarize_memories",
                {"session_id": "test_session", "limit": 10}
            )
        
        assert "长期记忆摘要:" in result
        assert "摘要内容" in result
    
    @pytest.mark.asyncio
    async def test_missing_session_id(self, memory_provider, mock_session):
        """测试缺少 session_id 的错误处理"""
        result = await memory_provider.execute_with_namespace(
            "add_memory",
            {"content": "测试内容"}  # 缺少 session_id
        )
        
        assert "❌ 错误" in result
        assert "session_id" in result
    
    @pytest.mark.asyncio
    async def test_unknown_tool(self, memory_provider):
        """测试未知工具"""
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        
        request = ToolCallRequest(
            id="test_id",
            name="unknown_tool",
            arguments={}
        )
        response = await memory_provider.execute(request)
        
        assert response.is_error is True
        assert "Unknown memory tool" in response.content or "unknown_tool" in response.content
    
    @pytest.mark.asyncio
    async def test_get_tools_schema(self, memory_provider):
        """测试获取工具 schema（使用 get_tools_namespaced）"""
        # ✅ 使用 get_tools_namespaced() 方法（带命名空间）
        tools = await memory_provider.get_tools_namespaced(enabled_ids=True)
        
        assert "memory__add_memory" in tools
        assert "memory__search_memories" in tools
        assert "memory__edit_memory" in tools
        assert "memory__summarize_memories" in tools
        
        # ✅ 验证 schema 结构（OpenAI 格式）
        add_memory_schema = tools["memory__add_memory"]
        assert add_memory_schema["type"] == "function"
        assert add_memory_schema["function"]["name"] == "memory__add_memory"
    
    @pytest.mark.asyncio
    async def test_get_prompt_injection(self, memory_provider):
        """测试提示词注入"""
        prompt = await memory_provider.get_prompt(inject_params={"session_id": "test_session"})
        
        assert "长期记忆工具" in prompt
        assert "add_memory" in prompt or "memory__add_memory" in prompt
        assert "search_memories" in prompt or "memory__search_memories" in prompt
    
    @pytest.mark.asyncio
    async def test_get_config(self, memory_provider):
        """测试获取配置（MemoryToolProvider 没有 get_config 方法，跳过）"""
        # ✅ 注意：IToolProvider 接口没有 get_config() 方法
        # 这个测试可以跳过或者删除
        pytest.skip("IToolProvider 接口不提供 get_config 方法")


class TestMemoryRepository:
    """测试记忆仓库（需要实际数据库）"""
    
    @pytest.mark.skip(reason="需要实际数据库环境")
    @pytest.mark.asyncio
    async def test_create_memory_integration(self, test_db_session):
        """测试创建记忆（集成测试）"""
        repo = MemoryRepository(test_db_session)
        
        memory = await repo.create_memory(
            session_id="integration_test_session",
            content="集成测试记忆",
            memory_type="factual",
            importance=10,
            tags=["测试"]
        )
        
        assert memory.id is not None
        assert memory.content == "集成测试记忆"
        assert memory.importance == 10


class TestMemoryToolProvider:
    """测试记忆工具提供者"""
    
    @pytest.fixture
    def mock_session(self):
        return AsyncMock(spec=AsyncSession)
    
    @pytest.mark.asyncio
    async def test_provider_initialization(self, mock_session):
        """测试提供者初始化"""
        from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
        
        provider = MemoryToolProvider(mock_session)
        await provider.initialize()
        
        # ✅ 使用 get_tools_namespaced() 获取带命名空间的工具
        tools = await provider.get_tools_namespaced(enabled_ids=True)
        
        assert "memory__add_memory" in tools
        assert "memory__search_memories" in tools
        assert "memory__edit_memory" in tools
        assert "memory__summarize_memories" in tools
    
    @pytest.mark.asyncio
    async def test_is_available(self, mock_session):
        """测试工具可用性检查"""
        from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
        
        provider = MemoryToolProvider(mock_session)
        
        assert await provider.is_available("memory__add_memory") is True
        assert await provider.is_available("nonexistent_tool") is False
    
    @pytest.mark.asyncio
    async def test_execute_success(self, mock_session):
        """测试成功执行"""
        from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
        from app.services.tools.providers.tool_provider_base import ToolCallRequest, ToolCallResponse
        
        provider = MemoryToolProvider(mock_session)
        
        # ✅ Mock _execute_internal 方法（因为 execute_with_namespace 会调用它）
        with patch.object(provider, '_execute_internal', return_value=ToolCallResponse(
            tool_call_id="test_id",
            name="add_memory",
            content="执行成功",
            is_error=False
        )):
            request = ToolCallRequest(
                id="test_id",
                name="memory__add_memory",  # ← 带命名空间前缀
                arguments={"session_id": "test", "content": "test"}
            )
            response = await provider.execute_with_namespace(request)
        
        assert response.content == "执行成功"
        assert response.is_error is False
    
    @pytest.mark.asyncio
    async def test_get_all_prompts(self, mock_session):
        """测试提示词注入"""
        provider = MemoryToolProvider(mock_session)
        prompt = await provider.get_prompt(inject_params={"session_id": "test_session"})
        assert isinstance(prompt, str)
