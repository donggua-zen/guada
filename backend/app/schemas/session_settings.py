from typing import Optional
from pydantic import BaseModel, field_validator


class SessionSettings(BaseModel):
    max_memory_length: Optional[int] = None
    thinking_enabled: Optional[bool] = False
    skip_tool_calls: Optional[bool] = False  # 是否跳过包含工具调用的轮次（true=跳过，false=保留）

    @field_validator(
        "max_memory_length",
        mode="before",
    )
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v
