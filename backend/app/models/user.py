# user.py
import ulid
from sqlalchemy import String, DateTime, Column
from sqlalchemy.sql import func
from app.database import ModelBase
import bcrypt


class User(ModelBase):
    __tablename__ = 'user'
    
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    role = Column(String(20), nullable=True)
    avatar_url = Column(String(255), nullable=True)
    parent_id = Column(String(26), nullable=True, index=True)
    nickname = Column(String(80), nullable=True)
    phone = Column(
        String(20),
        index=True,  # 保留索引
        nullable=True,
        unique=True,
    )
    email = Column(
        String(120),
        index=True,  # 保留索引
        nullable=True,
        unique=True,
    )
    password_hash = Column(String(128), nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )