# session_service.py
from app.models import db, Session
from app.models.db_transaction import smart_transaction_manager
from app.models.message import Message
from app.models.message_content import MessageContent
from app.utils import to_utc8_isoformat


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
        return Session.query.filter(Session.id == session_id).update(data)

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

    @staticmethod
    def get_sessions_with_last_message_v2():

        # 使用窗口函数一次性查询
        subquery = (
            db.session.query(
                Message.session_id,
                MessageContent.content,
                MessageContent.reasoning_content,
                MessageContent.created_at,
                Message.id,
                db.func.row_number()
                .over(
                    partition_by=Message.session_id,
                    order_by=[
                        db.desc(Message.id),
                        db.desc(MessageContent.is_current),
                    ],
                )
                .label("rn"),
            )
            .join(MessageContent, Message.id == MessageContent.message_id)
            .filter(MessageContent.is_current == True)
            .subquery()
        )

        # 查询session和最后一条消息
        sessions_with_messages = (
            db.session.query(
                Session,
                subquery.c.content,
                subquery.c.reasoning_content,
                subquery.c.created_at,
            )
            .outerjoin(
                subquery,
                db.and_(Session.id == subquery.c.session_id, subquery.c.rn == 1),
            )
            .all()
        )

        # 组装结果
        result = []
        for (
            session,
            content,
            reasoning_content,
            message_created_at,
        ) in sessions_with_messages:
            session_data = session.to_dict()

            if content is not None:
                session_data["last_message"] = {
                    "content": content,
                    "reasoning_content": reasoning_content,
                    "created_at": to_utc8_isoformat(message_created_at),
                }

            result.append(session_data)

        return result
