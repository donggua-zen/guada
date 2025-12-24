# dependencies.py
from typing import AsyncGenerator, Type, TypeVar
from fastapi import Depends, HTTPException
from fastapi import status
from jose import JWTError
import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import db_manager, get_db_session
from app.repositories.character_repository import CharacterRepository
from app.repositories.file_repository import FileRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.model_repository import ModelRepository
from app.repositories.session_repository import SessionRepository
from app.repositories.user_repository import UserRepository
from app.security import ALGORITHM, SECRET_KEY, oauth2_scheme
from app.services.character_service import CharacterService
from app.services.chat.memory_manager_service import MemoryManagerService
from app.services.chat_service import ChatService
from app.services.file_service import FileService
from app.services.message_service import MessageService
from app.services.model_service import ModelService
from app.services.session_service import SessionService
from app.services.user_service import UserService


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


def get_chat_service(
    session_repo: SessionRepository = Depends(get_session_repository),
    model_repo: ModelRepository = Depends(get_model_repository),
    message_service: MessageService = Depends(get_message_service),
    memory_manager_service: MemoryManagerService = Depends(get_memory_manager_service),
) -> ChatService:
    """聊天服务依赖"""
    return ChatService(
        session_repo=session_repo,
        model_repo=model_repo,
        message_service=message_service,
        memory_manager_service=memory_manager_service,
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


# async def get_character_repository(
#     session=Depends(get_db_session),
# ) -> AsyncGenerator[CharacterRepository, None]:
#     return CharacterRepository(session)
