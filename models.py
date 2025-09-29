# models.py
from sqlalchemy import create_engine, Column, String, Text, JSON, DateTime, Index
from sqlalchemy.orm import declarative_base, sessionmaker
import datetime

import ulid

Base = declarative_base()


class Character(Base):
    __tablename__ = "character"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    name = Column(String)
    user_id = Column(String, index=True)
    title = Column(String)
    description = Column(String, nullable=True)
    identity = Column(String, nullable=True)
    detailed_setting = Column(JSON, nullable=True)
    avatar_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(
        DateTime,
        default=datetime.datetime.now(datetime.timezone.utc),
        onupdate=datetime.datetime.now(datetime.timezone.utc),
    )


class Message(Base):
    __tablename__ = "message"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    session_id = Column(String, index=True)
    role = Column(String)
    content = Column(Text, nullable=True)
    reasoning_content = Column(Text, nullable=True)
    parent_id = Column(String, nullable=True)
    meta_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(
        DateTime,
        default=datetime.datetime.now(datetime.timezone.utc),
        onupdate=datetime.datetime.now(datetime.timezone.utc),
    )


class Session(Base):
    __tablename__ = "session"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    user_id = Column(String, index=True)
    character_id = Column(String, index=True)
    memory_type = Column(String, nullable=True)
    model = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(
        DateTime,
        default=datetime.datetime.now(datetime.timezone.utc),
        onupdate=datetime.datetime.now(datetime.timezone.utc),
    )


class Summary(Base):
    __tablename__ = "summary"
    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    session_id = Column(String, index=True)
    master_summary = Column(Text, nullable=True)
    last_message_id = Column(String, nullable=True)
    history = Column(JSON, nullable=True)  # 存储摘要历史
    created_at = Column(DateTime, default=datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(
        DateTime,
        default=datetime.datetime.now(datetime.timezone.utc),
        onupdate=datetime.datetime.now(datetime.timezone.utc),
    )


# 创建数据库引擎和会话工厂
engine = create_engine("sqlite:///./data/app.db")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建表
Base.metadata.create_all(bind=engine)
