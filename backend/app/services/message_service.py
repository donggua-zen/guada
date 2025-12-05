# message_service.py
import json
from app.models.message_content import MessageContent
from app.repositories.file_repository import FileRepository
from app.repositories.message_content_repository import MessageContentRepository
from app.repositories.message_repository import MessageRepository as MessageRepo
from app.models.db_transaction import smart_transaction, smart_transaction_manager


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

        messages = MessageRepo.get_messages(
            session_id,
            start_message_id,
            end_message_id,
            limit,
            order_type,
            with_files=True,
            with_contents=True,
        )
        return [message.to_dict(include=["files", "contents"]) for message in messages]

    def get_message(self, message_id):
        message = MessageRepo.get_message(message_id)
        if not message:
            raise Exception("Message not found")
        return message.to_dict()

    def add_message_content(
        self,
        message_id: str,
        content: str,
        reasoning_content: str = None,
        meta_data: dict = None,
    ):
        with smart_transaction():
            message = MessageRepo.get_message(message_id=message_id)
            if not message:
                raise Exception("Message not found")

            for old_content in message.contents:
                old_content.is_current = False

            message_conetnt = MessageContent(
                message_id=message_id,
                content=content,
                reasoning_content=reasoning_content,
                meta_data=meta_data,
                is_current=True,
            )

            message.contents.append(message_conetnt)
        return message.to_dict(include=["contents"])

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        files: list[str] = None,
        parent_id: str = None,
        replace_message_id: str = None,
        meta_data: dict = None,
    ):
        with smart_transaction():
            message = MessageRepo.add_message(
                session_id=session_id,
                role=role,
                content=content,
                parent_id=parent_id,
                meta_data=meta_data or {},
            )
            if not message:
                raise Exception("Failed to add message")
            if files:
                file_ids = [file["id"] for file in files]
                FileRepository.update_files(file_ids, {"message_id": message["id"]})

            # 由定时器清理旧文件
            # FileRepository.delete_not_related_files(session_id)

            if replace_message_id:
                self.delete_message(replace_message_id)
            message_dict = message.to_dict(flush=True)
            message_dict["files"] = files
            return message_dict

    def update_message(self, message_id, data):
        message = MessageRepo.update_message(message_id, data)
        if not message:
            raise Exception("Failed to update message")
        return message.to_dict()

    def delete_message(self, message_id):
        message = MessageRepo.get_message(
            message_id, with_contents=False, with_files=False
        )
        if not message:
            raise Exception("Message not found")
        with smart_transaction():
            if not MessageRepo.delete_message(message_id):
                raise Exception("Failed to delete message")
            if message.role == "user":
                MessageRepo.delete_message_by_parent_id(message_id)

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
        with smart_transaction():
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

                if message_in_db and message_in_db.role == "user":
                    parent_id = message_in_db.id
                else:
                    parent_id = None
