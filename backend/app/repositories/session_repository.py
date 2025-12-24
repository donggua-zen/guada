# session_service.py
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_, or_, delete
from sqlalchemy.orm import selectinload
from app.models.session import Session
from app.models.message import Message
from app.models.message_content import MessageContent


class SessionRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化SessionRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def get_sessions(self, user_id: str) -> list[dict]:
        stmt = (
            select(Session)
            .filter(Session.user_id == user_id)
            .order_by(desc(Session.updated_at))
        )
        result = await self.session.execute(stmt)
        sessions = result.scalars().all()
        return sessions

    async def create_session(self, data: dict):
        # 创建会话对象
        session = Session(**data)
        self.session.add(session)
        await self.session.flush()
        return await self.get_session_by_id(session.id)

    async def update_session(self, session_id, data: dict):
        stmt = select(Session).filter(Session.id == session_id)
        result = await self.session.execute(stmt)
        session = result.scalar_one_or_none()

        if session:
            for key, value in data.items():
                setattr(session, key, value)
            await self.session.flush()
            return await self.get_session_by_id(session.id)
        return None

    async def get_session_by_id(self, session_id):
        stmt = select(Session).filter(Session.id == session_id)
        stmt = stmt.options(selectinload(Session.model))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def query_session(self, session_id=None, user_id=None, character_id=None):
        stmt = select(Session)

        if session_id is not None:
            stmt = stmt.filter(Session.id == session_id)
        if user_id is not None:
            stmt = stmt.filter(Session.user_id == user_id)
        if character_id is not None:
            stmt = stmt.filter(Session.character_id == character_id)

        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def delete_session(self, session_id):
        stmt = delete(Session).where(Session.id == session_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def get_sessions_with_last_message_v2(self, user_id: Optional[str] = None):
        """
        获取会话列表及其最后一条消息

        通过使用窗口函数一次性查询所有会话及每个会话的最后一条消息内容，
        提高查询效率，避免N+1查询问题。

        Args:
            user_id (Optional[str]): 用户ID，如果提供则只返回该用户的会话

        Returns:
            list: 包含会话对象及最后一条消息相关信息的元组列表
                  每个元素是一个包含Session对象、消息内容、推理内容和创建时间的元组
        """
        # 使用窗口函数获取每个会话的最新消息
        subquery_stmt = (
            select(
                Message.session_id,
                MessageContent.content,
                MessageContent.reasoning_content,
                MessageContent.created_at,
                Message.id,
                func.row_number()
                .over(
                    partition_by=Message.session_id,
                    order_by=[
                        desc(Message.id),
                        desc(MessageContent.is_current),
                    ],
                )
                .label("rn"),
            )
            .join(MessageContent, Message.id == MessageContent.message_id)
            .filter(MessageContent.is_current == True)
            .subquery()
        )

        # 查询会话信息并关联最新的消息内容
        stmt = select(
            Session,
            subquery_stmt.c.content,
            subquery_stmt.c.reasoning_content,
            subquery_stmt.c.created_at,
        ).outerjoin(
            subquery_stmt,
            and_(
                Session.id == subquery_stmt.c.session_id,
                subquery_stmt.c.rn == 1,
            ),
        )

        # 根据用户ID过滤会话（如果提供了user_id）
        if user_id is not None:
            stmt = stmt.filter(Session.user_id == user_id)

        result = await self.session.execute(stmt)
        sessions_with_messages = result.all()
        return sessions_with_messages