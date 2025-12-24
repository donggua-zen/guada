from datetime import datetime, timezone
from sqlalchemy import Integer, String, Text, DateTime, Column
from sqlalchemy.sql import func
from app.database import ModelBase


class GlobalSetting(ModelBase):
    __tablename__ = "global_settings"

    id = Column(Integer, primary_key=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text)  # 使用Text类型存储各种值
    value_type = Column(
        String(20), default="str"
    )  # 值类型：str, int, float, bool, json
    description = Column(Text)  # 设置项描述
    category = Column(String(50), default="general")  # 分类：model, ui, system等
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self):
        return f"<GlobalSetting {self.key}>"
