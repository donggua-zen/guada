from datetime import datetime, timezone
from sqlalchemy import JSON, ForeignKey, Integer, String, Text, DateTime, Column
from sqlalchemy.sql import func
from app.database import ModelBase


class UserSetting(ModelBase):
    __tablename__ = "user_setting"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        String(26),
        ForeignKey("user.id", ondelete="CASCADE", name="fk_settings_user_id"),
        index=True,
        unique=True,
    )
    settings = Column(JSON, default={})
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self):
        return f"<UserSetting {self.key}>"
