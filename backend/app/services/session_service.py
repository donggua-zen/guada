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
        character_id = data.get("character_id")
        if not character_id:
            raise HTTPException(status_code=400, detail="character_id is required")

        # 获取角色信息
        character = await self.character_repo.get_character_by_id(character_id)
        if not character:
            raise HTTPException(
                status_code=404, detail=f"Character with ID {character_id} not found"
            )

        # 继承角色配置，只允许覆盖 model_id和 settings.max_memory_length
        session_data = {
            "user_id": user.id,
            "character_id": character_id,  # 绑定角色
            "title": character.title,  # 不再允许覆盖，直接使用角色的 title
            "avatar_url": character.avatar_url,  # 不再允许覆盖，直接使用角色的 avatar
            "description": character.description,  # 不再允许覆盖，直接使用角色的 description
            "model_id": data.get("model_id", character.model_id),  # 允许覆盖
        }

        # 合并 settings：只从角色继承 max_memory_length，然后合并用户传入的设置（用户设置优先）
        session_data["settings"] = {}

        # 1. 从角色继承 max_memory_length
        if character.settings and "max_memory_length" in character.settings:
            session_data["settings"]["max_memory_length"] = character.settings[
                "max_memory_length"
            ]

        # 2. 合并用户传入的设置（会覆盖继承的值）
        if data.get("settings"):
            session_data["settings"].update(data["settings"])

        session = await self._add_new_session(session_data)

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
            "character_id",
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

        # 只允许更新 model_id 和 settings.max_memory_length
        allowed_fields = ["model_id", "settings"]
        filtered_data = {k: v for k, v in data.items() if k in allowed_fields}

        # 如果更新了 settings，只保留 max_memory_length
        if "settings" in filtered_data:
            filtered_data["settings"] = {
                "max_memory_length": filtered_data["settings"].get("max_memory_length"),
                "thinking_enabled": filtered_data["settings"].get("thinking_enabled"),
            }

        session.update(filtered_data)

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
