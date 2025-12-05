# summary_service.py
from app.services.domain.llm_service import LLMRepositoryChunk
from typing import NamedTuple, Optional
from app.utils.chunking import chunking_messages
from app.models import db, Summary
from app.models.db_transaction import execute_in_transaction


class CompressionResult(NamedTuple):
    summary: Optional[str] = None
    last_message_id: Optional[str] = None
    active_messages: Optional[list] = None


class SummaryRepository:

    @staticmethod
    @execute_in_transaction
    def add_summary(
        session_id, summary, master_summary="", last_message_id="", history=[]
    ):
        summary = Summary(
            session_id=session_id,
            master_summary=master_summary,
            last_message_id=last_message_id,
            history=history,
        )
        db.session.add(summary)
        return summary.to_dict(flush=True)

    @staticmethod
    def get_summary_by_session_id(session_id):
        summary = (
            db.session.query(Summary).filter(Summary.session_id == session_id).first()
        )
        if summary:
            return summary
        return None

    @staticmethod
    @execute_in_transaction
    def delete_summary_by_session_id(session_id):
        summary = (
            db.session.query(Summary).filter(Summary.session_id == session_id).first()
        )
        if summary:
            db.session.delete(summary)
