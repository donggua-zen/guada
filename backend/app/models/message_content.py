import ulid

from .database import ModelBase, db


class MessageContent(ModelBase):
    __tablename__ = "message_content"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    # session_id = db.Column(db.String, index=True)
    message_id = db.Column(
        db.String,
        db.ForeignKey(
            "message.id", ondelete="CASCADE", name="fk_message_content_message_id"
        ),
        index=True,
    )
    is_current = db.Column(db.Boolean, default=False)
    content = db.Column(db.Text, nullable=True)
    reasoning_content = db.Column(db.Text, nullable=True)
    meta_data = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    message = db.relationship(
        "Message",
        back_populates="contents",
    )
