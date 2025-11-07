# message_service.py
import json
from app.models import db, Message
from app.models.db_transaction import smart_transaction_manager


class MessageRepository:

    @staticmethod
    def get_messages(
        session_id,
        start_message_id=None,
        end_message_id=None,
        include_start=True,
        include_end=True,
        limit=None,
        offset=None,
        order_type="asc",
        with_files=False,
    ):
        query = db.session.query(Message).filter(Message.session_id == session_id)

        if start_message_id is not None:
            if include_start:
                query = query.filter(Message.id >= start_message_id)
            else:
                query = query.filter(Message.id > start_message_id)

        if end_message_id is not None:
            if include_end:
                query = query.filter(Message.id <= end_message_id)
            else:
                query = query.filter(Message.id < end_message_id)

        if order_type == "desc":
            query = query.order_by(Message.id.desc())
        else:
            query = query.order_by(Message.id.asc())

        if offset is not None:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)

        # 转换为字典列表
        if with_files:
            messages = query.options(db.joinedload(Message.files)).all()
            result = [msg.to_dict(include=["files"]) for msg in messages]
        else:
            messages = query.all()
            result = [msg.to_dict() for msg in messages]
        return result

    @staticmethod
    def get_messages_by_condition(session_id, condition):
        query = db.session.query(Message).filter(Message.session_id == session_id)
        if condition:
            query = query.filter(condition)
        messages = query.all()
        result = [msg.to_dict() for msg in messages]
        return result

    @staticmethod
    def get_message(message_id):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            return message.to_dict()
        return None

    @staticmethod
    def get_conversation_messages(session_id, parent_id):
        messages = (
            db.session.query(Message)
            .filter(Message.session_id == session_id, Message.parent_id == parent_id)
            .limit(2)
            .all()
        )
        if messages:
            return [msg.to_dict() for msg in messages]
        return []

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def add_message(
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
            meta_data=meta_data or {},
        )
        db.session.add(message)
        return message.to_dict(flush=True)

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def update_message(message_id, data):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            for key, value in data.items():
                if hasattr(message, key):
                    setattr(message, key, value)
            return message.to_dict(flush=True)
        return None

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_message(message_id):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            db.session.delete(message)
            return True
        return False

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_messages_by_session_id(session_id):
        db.session.query(Message).filter(Message.session_id == session_id).delete()
        return True
