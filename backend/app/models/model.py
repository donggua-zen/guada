# models.py

from typing import TYPE_CHECKING
import ulid
from .database import ModelBase, db

from sqlalchemy.orm import Mapped

if TYPE_CHECKING:
    from .model_provider import ModelProvider


class Model(ModelBase):
    __tablename__ = "model"

    id = db.Column(db.String(26), primary_key=True, default=lambda: str(ulid.new()))
    name = db.Column(db.String(255), nullable=True)
    provider_id = db.Column(
        db.String(26),
        db.ForeignKey(
            "model_provider.id", ondelete="CASCADE", name="fk_model_provider_id"
        ),
        index=True,
    )
    model_name = db.Column(db.String(255))
    model_type = db.Column(db.String(255))
    max_tokens = db.Column(db.Integer, nullable=True)
    max_output_tokens = db.Column(db.Integer, nullable=True)
    features = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    provider: Mapped["ModelProvider"] = db.relationship(
        "ModelProvider", back_populates="models"
    )
