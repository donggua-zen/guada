from typing import Optional
from pydantic import BaseModel, field_validator
from datetime import datetime, timezone


class BaseResponse(BaseModel):
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def interpret_as_utc(cls, v):
        if isinstance(v, str):
            v = datetime.fromisoformat(v)
        if v.tzinfo is None:
            # 假设所有 naive 时间都是 UTC（因为写入时用的是 UTC）
            return v.replace(tzinfo=timezone.utc)
        return v
