# session_service.py
from app.models import db, Session
from app.models.db_transaction import smart_transaction_manager


class SessionRepository:

    @staticmethod
    def get_all_sessions() -> list[dict]:
        sessions = db.session.query(Session).order_by(Session.updated_at.desc()).all()
        return [session.to_dict() for session in sessions]

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def create_session(data: dict):
        # 创建字符对象
        session = Session(
            **data,
        )
        db.session.add(session)
        return session.to_dict(flush=True)

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def update_session(session_id, data: dict):
        session = db.session.query(Session).filter(Session.id == session_id).first()
        if session:
            for key, value in data.items():
                if hasattr(session, key):
                    setattr(session, key, value)
            return session.to_dict(flush=True)
        raise None

    @staticmethod
    def get_session_by_id(session_id):
        session = db.session.query(Session).filter(Session.id == session_id).first()
        if session:
            return session.to_dict()
        else:
            return None

    @staticmethod
    def query_session(session_id=None, user_id=None, character_id=None):
        query = db.session.query(Session)

        if session_id is not None:
            query = query.filter(Session.id == session_id)
        if user_id is not None:
            query = query.filter(Session.user_id == user_id)
        if character_id is not None:
            query = query.filter(Session.character_id == character_id)

        sessions = query.all()

        return [session.to_dict() for session in sessions]

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_session(session_id):
        session = db.session.query(Session).filter(Session.id == session_id).first()
        if session:
            db.session.delete(session)
