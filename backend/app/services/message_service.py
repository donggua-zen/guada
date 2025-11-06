# message_service.py
import json
from app.repositories.message_repository import MessageRepository as MessageRepo


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

        return MessageRepo.get_messages(
            session_id,
            start_message_id,
            tail_message_id,
            last_n_messages,
            order_type,
            with_files=True,
        )

    def get_message(self, message_id):
        message = MessageRepo.get_message(message_id)
        if not message:
            raise Exception("Message not found")
        return message

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
        message = MessageRepo.add_message(
            session_id=session_id,
            role=role,
            content=content,
            token_count=token_count,
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
