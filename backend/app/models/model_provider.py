import ulid
from .database import ModelBase,db


class ModelProvider(ModelBase):
    __tablename__ = "model_provider"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    name = db.Column(db.String)
    provider = db.Column(db.String)
    api_url = db.Column(db.String)
    api_key = db.Column(db.String, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
