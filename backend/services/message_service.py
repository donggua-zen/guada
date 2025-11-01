# message_service.py
import json
from sqlalchemy.orm import Session
from models import SessionLocal, Message
import ulid


class _MessageService:
    def __init__(self):
        self.db_session = SessionLocal()

    def __del__(self):
        self.db_session.close()

    def get_messages(
        self,
        session_id,
        start_message_id=None,
        tail_message_id=None,
        last_n_messages=None,
        order_type="asc",
    ):
        query = self.db_session.query(Message).filter(Message.session_id == session_id)

        if start_message_id is not None:
            query = query.filter(Message.id >= start_message_id)

        if tail_message_id is not None:
            query = query.filter(Message.id <= tail_message_id)

        if last_n_messages is not None:
            query.limit(last_n_messages)
        if order_type == "desc":
            query = query.order_by(Message.created_at.desc())
        else:
            query = query.order_by(Message.created_at.asc())
        messages = query.all()

        # 转换为字典列表
        result = [
            {
                "id": msg.id,
                "session_id": msg.session_id,
                "role": msg.role,
                "content": msg.content,
                "token_count": msg.token_count,
                "parent_id": msg.parent_id,
                "reasoning_content": msg.reasoning_content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                "meta_data": msg.meta_data if msg.meta_data else {},
            }
            for msg in messages
        ]

        return result

    def get_message(self, message_id):
        message = (
            self.db_session.query(Message).filter(Message.id == message_id).first()
        )
        if message:
            return {
                "id": message.id,
                "session_id": message.session_id,
                "role": message.role,
                "content": message.content,
                "token_count": message.token_count,
                "parent_id": message.parent_id,
                "reasoning_content": message.reasoning_content,
                "created_at": (
                    message.created_at.isoformat() if message.created_at else None
                ),
            }
        return None

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        parent_id: str = None,
        reasoning_content: str = None,
        meta_data: dict = None,
        token_count: int = None,
    ):
        message = Message(
            session_id=session_id,
            role=role,
            content=content,
            token_count=token_count,
            reasoning_content=reasoning_content,
            parent_id=parent_id,
            meta_data=json.dumps(meta_data),
        )

        self.db_session.add(message)
        self.db_session.commit()

        return {
            "id": message.id,
            "session_id": message.session_id,
            "role": message.role,
            "parent_id": message.parent_id,
            "content": message.content,
            "token_count": message.token_count,
            "reasoning_content": message.reasoning_content,
            "created_at": (
                message.created_at.isoformat() if message.created_at else None
            ),
        }

    def update_message(self, message_id, data):
        message = (
            self.db_session.query(Message).filter(Message.id == message_id).first()
        )
        if message:
            for key, value in data.items():
                if hasattr(message, key):
                    setattr(message, key, value)
            self.db_session.commit()

    def delete_message(self, message_id):
        message = (
            self.db_session.query(Message).filter(Message.id == message_id).first()
        )
        if message:
            self.db_session.delete(message)
            self.db_session.commit()

    def delete_messages_by_session_id(self, session_id):
        self.db_session.query(Message).filter(Message.session_id == session_id).delete()
        self.db_session.commit()


_message_service = _MessageService()


def get_message_service() -> _MessageService:
    return _message_service
