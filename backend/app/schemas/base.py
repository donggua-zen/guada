from typing import Optional
from pydantic import BaseModel, field_validator, computed_field
from datetime import datetime, timezone


class BaseResponse(BaseModel):
    # 基础时间字段 - 所有继承此类的 Schema 都会自动包含这些字段
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_active_at: Optional[datetime] = None  # 新增：最后活跃时间

    @field_validator("created_at", "updated_at", "last_active_at", mode="before")
    @classmethod
    def interpret_as_utc(cls, v):
        """将所有时间字段统一转换为 UTC 时间
        
        Args:
            v: 输入值（可能是字符串、naive datetime 或 aware datetime）
            
        Returns:
            转换后的 UTC datetime 对象
        """
        if v is None:
            return None
        if isinstance(v, str):
            try:
                v = datetime.fromisoformat(v)
            except ValueError:
                # 如果解析失败，返回 None
                return None
        if isinstance(v, datetime):
            if v.tzinfo is None:
                # 假设所有 naive 时间都是 UTC（因为写入时用的是 UTC）
                return v.replace(tzinfo=timezone.utc)
            return v
        return None
