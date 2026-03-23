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
from app.services.file_service import FileService
from app.services.message_service import MessageService
from app.services.model_service import ModelService
from app.services.session_service import SessionService
from app.services.settings_manager import SettingsManager
from app.services.user_service import UserService
from app.services.mcp_server_service import MCPServerService


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


def get_agent_service(
    session_repo: SessionRepository = Depends(get_session_repository),
    model_repo: ModelRepository = Depends(get_model_repository),
    message_repo: MessageService = Depends(get_message_repository),
    memory_manager_service: MemoryManagerService = Depends(get_memory_manager_service),
    settings_manager: SettingsManager = Depends(get_settings_service),
) -> AgentService:
    """聊天服务依赖"""
    return AgentService(
        session_repo=session_repo,
        model_repo=model_repo,
        message_repo=message_repo,
        memory_manager_service=memory_manager_service,
        setting_service=settings_manager,
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
) -> SessionService:
    """会话服务依赖"""
    return SessionService(session_repo=session_repo, character_repo=character_repo)


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
) -> FileService:
    return FileService(file_repo=file_repo)


def get_mcp_server_service(
    mcp_repo: MCPServerRepository = Depends(get_mcp_server_repository),
) -> MCPServerService:
    """MCP 服务器服务依赖"""
    return MCPServerService(mcp_repo=mcp_repo)

# async def get_character_repository(
#     session=Depends(get_db_session),
# ) -> AsyncGenerator[CharacterRepository, None]:
#     return CharacterRepository(session)
