# dependencies.py
from typing import AsyncGenerator, Type, TypeVar
from fastapi import Depends, HTTPException
from fastapi import status
from jose import JWTError
import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.models.user import User
from app.repositories.character_repository import CharacterRepository
from app.repositories.file_repository import FileRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.model_repository import ModelRepository
from app.repositories.session_repository import SessionRepository
from app.repositories.user_repository import UserRepository
from app.repositories.mcp_server_repository import MCPServerRepository
from app.security import ALGORITHM, SECRET_KEY, oauth2_scheme
from app.services.character_service import CharacterService
from app.services.chat.memory_manager_service import MemoryManagerService
from app.services.agent_service import AgentService
from app.services.enhanced_file_service import EnhancedFileService
from app.services.message_service import MessageService
from app.services.model_service import ModelService
from app.services.session_service import SessionService
from app.services.settings_manager import SettingsManager
from app.services.tools.providers.knowledge_base_tool_provider import (
    KnowledgeBaseToolProvider,
)
from app.services.user_service import UserService
from app.services.mcp_server_service import MCPServerService
from app.services.mcp.tool_manager import MCPToolManager
from app.services.tools.tool_orchestrator import ToolOrchestrator
from app.services.tools.providers.local_tool_provider import LocalToolProvider
from app.services.tools.providers.mcp_tool_provider import (
    MCPToolProvider as NewMCPToolProvider,
)
from app.services.tools.providers.memory_tool_provider import MemoryToolProvider


T = TypeVar("T")


def create_repo_dependency(repo_class: Type[T]):
    def dependency(session: AsyncSession = Depends(get_db_session)) -> T:
        return repo_class(session)

    return dependency


get_character_repository = create_repo_dependency(CharacterRepository)
get_message_repository = create_repo_dependency(MessageRepository)
get_session_repository = create_repo_dependency(SessionRepository)
get_model_repository = create_repo_dependency(ModelRepository)
get_user_repository = create_repo_dependency(UserRepository)
get_file_repository = create_repo_dependency(FileRepository)
get_mcp_server_repository = create_repo_dependency(MCPServerRepository)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """
    从请求头 Authorization: Bearer <token> 中提取并验证 token
    返回用户信息（这里简化为返回 user_id）
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        # 这里你可以查询数据库获取完整用户对象
        user = await user_repo.get_user_by_id(user_id)
        if user is None:
            raise credentials_exception
        return user
    except JWTError:
        raise credentials_exception


async def get_settings_service(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    user_id = user.id if user.role == "primary" else user.parent_id
    settings = SettingsManager(
        user_id=user_id,
        session=session,
    )
    await settings.load()
    return settings


def get_message_service(
    message_repo: MessageRepository = Depends(get_message_repository),
    file_repo: FileRepository = Depends(get_file_repository),
    content_repo: FileRepository = Depends(get_file_repository),
) -> MessageService:
    """消息服务依赖"""
    return MessageService(
        message_repo=message_repo, file_repo=file_repo, content_repo=content_repo
    )


def get_memory_manager_service(
    message_repo: MessageRepository = Depends(get_message_repository),
) -> MemoryManagerService:
    """内存管理服务依赖"""
    return MemoryManagerService(message_repo=message_repo)


def get_local_tool_provider() -> LocalToolProvider:
    """创建本地工具提供者"""
    from app.services.domain.function_calling.utils import (
        get_current_time,
        function_schema,
    )

    provider = LocalToolProvider()
    provider.register(
        name="get_current_time",
        func=get_current_time,
        schema=function_schema(get_current_time),
    )

    return provider


def get_memory_tool_provider(
    session: AsyncSession = Depends(get_db_session),
) -> MemoryToolProvider:
    """创建记忆工具提供者"""
    provider = MemoryToolProvider(session)
    return provider


def get_mcp_tool_provider(
    session: AsyncSession = Depends(get_db_session),
) -> NewMCPToolProvider:
    """创建 MCP 工具提供者"""
    return NewMCPToolProvider(session)


def get_knowledge_base_tool_provider(
    session: AsyncSession = Depends(get_db_session),
) -> KnowledgeBaseToolProvider:
    """创建知识库工具提供者"""
    return KnowledgeBaseToolProvider(session)


def get_tool_orchestrator(
    session: AsyncSession = Depends(get_db_session),
) -> ToolOrchestrator:
    """创建工具编排器（自动注入所有 Provider）"""
    orchestrator = ToolOrchestrator()

    # 添加提供者（按优先级排序）
    orchestrator.add_provider(get_local_tool_provider(), priority=0)  # 本地工具优先级高
    orchestrator.add_provider(
        get_memory_tool_provider(session), priority=5  # 新增  # 记忆工具中等优先级
    )
    orchestrator.add_provider(
        get_knowledge_base_tool_provider(session),
        priority=5,  # 新增  # 知识库工具中等优先级
    )
    orchestrator.add_provider(
        get_mcp_tool_provider(session), priority=1  # MCP 工具优先级低
    )

    return orchestrator


def get_agent_service(
    session_repo: SessionRepository = Depends(get_session_repository),
    model_repo: ModelRepository = Depends(get_model_repository),
    message_repo: MessageService = Depends(get_message_repository),
    memory_manager_service: MemoryManagerService = Depends(get_memory_manager_service),
    settings_manager: SettingsManager = Depends(get_settings_service),
    mcp_tool_manager: MCPToolManager = Depends(create_repo_dependency(MCPToolManager)),
    tool_orchestrator: ToolOrchestrator = Depends(get_tool_orchestrator),  # 新增依赖
) -> AgentService:
    """聊天服务依赖"""
    return AgentService(
        session_repo=session_repo,
        model_repo=model_repo,
        message_repo=message_repo,
        memory_manager_service=memory_manager_service,
        setting_service=settings_manager,
        mcp_tool_manager=mcp_tool_manager,
        tool_orchestrator=tool_orchestrator,  # 传入工具编排器
    )


def get_character_service(
    character_repo: CharacterRepository = Depends(get_character_repository),
    user_repo: UserRepository = Depends(get_user_repository),
) -> CharacterService:
    """角色服务依赖"""
    return CharacterService(character_repo=character_repo, user_repo=user_repo)


def get_session_service(
    session_repo: SessionRepository = Depends(get_session_repository),
    character_repo: CharacterRepository = Depends(get_character_repository),
    message_repo: MessageRepository = Depends(get_message_repository),
    model_repo: ModelRepository = Depends(get_model_repository),
    setting_service: SettingsManager = Depends(get_settings_service),
) -> SessionService:
    """会话服务依赖"""
    return SessionService(
        session_repo=session_repo,
        character_repo=character_repo,
        message_repo=message_repo,
        model_repo=model_repo,
        setting_service=setting_service,
    )


def get_model_service(
    model_repo: ModelRepository = Depends(get_model_repository),
) -> ModelService:
    return ModelService(model_repo=model_repo)


def get_user_service(
    user_repo: UserRepository = Depends(get_user_repository),
) -> UserService:
    return UserService(user_repo=user_repo)


def get_file_service(
    file_repo: FileRepository = Depends(get_file_repository),
) -> EnhancedFileService:
    """
    文件服务依赖

    返回 EnhancedFileService 实例，提供完整的文件上传功能
    """
    return EnhancedFileService(file_repo)


def get_mcp_server_service(
    mcp_repo: MCPServerRepository = Depends(get_mcp_server_repository),
) -> MCPServerService:
    """MCP 服务器服务依赖"""
    return MCPServerService(mcp_repo=mcp_repo)


# async def get_character_repository(
#     session=Depends(get_db_session),
# ) -> AsyncGenerator[CharacterRepository, None]:
#     return CharacterRepository(session)
