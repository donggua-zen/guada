import ulid

from .database import ModelBase, db


class Message(ModelBase):
    __tablename__ = "message"

    id = db.Column(db.String(26), primary_key=True, default=lambda: str(ulid.new()))
    # session_id = db.Column(db.String(26), index=True)
    session_id = db.Column(
        db.String(26),
        db.ForeignKey("session.id", ondelete="CASCADE", name="fk_message_session_id"),
        index=True,
    )
    role = db.Column(db.String(50))
    # content = db.Column(db.Text, nullable=True)
    # reasoning_content = db.Column(db.Text, nullable=True)
    parent_id = db.Column(db.String(26), nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )
    files = db.relationship(
        "File",
        back_populates="message",
        # cascade="all, delete-orphan",
        cascade="save-update, merge, refresh-expire",  # 不要级联删除files，files会置空外键
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
