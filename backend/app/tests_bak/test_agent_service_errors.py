"""测试 AgentService 的各种错误场景"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.services.agent_service import AgentService
from app.repositories.session_repository import SessionRepository
from app.repositories.model_repository import ModelRepository
from app.repositories.message_repository import MessageRepository
from app.services.tools.tool_orchestrator import ToolOrchestrator
from app.services.settings_manager import SettingsManager
from app.services.chat.memory_manager_service import MemoryManagerService
from app.services.mcp.tool_manager import MCPToolManager
from app.models.session import Session
from app.models.character import Character


# ========== Fixtures ==========

@pytest.fixture
async def async_session():
    """创建异步数据库会话（使用内存 SQLite）"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    
    # 创建所有表
    from app.database import ModelBase as Base
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    # 插入测试数据
    async with async_session() as session:
        # 创建角色
        character = Character(
            id="test_character",
            user_id="test_user",
            title="Test Character",
            description="Test",
            is_public=False,
            settings={
                "tools": True,
                "mcp_servers": [],
                "enable_tool_results": True,
            },
        )
        session.add(character)
        
        # 创建会话
        test_session = Session(
            id="test_session",
            character_id="test_character",
            title="Test Session",
        )
        session.add(test_session)
        
        await session.commit()
    
    async with async_session() as session:
        yield session
    
    await engine.dispose()


@pytest.fixture
def mock_repos(async_session):
    """创建 Mock 仓库"""
    session_repo = AsyncMock(spec=SessionRepository)
    model_repo = AsyncMock(spec=ModelRepository)
    message_repo = AsyncMock(spec=MessageRepository)
    
    return {
        "session": session_repo,
        "model": model_repo,
        "message": message_repo,
    }


@pytest.fixture
def agent_service(mock_repos, async_session):
    """创建 AgentService 实例"""
    # 创建依赖服务
    memory_manager = AsyncMock(spec=MemoryManagerService)
    settings_manager = AsyncMock(spec=SettingsManager)
    mcp_tool_manager = AsyncMock(spec=MCPToolManager)
    
    return AgentService(
        session_repo=mock_repos["session"],
        model_repo=mock_repos["model"],
        message_repo=mock_repos["message"],
        memory_manager_service=memory_manager,
        setting_service=settings_manager,
        mcp_tool_manager=mcp_tool_manager,
        tool_orchestrator=ToolOrchestrator(),
    )


# ========== 测试错误场景 ==========

@pytest.mark.asyncio
async def test_completions_missing_session(agent_service):
    """测试 completions 方法缺少 session 的错误"""
    # TODO: 实现具体的参数验证逻辑
    pass


@pytest.mark.asyncio
async def test_completions_invalid_model_params(agent_service, mock_repos):
    """测试无效模型参数的错误处理"""
    # Mock 数据库查询返回空
    mock_repos["session"].get_by_id = AsyncMock(return_value=None)
    
    # TODO: 添加模型参数验证逻辑
    pass


@pytest.mark.asyncio
async def test_completions_tool_execution_error(agent_service, mock_repos):
    """测试工具执行错误的处理"""
    # Mock session
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    mock_session.character_id = "test_character"
    mock_session.character = MagicMock(spec=Character)
    mock_session.character.settings = {
        "tools": True,
        "mcp_servers": [],
        "enable_tool_results": True,
    }
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # Mock tool orchestrator 抛出异常
    agent_service.tool_orchestrator.get_all_tools = AsyncMock(
        side_effect=Exception("Tool execution failed")
    )
    
    # TODO: 验证异常是否被正确捕获和处理
    pass


@pytest.mark.asyncio
async def test_get_conversation_messages_missing_session_id(agent_service):
    """测试获取对话消息时缺少 session_id"""
    # TODO: 实现参数验证
    pass


@pytest.mark.asyncio
async def test_build_system_prompt_tool_provider_error(agent_service):
    """测试构建系统提示词时工具提供者出错"""
    # Mock session_id
    session_id = "test_session"
    
    # Mock tool orchestrator 抛出异常
    agent_service.tool_orchestrator.get_all_tool_prompts = AsyncMock(
        side_effect=Exception("Provider error")
    )
    
    # 应该捕获异常并继续执行，不中断整个流程
    # TODO: 验证错误日志记录
    pass


@pytest.mark.asyncio
async def test_agent_service_initialization_with_null_repos():
    """测试使用 null 仓库初始化 AgentService"""
    with pytest.raises((TypeError, AttributeError)):
        AgentService(
            session_repo=None,
            model_repo=None,
            message_repo=None,
            tool_orchestrator=None,
            settings_manager=None,
        )


@pytest.mark.asyncio  
async def test_completions_stream_generation_error(agent_service, mock_repos):
    """测试流生成过程中的错误"""
    # Mock session
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    mock_session.character_id = "test_character"
    mock_session.character = MagicMock(spec=Character)
    mock_session.character.settings = {}
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # Mock LLM 服务抛出异常
    with patch('app.services.agent_service.LLMService') as mock_llm:
        mock_llm_instance = AsyncMock()
        mock_llm_instance.completions = AsyncMock(
            side_effect=Exception("Stream generation failed")
        )
        mock_llm.return_value = mock_llm_instance
        
        # TODO: 验证异常传播和清理逻辑
        pass


@pytest.mark.asyncio
async def test_tool_context_creation_error(agent_service, mock_repos):
    """测试创建工具上下文时的错误"""
    # Mock session with invalid settings
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    mock_session.character_id = "test_character"
    mock_session.character = MagicMock(spec=Character)
    mock_session.character.settings = None  # Invalid settings
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # TODO: 验证错误处理
    pass


@pytest.mark.asyncio
async def test_memory_manager_initialization_error(agent_service, mock_repos):
    """测试记忆管理器初始化错误"""
    # Mock session
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # Mock MemoryManagerService 抛出异常
    with patch('app.services.agent_service.MemoryManagerService') as mock_mm:
        mock_mm.return_value.get_system_prompt = AsyncMock(
            side_effect=Exception("Memory manager failed")
        )
        
        # TODO: 验证异常处理
        pass


@pytest.mark.asyncio
async def test_settings_merge_error(agent_service, mock_repos):
    """测试合并设置时的错误处理"""
    from unittest.mock import MagicMock
    
    # Mock session 对象
    mock_session = MagicMock()
    mock_session.settings = {"key": "value"}
    mock_session.character = MagicMock()
    mock_session.character.settings = {"key": 123, "other": "data"}
    
    # 调用方法（注意：这不是异步方法）
    session_settings, character_settings, merged_settings = agent_service._merge_settings(mock_session)
    
    # 验证返回值类型
    assert isinstance(session_settings, dict)
    assert isinstance(character_settings, dict)
    assert isinstance(merged_settings, dict)
    
    # 验证合并逻辑（会话优先）
    assert merged_settings["key"] == "value"  # 会话的值优先
    assert merged_settings["other"] == "data"  # 角色的值作为补充


# ========== 边界条件测试 ==========

@pytest.mark.asyncio
async def test_empty_conversation(agent_service, mock_repos):
    """测试空对话的处理"""
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    mock_session.character_id = "test_character"
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # Mock 获取消息返回空列表
    agent_service._get_conversation_messages = AsyncMock(return_value=[])
    
    # TODO: 验证空对话的处理逻辑
    pass


@pytest.mark.asyncio
async def test_very_long_conversation(agent_service, mock_repos):
    """测试超长对话的处理"""
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # Mock 获取大量消息
    messages = [MagicMock() for _ in range(1000)]
    agent_service._get_conversation_messages = AsyncMock(return_value=messages)
    
    # TODO: 验证性能和大文本处理
    pass


@pytest.mark.asyncio
async def test_concurrent_completions(agent_service, mock_repos):
    """测试并发完成请求的处理"""
    mock_session = MagicMock(spec=Session)
    mock_session.id = "test_session"
    
    mock_repos["session"].get_by_id = AsyncMock(return_value=mock_session)
    
    # 模拟多个并发请求
    tasks = []
    # TODO: 实现并发测试逻辑
    
    # TODO: 验证资源竞争和锁机制
    pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
