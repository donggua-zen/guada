# session_service.py
from sqlalchemy.orm import Session
from models import SessionLocal, Session as SessionModel


class _SessionService:
    def __init__(self):
        self.db_session = SessionLocal()

    def __del__(self):
        self.db_session.close()

    def create_or_resume_session(self, user_id: str, character_id: str, name: str):
        # 查询用户和角色对应的会话
        session = self.query_session(user_id=user_id, character_id=character_id)

        # 如果会话不存在，则创建新的会话；否则返回已存在的会话
        if len(session) == 0:
            return self.add_new_session(user_id, character_id, name)
        else:
            return session[0]

    def get_all_sessions(self):
        sessions = self.db_session.query(SessionModel).all()
        return [
            {
                "id": session.id,
                "user_id": session.user_id,
                "character_id": session.character_id,
                "memory_type": session.memory_type,
                "model": session.model,
                "created_at": (
                    session.created_at.isoformat() if session.created_at else None
                ),
            }
            for session in sessions
        ]

    def add_new_session(self, user_id: str, character_id: str, name: str):
        session = SessionModel(user_id=user_id, character_id=character_id, name=name)

        self.db_session.add(session)
        self.db_session.commit()

        return {
            "id": session.id,
            "user_id": session.user_id,
            "character_id": session.character_id,
            "memory_type": session.memory_type,
            "model": session.model,
            "created_at": (
                session.created_at.isoformat() if session.created_at else None
            ),
        }

    def update_session(self, session_id, new_data: dict):
        allowed_keys = ["memory_type", "model", "name"]
        for key in new_data.keys():
            if key not in allowed_keys:
                raise ValueError(f"Invalid key '{key}' in new_data.")

        session = (
            self.db_session.query(SessionModel)
            .filter(SessionModel.id == session_id)
            .first()
        )
        if session:
            for key, value in new_data.items():
                if hasattr(session, key):
                    setattr(session, key, value)
            self.db_session.commit()

    def get_session_by_id(self, session_id):
        session = (
            self.db_session.query(SessionModel)
            .filter(SessionModel.id == session_id)
            .first()
        )
        if session:
            return {
                "id": session.id,
                "user_id": session.user_id,
                "character_id": session.character_id,
                "memory_type": session.memory_type,
                "model": session.model,
                "created_at": (
                    session.created_at.isoformat() if session.created_at else None
                ),
            }
        else:
            return None

    def query_session(self, session_id=None, user_id=None, character_id=None):
        query = self.db_session.query(SessionModel)

        if session_id is not None:
            query = query.filter(SessionModel.id == session_id)
        if user_id is not None:
            query = query.filter(SessionModel.user_id == user_id)
        if character_id is not None:
            query = query.filter(SessionModel.character_id == character_id)

        sessions = query.all()
        return [
            {
                "id": session.id,
                "name": session.name,
                "user_id": session.user_id,
                "character_id": session.character_id,
                "memory_type": session.memory_type,
                "model": session.model,
                "created_at": (
                    session.created_at.isoformat() if session.created_at else None
                ),
            }
            for session in sessions
        ]

    def delete_session(self, session_id):
        session = (
            self.db_session.query(SessionModel)
            .filter(SessionModel.id == session_id)
            .first()
        )
        if session:
            self.db_session.delete(session)
            self.db_session.commit()


_session_service = _SessionService()


def get_session_service() -> _SessionService:
    return _session_service
