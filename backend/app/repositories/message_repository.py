# message_service.py
import json
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, asc, delete
from sqlalchemy.orm import selectinload
from app.models.message import Message
from app.models.message_content import MessageContent
from app.models.file import File as FileModel


class MessageRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化MessageRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def get_messages(
        self,
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
        stmt = select(Message).filter(Message.session_id == session_id)

        if start_message_id is not None:
            if include_start:
                stmt = stmt.filter(Message.id >= start_message_id)
            else:
                stmt = stmt.filter(Message.id > start_message_id)

        if end_message_id is not None:
            if include_end:
                stmt = stmt.filter(Message.id <= end_message_id)
            else:
                stmt = stmt.filter(Message.id < end_message_id)

        if order_type == "desc":
            stmt = stmt.order_by(desc(Message.id))
        else:
            stmt = stmt.order_by(asc(Message.id))

        if offset is not None:
            stmt = stmt.offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)

        # 加载关联数据
        if with_files:
            stmt = stmt.options(selectinload(Message.files))
        if with_contents:
            if only_current_content:
                stmt = stmt.options(
                    selectinload(
                        Message.contents.and_(MessageContent.is_current == True)
                    )
                )
            else:
                stmt = stmt.options(selectinload(Message.contents))

        result = await self.session.execute(stmt)
        messages = result.scalars().all()

        return messages

    async def get_message(
        self,
        message_id,
        with_files=False,
        with_contents=True,
        only_current_content=False,
    ):
        stmt = select(Message).filter(Message.id == message_id)
        if with_files:
            stmt = stmt.options(selectinload(Message.files))
        if with_contents:
            if only_current_content:
                stmt = stmt.options(
                    selectinload(
                        Message.contents.and_(MessageContent.is_current == True)
                    )
                )
            else:
                stmt = stmt.options(selectinload(Message.contents))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_conversation_messages(
        self,
        session_id,
        parent_id,
        with_files=False,
        with_contents=True,
        only_current_content=False,
    ):
        stmt = (
            select(Message)
            .filter(Message.session_id == session_id, Message.parent_id == parent_id)
            .limit(2)
        )

        # 加载关联数据
        if with_files:
            stmt = stmt.options(selectinload(Message.files))
        if with_contents:
            if only_current_content:
                stmt = stmt.options(
                    selectinload(Message.versions).filter(
                        MessageContent.is_current == True
                    )
                )
            else:
                stmt = stmt.options(selectinload(Message.versions))

        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str | list[dict],
        files: list[dict] = None,
        parent_id: str = None,
        reasoning_content: str = None,
        meta_data: dict = None,
    ):
        validated_contents = []
        validated_files = []

        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    raise TypeError("Each item in content list must be a dictionary")

                validated_contents.append(
                    MessageContent(
                        content=item.get("content"),
                        reasoning_content=item.get("reasoning_content"),
                        is_current=item.get("is_current") or True,
                        meta_data=item.get("meta_data") or {},
                    )
                )
        else:
            validated_contents.append(
                MessageContent(
                    content=content,
                    reasoning_content=reasoning_content,
                    is_current=True,
                    meta_data=meta_data or {},
                )
            )

        if isinstance(files, list):
            for item in files:
                if not isinstance(item, dict):
                    raise TypeError("Each item in files list must be a dictionary")

                validated_files.append(
                    FileModel(
                        content=item.get("content"),
                        file_name=item.get("file_name"),
                        file_extension=item.get("file_extension"),
                        display_name=item.get("display_name"),
                        file_type=item.get("file_type"),
                        file_size=item.get("file_size"),
                        session_id=item.get("session_id"),
                        # message_id=item.get("message_id"),
                        content_hash=item.get("content_hash"),
                    )
                )

        message = Message(
            session_id=session_id,
            role=role,
            files=validated_files,
            contents=validated_contents,
            parent_id=parent_id,
        )

        self.session.add(message)
        await self.session.flush()
        return await self.get_message(message.id, with_files=True, with_contents=True)

    async def update_message(self, message_id, data):
        """
        更新指定消息的信息

        Args:
            message_id (str): 消息ID
            data (dict): 包含要更新的字段和值的字典

        Returns:
            dict: 更新后的消息信息，如果消息不存在则返回None
        """
        stmt = select(Message).filter(Message.id == message_id)
        result = await self.session.execute(stmt)
        message = result.scalar_one_or_none()

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

        await self.session.flush()
        return await self.get_message(message.id, with_files=True, with_contents=True)

    async def delete_message(self, message_id: str):
        stmt = delete(Message).where(Message.id == message_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def delete_message_by_parent_id(self, parent_id: str):
        stmt = delete(Message).where(Message.parent_id == parent_id)
        result = await self.session.execute(stmt)
        return result.rowcount

    async def delete_messages_by_session_id(self, session_id):
        stmt = delete(Message).where(Message.session_id == session_id)
        result = await self.session.execute(stmt)
        return result.rowcount