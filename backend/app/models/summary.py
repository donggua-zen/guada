import ulid
from .database import db, ModelBase


class Summary(ModelBase):
    __tablename__ = "summary"
    id = db.Column(db.String(26), primary_key=True, default=lambda: str(ulid.new()))
    # session_id = db.Column(db.String(26), index=True)
    session_id = db.Column(
        db.String(26),
        db.ForeignKey("session.id", ondelete="CASCADE", name="fk_summary_session_id"),
        index=True,
    )
    master_summary = db.Column(db.Text, nullable=True)
    last_message_id = db.Column(db.String(26), nullable=True)
    history = db.Column(db.JSON, nullable=True)  # 存储摘要历史
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    session = db.relationship("Session", back_populates="summary")
