# message_service.py

from app.exceptions import APIException
from app.models.message_content import MessageContent
from app.repositories.file_repository import FileRepository
from app.repositories.message_repository import MessageRepository as MessageRepo

# from app.models.db_transaction import get_transaction_manager
from app.repositories.message_content_repository import MessageContentRepository
from app.schemas.common import PaginatedResponse
from app.schemas.message import MessageOut
from fastapi import HTTPException


class MessageService:
    def __init__(
        self,
        message_repo: MessageRepo,
        file_repo: FileRepository,
        content_repo: MessageContentRepository,
    ):
        self.message_repo = message_repo
        self.file_repo = file_repo
        self.content_repo = content_repo

    def __del__(self):
        pass

    async def get_messages(
        self,
        session_id,
        start_message_id=None,
        end_message_id=None,
        limit=None,
        order_type="asc",
    ):

        messages = await self.message_repo.get_messages(
            session_id,
            start_message_id,
            end_message_id,
            limit,
            order_type,
            with_files=True,
            with_contents=True,
        )
        print(messages)
        return PaginatedResponse(
            items=[MessageOut.model_validate(m) for m in messages], size=len(messages)
        )

    async def get_message(self, message_id):
        message = await self.message_repo.get_message(message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        return message

    async def add_message_content(
        self,
        message_id: str,
        content: str,
        reasoning_content: str = None,
        meta_data: dict = None,
    ):
        # 直接调用仓库方法，不再使用事务管理器
        message = await self.message_repo.get_message(message_id=message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

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
        await self.message_repo.session.flush()  # 刷新以确保更改生效
        return message
    # async def add_message_without_content(self, message_id: str):
    #     message = await self.message_repo.get_message(message_id=message_id)
    #     if not message:
    #         raise HTTPException(
                
    #         )
    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        files: list[str] = None,
        parent_id: str = None,
        replace_message_id: str = None,
        meta_data: dict = None,
    ):
        message = await self.message_repo.add_message(
            session_id=session_id,
            role=role,
            content=content,
            parent_id=parent_id,
            meta_data=meta_data or {},
        )
        if not message:
            raise HTTPException(status_code=500, detail="Failed to add message")
        if files:
            file_ids = [file["id"] for file in files]
            await self.file_repo.update_files(file_ids, {"message_id": message.id})

        # 由定时器清理旧文件
        # await self.file_repo.delete_not_related_files(session_id)

        if replace_message_id:
            await self.delete_message(replace_message_id)
        return message

    async def update_message(self, message_id, data):
        message = await self.message_repo.update_message(message_id, data)
        if not message:
            raise HTTPException(status_code=500, detail="Failed to update message")
        return message

    async def delete_message(self, message_id):
        message = await self.message_repo.get_message(message_id=message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        # 不再使用事务管理器
        if not await self.message_repo.delete_message(message_id):
            raise HTTPException(status_code=500, detail="Failed to delete message")
        if message.role == "user":
            await self.message_repo.delete_message_by_parent_id(message_id)

        return {}

    async def delete_messages_by_session_id(self, session_id):
        await self.message_repo.delete_messages_by_session_id(session_id)
        return {}

    async def set_message_current_content(self, message_id, content_id):
        # 直接调用仓库方法，不再使用事务管理器
        message = await self.message_repo.get_message(message_id)
        if not message:
            raise APIException("Message not found", status_code=404)
        found = False
        for content in message.contents:
            if content.id == content_id:
                found = True
                content.is_current = True
            else:
                content.is_current = False

        if not found:
            raise APIException("Content not found", status_code=404)
        await self.message_repo.session.flush()  # 刷新以确保更改生效

    async def import_messages(self, session_id, messages: list[dict]):
        # 直接调用仓库方法，不再使用事务管理器
        await self.message_repo.delete_messages_by_session_id(session_id)
        parent_id = None
        for msg in messages:
            message_in_db = await self.message_repo.add_message(
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
