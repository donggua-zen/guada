# models.py

import ulid
from .database import ModelBase, db


class Model(ModelBase):
    __tablename__ = "model"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    name = db.Column(db.String, nullable=True)
    # provider_id = db.Column(db.String)
    provider_id = db.Column(
        db.String,
        db.ForeignKey(
            "model_provider.id", ondelete="CASCADE", name="fk_model_provider_id"
        ),
        index=True,
    )
    model_name = db.Column(db.String)
    model_type = db.Column(db.String)
    max_tokens = db.Column(db.Integer, nullable=True)
    max_output_tokens = db.Column(db.Integer, nullable=True)
    features = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    provider = db.relationship("ModelProvider", back_populates="models")
