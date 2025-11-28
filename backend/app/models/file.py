import ulid

from .database import ModelBase, db


class File(ModelBase):
    __tablename__ = "file"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    file_name = db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(255), nullable=False)
    file_size = db.Column(db.BigInteger, nullable=False)
    file_type = db.Column(db.String(100), nullable=False)
    file_extension = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=True)
    url = db.Column(db.String(255), nullable=True)
    preview_url = db.Column(db.String(255), nullable=True)
    content_hash = db.Column(db.String(64), nullable=False, index=True)
    upload_user_id = db.Column(db.String(26), nullable=True, index=True)
    session_id = db.Column(db.String(26), nullable=True, index=True)
    # message_id = db.Column(db.String(26), nullable=True, index=True)
    message_id = db.Column(
        db.String(26),
        db.ForeignKey("message.id", ondelete="SET NULL", name="fk_file_message_id"),
        index=True,
        nullable=True,
    )
    is_public = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    message = db.relationship(
        "Message",
        back_populates="files",
    )
