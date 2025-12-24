# models.py

from typing import TYPE_CHECKING
import ulid
from sqlalchemy import String, DateTime, JSON, ForeignKey, Column, Integer
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func
from app.database import ModelBase

if TYPE_CHECKING:
    from .model_provider import ModelProvider


class Model(ModelBase):
    __tablename__ = "model"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    name = Column(String(255), nullable=True)
    provider_id = Column(
        String(26),
        ForeignKey("model_provider.id", ondelete="CASCADE"),
        index=True,
    )
    model_name = Column(String(255))
    model_type = Column(String(255))
    max_tokens = Column(Integer, nullable=True)
    max_output_tokens = Column(Integer, nullable=True)
    features = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )

    provider: Mapped["ModelProvider"] = relationship(
        "ModelProvider", back_populates="models"
    )