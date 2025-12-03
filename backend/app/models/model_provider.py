import ulid
from .database import ModelBase, db


class ModelProvider(ModelBase):
    __tablename__ = "model_provider"

    id = db.Column(db.String(26), primary_key=True, default=lambda: str(ulid.new()))
    user_id = db.Column(db.String(26), index=True)
    name = db.Column(db.String(32))
    provider = db.Column(db.String(32))
    api_url = db.Column(db.String(255))
    api_key = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
    models = db.relationship(
        "Model", back_populates="provider", cascade="all, delete-orphan"
    )
