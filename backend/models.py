# models.py
from sqlalchemy import (
    Integer,
    create_engine,
    Column,
    String,
    Text,
    JSON,
    DateTime,
    Index,
    func,
)
from sqlalchemy.orm import declarative_base, sessionmaker
import datetime

import ulid

Base = declarative_base()


class ModelBase(Base):
    __abstract__ = True

    def to_dict(self, exclude=None):
        """将模型转换为字典"""
        if exclude is None:
            exclude = []

        result = {}
        for column in self.__table__.columns:
            if column.name not in exclude:
                if column.name == "created_at" or column.name == "updated_at":
                    result[column.name] = getattr(self, column.name).isoformat()
                else:
                    result[column.name] = getattr(self, column.name)
        return result


class Character(ModelBase):
    __tablename__ = "character"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    # name = Column(String)
    user_id = Column(String, index=True)
    title = Column(String, index=True)
    description = Column(String, nullable=True)
    # identity = Column(String, nullable=True)
    # detailed_setting = Column(JSON, nullable=True)
    avatar_url = Column(String, nullable=True)
    # system_prompt = Column(Text, nullable=True)
    settings = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )


class Message(ModelBase):
    __tablename__ = "message"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    session_id = Column(String, index=True)
    role = Column(String)
    content = Column(Text, nullable=True)
    reasoning_content = Column(Text, nullable=True)
    parent_id = Column(String, nullable=True)
    token_count = Column(Integer, nullable=True)
    meta_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )


class Session(ModelBase):
    __tablename__ = "session"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    title = Column(String, index=True)
    user_id = Column(String, index=True)
    # character_id = Column(String, index=True)
    # memory_type = Column(String, nullable=True)
    # model = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    description = Column(String, nullable=True)
    # system_prompt = Column(Text, nullable=True)
    settings = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )


class Summary(ModelBase):
    __tablename__ = "summary"
    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    session_id = Column(String, index=True)
    master_summary = Column(Text, nullable=True)
    last_message_id = Column(String, nullable=True)
    history = Column(JSON, nullable=True)  # 存储摘要历史
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )


class ModelProvider(ModelBase):
    __tablename__ = "model_provider"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    name = Column(String)
    provider = Column(String)
    api_url = Column(String)
    api_key = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )


class Model(ModelBase):
    __tablename__ = "model"

    id = Column(String, primary_key=True, default=lambda: str(ulid.new()))
    name = Column(String, nullable=True)
    provider_id = Column(String)
    model_name = Column(String)
    model_type = Column(String)
    max_tokens = Column(Integer, nullable=True)
    max_output_tokens = Column(Integer, nullable=True)
    features = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
    )


# 创建数据库引擎和会话工厂
engine = create_engine("sqlite:///./data/app.db")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建表
Base.metadata.create_all(bind=engine)
