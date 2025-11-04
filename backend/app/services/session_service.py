# session_service.py
from app.models import db, Session
from app.models.db_transaction import smart_transaction_manager


class SessionService:
    def __init__(self):
        pass

    def __del__(self):
        pass

    def create_or_resume_session(self, user_id: str, character_id: str, name: str):
        # 查询用户和角色对应的会话
        session = self.query_session(user_id=user_id, character_id=character_id)

        # 如果会话不存在，则创建新的会话；否则返回已存在的会话
        if len(session) == 0:
            return self.add_new_session(user_id, character_id, name)
        else:
            return session[0]

    def get_all_sessions(self) -> list[dict]:
        sessions = db.session.query(Session).order_by(Session.updated_at.desc()).all()
        return [session.to_dict() for session in sessions]

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
        session = Session(
            **data_filtered,
        )
        with smart_transaction_manager.transaction():
            db.session.add(session)
        return session.to_dict()

    def update_session(self, session_id, data: dict):
        fields = ["title", "description", "avatar_url", "updated_at"]

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

        data_filtered = {}
        # 处理基础字段
        for field in fields:
            if field in data:
                data_filtered[field] = data[field]

        # 处理settings字段
        if "settings" in data:
            settings = {}
            for field in extended_fields:
                if field in data["settings"]:
                    settings[field] = data["settings"][field]
            data_filtered["settings"] = settings

        session = db.session.query(Session).filter(Session.id == session_id).first()
        if session:
            with smart_transaction_manager.transaction():
                for key, value in data_filtered.items():
                    if hasattr(session, key):
                        setattr(session, key, value)
            return session.to_dict()
        raise ValueError(f"Session with ID {session_id} does not exist.")

    def get_session_by_id(self, session_id):
        session = db.session.query(Session).filter(Session.id == session_id).first()
        if session:
            return session.to_dict()
        else:
            return None

    def query_session(self, session_id=None, user_id=None, character_id=None):
        query = db.session.query(Session)

        if session_id is not None:
            query = query.filter(Session.id == session_id)
        if user_id is not None:
            query = query.filter(Session.user_id == user_id)
        if character_id is not None:
            query = query.filter(Session.character_id == character_id)

        sessions = query.all()

        return [session.to_dict() for session in sessions]

    def delete_session(self, session_id):
        session = db.session.query(Session).filter(Session.id == session_id).first()
        if session:
            with smart_transaction_manager.transaction():
                db.session.delete(session)
