# session_service.py
from app.models.user import User
from app.repositories.character_repository import CharacterRepository
from app.repositories.session_repository import SessionRepository as SessionRepo
from app.services.upload_service import UploadService
from app.utils import convert_webpath_to_filepath, remove_file
from app.schemas.common import PaginatedResponse
from app.schemas.session import SessionOut
from fastapi import HTTPException

# from app.models.db_transaction import get_transaction_manager


class SessionService:
    def __init__(self, session_repo: SessionRepo, character_repo: CharacterRepository):
        # 初始化UploadService实例，避免重复创建
        self.upload_service = UploadService()
        self.session_repo = session_repo
        self.character_repo = character_repo

    def __del__(self):
        pass

    async def create_session(self, user: User, data: dict):
        character_id = data.get("character_id", None)
        if character_id is not None:
            character = await self.character_repo.get_character_by_id(character_id)
            data["title"] = character.title
            data["avatar_url"] = character.avatar_url
            data["description"] = character.description
            data["model_id"] = character.model_id
            data["user_id"] = user.id  # 添加用户ID

            # 更优雅地复制字段
            data["settings"] = character.settings

            # 使用实例变量避免重复创建
            avatar_path = (
                self.upload_service.duplicate_avatar(character.avatar_url)
                or character.avatar_url
            )
            if avatar_path:
                data["avatar_url"] = avatar_path
            session = await self._add_new_session(data)
        else:
            data["user_id"] = user.id  # 添加用户ID
            session = await self._add_new_session(data)

        if session is None:
            raise HTTPException(status_code=500, detail="Failed to create session")

        return session

    async def get_sessions(self, user: User) -> list[dict]:
        sessions = await self.session_repo.get_sessions(user.id)
        return PaginatedResponse(items=sessions, size=len(sessions))

    async def _add_new_session(self, data: dict):

        fields = [
            "title",
            "description",
            "avatar_url",
            "user_id",
            "model_id",
            "settings",
        ]

        data_filtered = {
            field: data.get(field) for field in fields if data.get(field) is not None
        }

        # 创建字符对象
        session = await self.session_repo.create_session(data_filtered)
        return session

    async def update_session(self, session_id, user: User, data: dict):

        # 验证会话是否属于当前用户
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )

        old_avatar_url = session.avatar_url

        session.update(data)

        if "avatar_url" in data and data["avatar_url"] != old_avatar_url:
            old_avatar_path = convert_webpath_to_filepath(old_avatar_url)
            if old_avatar_url:
                remove_file(old_avatar_path)
        await self.session_repo.session.flush()
        await self.session_repo.session.refresh(session)
        return session

    async def query_session(
        self, session_id=None, user: User = None, character_id=None
    ):

        sessions = await self.session_repo.query_session(
            session_id, user.id if user else None, character_id
        )

        if not sessions:  # 如果没有查询到结果，则返回None
            return PaginatedResponse(items=[], size=0)

        return PaginatedResponse(
            items=[SessionOut.model_validate(s) for s in sessions], size=len(sessions)
        )

    async def delete_session(self, session_id, user: User):
        # 验证会话是否属于当前用户
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )

        await self.session_repo.delete_session(session_id)

    async def get_session(self, session_id, user: User):
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )
        return session

    async def upload_avatar(self, session_id, user: User, avatar_file):
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )

        # 使用实例变量避免重复创建
        avatar_url = self.upload_service.upload_avatar(avatar_file, size=(128, 128))
        session.update({"avatar_url": avatar_url})
        return {"url": avatar_url}
