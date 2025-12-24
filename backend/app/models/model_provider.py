from datetime import datetime, timezone
from typing import TYPE_CHECKING, List
import ulid
from sqlalchemy import String, DateTime, ForeignKey, Column
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func
from app.database import ModelBase

if TYPE_CHECKING:
    from .model import Model


class ModelProvider(ModelBase):
    __tablename__ = "model_provider"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    user_id = Column(String(26), index=True)
    name = Column(String(32))
    provider = Column(String(32))
    api_url = Column(String(255))
    api_key = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    models: Mapped[List["Model"]] = relationship(
        "Model", back_populates="provider", cascade="all, delete-orphan"
    )