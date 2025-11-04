import ulid
from .database import db, ModelBase


class Character(ModelBase):
    __tablename__ = "character"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    # name = db.Column(db.String)
    user_id = db.Column(db.String, index=True)
    title = db.Column(db.String, index=True)
    description = db.Column(db.String, nullable=True)
    # identity = db.Column(db.String, nullable=True)
    # detailed_setting = db.Column(db.JSON, nullable=True)
    avatar_url = db.Column(db.String, nullable=True)
    # system_prompt = db.Column(db.Text, nullable=True)
    settings = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
