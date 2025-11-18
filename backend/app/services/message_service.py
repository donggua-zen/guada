# message_service.py
import json
from app.repositories.message_content_repository import MessageContentRepository
from app.repositories.message_repository import MessageRepository as MessageRepo
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
        end_message_id=None,
        limit=None,
        order_type="asc",
    ):

        return MessageRepo.get_messages(
            session_id,
            start_message_id,
            end_message_id,
            limit,
            order_type,
            with_files=True,
            with_contents=True,
        )

    def get_message(self, message_id):
        message = MessageRepo.get_message(message_id)
        if not message:
            raise Exception("Message not found")
        return message

    def add_message_content(
        self,
        message_id: str,
        content: str,
        reasoning_content: str = None,
        meta_data: dict = None,
    ):
        message = MessageRepo.get_message(message_id=message_id)
        if not message:
            raise Exception("Message not found")

        # 此处并不会实际更改数据库，而是返回给前端使用的数据结构
        for old_content in message["contents"]:
            old_content.update(is_current=False)

        content = MessageContentRepository.add_content(
            message_id=message_id,
            content=content,
            reasoning_content=reasoning_content,
            meta_data=meta_data or {},
        )

        message["contents"].append(content)
        return message

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        parent_id: str = None,
        reasoning_content: str = None,
        meta_data: dict = None,
    ):
        message = MessageRepo.add_message(
            session_id=session_id,
            role=role,
            content=content,
            reasoning_content=reasoning_content,
            parent_id=parent_id,
            meta_data=meta_data or {},
        )
        if not message:
            raise Exception("Failed to add message")
        return message

    def update_message(self, message_id, data):
        message = MessageRepo.update_message(message_id, data)
        if not message:
            raise Exception("Failed to update message")
        return message

    def delete_message(self, message_id):
        if not MessageRepo.delete_message(message_id):
            raise Exception("Failed to delete message")
        return {}

    def delete_messages_by_session_id(self, session_id):
        if not MessageRepo.delete_messages_by_session_id(session_id):
            raise Exception("Failed to delete messages")
        return {}

    def set_message_current_content(self, content_id):
        content = MessageContentRepository.get_content(content_id)
        if not content:
            raise Exception("Content not found")
        MessageContentRepository.set_current_content(
            message_id=content["message_id"], content_id=content["id"]
        )

    def import_messages(self, session_id, messages: list[dict]):
        with smart_transaction_manager.transaction():
            MessageRepo.delete_messages_by_session_id(session_id)
            parent_id = None
            for msg in messages:
                message_in_db = MessageRepo.add_message(
                    session_id=session_id,
                    role=msg["role"],
                    content=msg["contents"],
                    files=msg["files"],
                    parent_id=parent_id,
                )

                if message_in_db and message_in_db["role"] == "user":
                    parent_id = message_in_db["id"]
                else:
                    parent_id = None
