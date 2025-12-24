from datetime import datetime, timezone
from sqlalchemy import JSON, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship
import ulid
from app.database import ModelBase


class Summary(ModelBase):
    __tablename__ = "summary"
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    # session_id = Column(String(26), index=True)
    session_id = Column(
        String(26),
        ForeignKey("session.id", ondelete="CASCADE", name="fk_summary_session_id"),
        index=True,
    )
    master_summary = Column(Text, nullable=True)
    last_message_id = Column(String(26), nullable=True)
    history = Column(JSON, nullable=True)  # 存储摘要历史
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    session = relationship("Session", back_populates="summary")
