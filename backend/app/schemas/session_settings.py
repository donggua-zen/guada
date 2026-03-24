from typing import Optional
from pydantic import BaseModel, field_validator


class SessionSettings(BaseModel):
    max_memory_length: Optional[int] = None
    thinking_enabled: Optional[bool] = False
    disabled_tool_results: Optional[bool] = False  # 新增：是否禁用工具调用结果（false=不禁用=启用）

    @field_validator(
        "max_memory_length",
        mode="before",
    )
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v
