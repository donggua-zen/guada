# message_service.py
import json
from typing import Optional
from app.models import db, Message
from app.models.db_transaction import smart_transaction_manager
from app.models.message_content import MessageContent


class MessageRepository:

    @staticmethod
    def get_messages(
        session_id: str,
        start_message_id: Optional[str] = None,
        end_message_id: Optional[str] = None,
        include_start=True,
        include_end=True,
        limit=None,
        offset=None,
        order_type="asc",
        with_files=False,
        with_contents=False,
        only_current_content=False,
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

        include = []
        # 转换为字典列表
        if with_files:
            query = query.options(db.selectinload(Message.files))
            include.append("files")
        if with_contents:
            if only_current_content:
                query = query.options(
                    db.selectinload(
                        Message.contents.and_(MessageContent.is_current == True)
                    )
                )
            else:
                query = query.options(db.selectinload(Message.contents))
            include.append("contents")
        # print("include",include)
        messages = query.all()

        result = [msg.to_dict(include=include) for msg in messages]
        return result

    @staticmethod
    def get_message(message_id, with_files=False, with_contents=True):
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if message:
            include = []
            if with_contents:
                include.append("contents")
            if with_files:
                include.append("files")
            return message.to_dict(include=include)
        return None

    @staticmethod
    def get_conversation_messages(
        session_id,
        parent_id,
        with_files=False,
        with_contents=True,
        only_current_content=False,
    ):

        query = (
            db.session.query(Message)
            .filter(Message.session_id == session_id, Message.parent_id == parent_id)
            .limit(2)
        )

        include = []
        # 转换为字典列表
        if with_files:
            query = query.options(db.selectinload(Message.files))
            include.append("files")
        if with_contents:
            if only_current_content:
                query = query.options(
                    db.selectinload(Message.versions).filter(
                        MessageContent.is_current == True
                    )
                )
            else:
                query = query.options(db.selectinload(Message.versions))
            include.append("contents")
        messages = query.all()
        if messages:
            return [msg.to_dict(include=include) for msg in messages]
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
    ):
        message_content = MessageContent(
            content=content,
            reasoning_content=reasoning_content,
            is_current=True,
            meta_data=meta_data or {},
        )
        message = Message(
            session_id=session_id,
            role=role,
            contents=[message_content],
            parent_id=parent_id,
        )
        db.session.add(message)
        return message.to_dict(flush=True, include=["contents"])

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def add_message_content(
        session_id: str,
        role: str,
        content: str,
        parent_id: str = None,
        reasoning_content: str = None,
        meta_data: dict = None,
    ):
        message_content = MessageContent(
            content=content,
            reasoning_content=reasoning_content,
            is_current=True,
            meta_data=meta_data or {},
        )
        message = Message(
            session_id=session_id,
            role=role,
            contents=[message_content],
            parent_id=parent_id,
        )
        db.session.add(message)
        return message.to_dict(flush=True, include=["contents"])

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def update_message(message_id, data):
        """
        更新指定消息的信息

        Args:
            message_id (str): 消息ID
            data (dict): 包含要更新的字段和值的字典

        Returns:
            dict: 更新后的消息信息，如果消息不存在则返回None
        """
        message = db.session.query(Message).filter(Message.id == message_id).first()
        if not message:
            return None

        # 分离消息字段和内容字段
        message_fields = {}
        content_fields = {}

        for key, value in data.items():
            if hasattr(message, key):
                message_fields[key] = value
            elif key in ["content", "reasoning_content", "meta_data"]:
                content_fields[key] = value

        # 更新消息表字段
        for key, value in message_fields.items():
            setattr(message, key, value)

        # 更新当前内容
        if content_fields:
            current_content = next((c for c in message.contents if c.is_current), None)
            if not current_content:
                return None
            for key, value in content_fields.items():
                if hasattr(current_content, key):
                    setattr(current_content, key, value)

        return message.to_dict(flush=True)

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_message(message_id):
        return db.session.query(Message).filter(Message.id == message_id).delete()

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_messages_by_session_id(session_id):
        return (
            db.session.query(Message).filter(Message.session_id == session_id).delete()
        )
