from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.message_content import MessageContent


class MessageContentRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化MessageContentRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def add_content(
        self,
        message_id: str,
        content: str,
        reasoning_content: str = None,
        meta_data: dict = None,
        set_current: bool = True,
    ):
        # if set_current:
        #     # 批量更新：将该消息的所有内容 is_current 设为 False
        #     stmt = select(MessageContent).filter(
        #         MessageContent.message_id == message_id,
        #         MessageContent.is_current == True,
        #     )
        #     result = await self.session.execute(stmt)
        #     message_contents = result.scalars().all()
        #     for msg_content in message_contents:
        #         msg_content.is_current = False

        message_content = MessageContent(
            message_id=message_id,
            content=content,
            reasoning_content=reasoning_content,
            meta_data=meta_data,
            # is_current=set_current,
        )

        self.session.add(message_content)
        await self.session.flush()
        return await self.get_content(message_content.id)

    async def delete_content(self, id: str):
        stmt = delete(MessageContent).where(MessageContent.id == id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def get_content(self, id: str):
        stmt = select(MessageContent).filter(MessageContent.id == id).limit(1)
        result = await self.session.execute(stmt)
        message_content = result.scalar_one_or_none()

        if message_content is None:
            return None
        return message_content