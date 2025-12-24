import ulid
from sqlalchemy import String, DateTime, Boolean, JSON, ForeignKey, Column
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import ModelBase


class Character(ModelBase):
    __tablename__ = "character"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    user_id = Column(String(26), index=True)
    title = Column(String(255), index=True)
    description = Column(String(512), nullable=True)
    avatar_url = Column(String(255), nullable=True)
    is_public = Column(Boolean, default=False)
    model_id = Column(
        String(26),
        ForeignKey("model.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    settings = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )

    model = relationship(
        "Model",
        # 添加 passive_deletes 配置，确保 SQLAlchemy 知道数据库会处理 SET NULL
        passive_deletes=True,
        uselist=False,  # 关键参数，表示一对一关系
    )