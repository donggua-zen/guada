# session_service.py
import os
import shutil
from typing import Optional
from app.repositories.character_repository import CharacterRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.session_repository import SessionRepository as SessionRepo
from app.services.upload_service import UploadService
from app.utils import remove_file


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
            data["title"] = character["title"]
            data["avatar_url"] = character["avatar_url"]
            data["description"] = character["description"]
            data["model_id"] = character["model_id"]

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
            if "settings" in character:
                data["settings"].update(
                    {
                        field: character["settings"][field]
                        for field in fields
                        if field in character["settings"]
                    }
                )

            # 使用实例变量避免重复创建
            avatar_path = (
                self.upload_service.duplicate_avatar(character["avatar_url"])
                or character["avatar_url"]
            )
            data["avatar_url"] = avatar_path
            session = self.add_new_session(data)
        else:
            session = self.add_new_session(data)

        if session is None:
            raise ValueError("Failed to create session")

        return session

    def get_sessions(self, user_id: Optional[str] = None) -> list[dict]:
        # sessions = SessionRepo.get_sessions()
        # return sessions
        return SessionRepo.get_sessions_with_last_message_v2(user_id)

    def add_new_session(self, data: dict):

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
        session = self.get_session_by_id(session_id)
        if not session:
            raise ValueError(f"Session with ID {session_id} does not exist.")

        SessionRepo.update_session(session_id, data)

        if "avatar_url" in data and data["avatar_url"] != session["avatar_url"]:
            old_avatar_url = session["avatar_url"]
            old_avatar_path = self.upload_service.convert_webpath_to_filepath(
                old_avatar_url
            )
            if old_avatar_url:
                remove_file(old_avatar_path)

        session.update(data)
        return session

    def get_session_by_id(self, session_id):
        session = SessionRepo.get_session_by_id(session_id)
        if session:
            return session

        raise ValueError(f"Session with ID {session_id} does not exist.")

    def query_session(self, session_id=None, user_id=None, character_id=None):

        sessions = SessionRepo.query_session(session_id, user_id, character_id)

        if not sessions:  # 如果没有查询到结果，则返回None
            return []

        return sessions

    def delete_session(self, session_id):
        SessionRepo.delete_session(session_id)

    def get_session_by_id(self, session_id):
        return SessionRepo.get_session_by_id(session_id)

    def upload_avatar(self, session_id, avatar_file):
        session = self.get_session_by_id(session_id)
        if not session:
            raise ValueError(f"Session with ID {session_id} does not exist.")

        # 使用实例变量避免重复创建
        avatar_url = self.upload_service.upload_avatar(avatar_file, size=(128, 128))
        # old_avatar_url = session["avatar_url"]
        self.update_session(session_id, {"avatar_url": avatar_url})
        # 已经在update_session中处理了
        # os.remove(self.upload_service.convert_webpath_to_filepath(old_avatar_url))
        return {"url": avatar_url}
