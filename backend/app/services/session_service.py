# session_service.py
import os
import shutil
from app.repositories.character_repository import CharacterRepository
from app.repositories.session_repository import SessionRepository as SessionRepo


class SessionService:
    def __init__(self):
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

            fields = [
                "assistant_name",
                "assistant_identity",
                "system_prompt",
                "memory_type",
                "max_memory_length",
                "short_term_memory_length",
                "model_top_p",
                "model_temperature",
                "model_id",
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

            session = self.add_new_session(data)
            # 更安全的头像拷贝方式
            avatar_path = character["avatar_url"]
            if avatar_path.startswith("/static/avatars/"):
                source_file_path = os.path.join("app", avatar_path.lstrip("/"))
                if os.path.exists(source_file_path):
                    target_file_path = os.path.join(
                        "app", "static", "avatars", f"session-{session['id']}.jpg"
                    )
                    try:
                        shutil.copy2(source_file_path, target_file_path)
                        self.update_session(
                            session["id"],
                            {
                                "avatar_url": f"/static/avatars/session-{session['id']}.jpg"
                            },
                        )
                    except IOError as e:
                        print(f"Failed to copy avatar: {e}")
        else:
            session = self.add_new_session(data)

        if session is None:
            raise ValueError("Failed to create session")

        return session

    def get_all_sessions(self) -> list[dict]:
        sessions = SessionRepo.get_all_sessions()
        return sessions

    def add_new_session(self, data: dict):

        fields = [
            "title",
            "description",
            "avatar_url",
            "user_id",
        ]

        extended_fields = [
            "assistant_name",
            "assistant_identity",
            "system_prompt",
            "memory_type",
            "max_memory_length",
            "short_term_memory_length",
            "model_top_p",
            "model_temperature",
            "model_id",
        ]

        data_filtered = {
            field: data.get(field) for field in fields if data.get(field) is not None
        }

        settings = (
            {
                key: value
                for key, value in data.get("settings").items()
                if key in extended_fields
            }
            if data.get("settings")
            else {}
        )

        data_filtered["settings"] = settings

        # 创建字符对象
        session = SessionRepo.create_session(data_filtered)
        return session

    def update_session(self, session_id, data: dict):
        session = SessionRepo.update_session(session_id, data)
        if session:
            return session
        raise ValueError(f"Session with ID {session_id} does not exist.")

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
