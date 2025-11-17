import ulid
from .database import ModelBase, db


class Session(ModelBase):
    __tablename__ = "session"

    id = db.Column(db.String, primary_key=True, default=lambda: str(ulid.new()))
    title = db.Column(db.String, index=True)
    user_id = db.Column(db.String, index=True)
    # character_id = Column(String, index=True)
    # memory_type = Column(String, nullable=True)
    # model = Column(String, nullable=True)
    avatar_url = db.Column(db.String, nullable=True)
    description = db.Column(db.String, nullable=True)
    # system_prompt = Column(Text, nullable=True)
    model_id = db.Column(
        db.String,
        db.ForeignKey("model.id", ondelete="SET NULL", name="fk_session_model_id"),
        index=True,
        nullable=True,
    )
    settings = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    messages = db.relationship(
        "Message",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    summary = db.relationship(
        "Summary",
        back_populates="session",
        cascade="all, delete-orphan",
        uselist=False,  # 关键参数，表示一对一关系
    )

    model = db.relationship(
        "Model",
        # 添加 passive_deletes 配置，确保 SQLAlchemy 知道数据库会处理 SET NULL
        passive_deletes=True,
        uselist=False,  # 关键参数，表示一对一关系
    )
