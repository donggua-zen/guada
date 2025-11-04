import ulid

from .database import ModelBase, db


class Message(ModelBase):
    __tablename__ = "message"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    session_id = db.Column(db.String, index=True)
    role = db.Column(db.String)
    content = db.Column(db.Text, nullable=True)
    reasoning_content = db.Column(db.Text, nullable=True)
    parent_id = db.Column(db.String, nullable=True)
    token_count = db.Column(db.Integer, nullable=True)
    meta_data = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
