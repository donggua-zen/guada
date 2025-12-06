# session_service.py
import os
import shutil
from typing import Optional
from app.repositories.character_repository import CharacterRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.session_repository import SessionRepository as SessionRepo
from app.services.upload_service import UploadService
from app.utils import remove_file, to_utc8_isoformat
from app.models.db_transaction import smart_transaction, smart_transaction_manager


class SessionService:
    def __init__(self):
        # 初始化UploadService实例，避免重复创建
        self.upload_service = UploadService()
        pass

    def __del__(self):
        pass

    def create_session(self, data: dict):
        character_id = data.get("character_id", None)
        if character_id is not None:
            character = CharacterRepository.get_character_by_id(character_id)
            data["title"] = character.title
            data["avatar_url"] = character.avatar_url
            data["description"] = character.description
            data["model_id"] = character.model_id

            fields = [
                "assistant_name",
                "assistant_identity",
                "system_prompt",
                "memory_type",
                "max_memory_length",
                "model_top_p",
                "model_temperature",
            ]
            # 更优雅地复制字段

            data["settings"].update(
                {
                    field: character.settings[field]
                    for field in fields
                    if field in character.settings
                }
            )

            # 使用实例变量避免重复创建
            avatar_path = (
                self.upload_service.duplicate_avatar(character.avatar_url)
                or character.avatar_url
            )
            data["avatar_url"] = avatar_path
            session = self._add_new_session(data)
        else:
            session = self._add_new_session(data)

        if session is None:
            raise ValueError("Failed to create session")

        return session.to_dict(include=["model"])

    def get_sessions(self, user_id: Optional[str] = None) -> list[dict]:
        sessions = SessionRepo.get_sessions_with_last_message_v2(user_id)
        result = []
        for (
            session,
            content,
            reasoning_content,
            message_created_at,
        ) in sessions:
            session_data = session.to_dict()

            if content is not None:
                session_data["last_message"] = {
                    "content": content,
                    "reasoning_content": reasoning_content,
                    "created_at": to_utc8_isoformat(message_created_at),
                }

            result.append(session_data)

        return result

    def _add_new_session(self, data: dict):

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
        session = SessionRepo.create_session(data_filtered)
        return session

    def update_session(self, session_id, data: dict):

        with smart_transaction():
            session = self.get_session_by_id(session_id)
            if not session:
                raise ValueError(f"Session with ID {session_id} does not exist.")

            old_avatar_url = session.avatar_url

            session.update(data)

            if "avatar_url" in data and data["avatar_url"] != old_avatar_path:
                old_avatar_path = self.upload_service.convert_webpath_to_filepath(
                    old_avatar_url
                )
                if old_avatar_url:
                    remove_file(old_avatar_path)
            return session.to_dict(flush=True)

    def query_session(self, session_id=None, user_id=None, character_id=None):

        sessions = SessionRepo.query_session(session_id, user_id, character_id)

        if not sessions:  # 如果没有查询到结果，则返回None
            return []

        return sessions

    def delete_session(self, session_id):
        SessionRepo.delete_session(session_id)

    def get_session(self, session_id):
        session = SessionRepo.get_session_by_id(session_id)
        if not session:
            raise ValueError(f"Session with ID {session_id} does not exist.")
        return session.to_dict(include=["model"])

    def upload_avatar(self, session_id, avatar_file):
        session = SessionRepo.get_session_by_id(session_id)
        if not session:
            raise ValueError(f"Session with ID {session_id} does not exist.")

        # 使用实例变量避免重复创建
        avatar_url = self.upload_service.upload_avatar(avatar_file, size=(128, 128))
        session.update({"avatar_url": avatar_url})
        return {"url": avatar_url}
