from typing import Optional
from pydantic import BaseModel, field_validator


class SessionSettings(BaseModel):
    assistant_name: Optional[str] = None
    assistant_identity: Optional[str] = None
    system_prompt: Optional[str] = None
    memory_type: Optional[str] = "sliding_window"
    max_memory_length: Optional[int] = None
    max_memory_tokens: Optional[int] = None
    short_term_memory_tokens: Optional[int] = None
    model_top_p: Optional[float] = None
    model_temperature: Optional[float] = None
    use_user_prompt: Optional[bool] = None
    web_search_enabled: Optional[bool] = False
    thinking_enabled: Optional[bool] = False

    @field_validator(
        "max_memory_length",
        "max_memory_tokens",
        "short_term_memory_tokens",
        "model_top_p",
        "model_temperature",
        mode="before",
    )
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v
