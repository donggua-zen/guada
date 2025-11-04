# message_service.py
import json
from app.models import db, Message
from app.models.db_transaction import smart_transaction_manager


class MessageService:
    def __init__(self):
        pass

    def __del__(self):
        pass

    def get_messages(
        self,
        session_id,
        start_message_id=None,
        tail_message_id=None,
        last_n_messages=None,
        order_type="asc",
    ):
        query = db.session.query(Message).filter(Message.session_id == session_id)

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
        result = [msg.to_dict() for msg in messages]

        return result

    def get_message(self, message_id):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            return message.to_dict()
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
        #with smart_transaction_manager.transaction():
        db.session.add(message)
        db.session.commit()
        return message.to_dict()

    def update_message(self, message_id, data):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            with smart_transaction_manager.transaction():
                for key, value in data.items():
                    if hasattr(message, key):
                        setattr(message, key, value)

    def delete_message(self, message_id):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            with smart_transaction_manager.transaction():
                db.session.delete(message)

    def delete_messages_by_session_id(self, session_id):
        with smart_transaction_manager.transaction():
            db.session.query(Message).filter(Message.session_id == session_id).delete()
