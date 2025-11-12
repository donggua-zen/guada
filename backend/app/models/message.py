import ulid

from .database import ModelBase, db


class Message(ModelBase):
    __tablename__ = "message"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    # session_id = db.Column(db.String, index=True)
    session_id = db.Column(
        db.String,
        db.ForeignKey("session.id", ondelete="CASCADE", name="fk_message_session_id"),
        index=True,
    )
    role = db.Column(db.String)
    # content = db.Column(db.Text, nullable=True)
    # reasoning_content = db.Column(db.Text, nullable=True)
    parent_id = db.Column(db.String, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
    files = db.relationship(
        "File",
        back_populates="message",
        cascade="all, delete-orphan",
    )
    session = db.relationship(
        "Session",
        back_populates="messages",
    )

    contents = db.relationship(
        "MessageContent",
        back_populates="message",
        cascade="all, delete-orphan",
    )

    # session = db.relationship(
    #     "Session",
    #     primaryjoin="Message.session_id == Session.id",
    #     back_populates="messages",
    #     foreign_keys="[Message.session_id]",
    # )
