# session_service.py
from typing import Optional
from app.models import db, Session
from app.models.db_transaction import execute_in_transaction
from app.models.message import Message
from app.models.message_content import MessageContent


class SessionRepository:

    @staticmethod
    def get_sessions() -> list[dict]:
        sessions = db.session.query(Session).order_by(Session.updated_at.desc()).all()
        return [session.to_dict() for session in sessions]

    @staticmethod
    @execute_in_transaction
    def create_session(data: dict):
        # 创建字符对象
        session = Session(
            **data,
        )
        db.session.add(session)
        return session

    @staticmethod
    @execute_in_transaction
    def update_session(session_id, data: dict):
        return Session.query.filter(Session.id == session_id).update(data)

    @staticmethod
    def get_session_by_id(session_id):
        session = db.session.query(Session).filter(Session.id == session_id).first()
        return session

    @staticmethod
    def query_session(session_id=None, user_id=None, character_id=None):
        query = db.session.query(Session)

        if session_id is not None:
            query = query.filter(Session.id == session_id)
        if user_id is not None:
            query = query.filter(Session.user_id == user_id)
        if character_id is not None:
            query = query.filter(Session.character_id == character_id)

        return query.all()

    @staticmethod
    @execute_in_transaction
    def delete_session(session_id):
        return db.session.query(Session).filter(Session.id == session_id).delete()

    @staticmethod
    def get_sessions_with_last_message_v2(user_id: Optional[str] = None):
        """
        获取会话列表及其最后一条消息

        通过使用窗口函数一次性查询所有会话及每个会话的最后一条消息内容，
        提高查询效率，避免N+1查询问题。

        Args:
            user_id (Optional[str]): 用户ID，如果提供则只返回该用户的会话

        Returns:
            list: 包含会话对象及最后一条消息相关信息的元组列表
                  每个元素是一个包含Session对象、消息内容、推理内容和创建时间的元组
        """
        # 使用窗口函数获取每个会话的最新消息
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

        # 查询会话信息并关联最新的消息内容
        query = db.session.query(
            Session,
            subquery.c.content,
            subquery.c.reasoning_content,
            subquery.c.created_at,
        ).outerjoin(
            subquery,
            db.and_(
                Session.id == subquery.c.session_id,
                subquery.c.rn == 1,
            ),
        )

        # 根据用户ID过滤会话（如果提供了user_id）
        if user_id is not None:
            query = query.filter(Session.user_id == user_id)
        sessions_with_messages = query.all()
        return sessions_with_messages
        # 组装结果
        # result = []
        # for (
        #     session,
        #     content,
        #     reasoning_content,
        #     message_created_at,
        # ) in sessions_with_messages:
        #     session_data = session.to_dict()

        #     if content is not None:
        #         session_data["last_message"] = {
        #             "content": content,
        #             "reasoning_content": reasoning_content,
        #             "created_at": to_utc8_isoformat(message_created_at),
        #         }

        #     result.append(session_data)

        # return result
