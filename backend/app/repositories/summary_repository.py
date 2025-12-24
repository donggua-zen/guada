# summary_service.py
from app.services.domain.llm_service import LLMRepositoryChunk
from typing import NamedTuple, Optional
from app.utils.chunking import chunking_messages
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.summary import Summary


class CompressionResult(NamedTuple):
    summary: Optional[str] = None
    last_message_id: Optional[str] = None
    active_messages: Optional[list] = None


class SummaryRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化SummaryRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def add_summary(
        self,
        session_id, summary, master_summary="", last_message_id="", history=[]
    ):
        summary_obj = Summary(
            session_id=session_id,
            master_summary=master_summary,
            last_message_id=last_message_id,
            history=history,
        )
        self.session.add(summary_obj)
        await self.session.flush()
        stmt = select(Summary).filter(Summary.id == summary_obj.id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_summary_by_session_id(self, session_id):
        stmt = select(Summary).filter(Summary.session_id == session_id)
        result = await self.session.execute(stmt)
        summary = result.scalar_one_or_none()
        if summary:
            return summary
        return None

    async def delete_summary_by_session_id(self, session_id):
        stmt = delete(Summary).where(Summary.session_id == session_id)
        result = await self.session.execute(stmt)
        return result.rowcount
