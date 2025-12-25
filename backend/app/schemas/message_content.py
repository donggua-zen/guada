from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from app.schemas.base import BaseResponse


class MessageContentBase(BaseModel):
    message_id: Optional[str] = None
    is_current: Optional[bool] = None
    content: Optional[str] = None
    reasoning_content: Optional[str] = None
    meta_data: Optional[dict] = None


class MessageContentCreate(BaseModel):
    message_id: str
    content: str
    reasoning_content: Optional[str] = None
    meta_data: Optional[dict] = None
    set_current: Optional[bool] = True


class MessageContentActive(BaseModel):
    message_id: str


class MessageContentInDBBase(MessageContentBase):
    id: str

    class Config:
        from_attributes = True


class MessageContent(MessageContentInDBBase):
    pass


class MessageContentOut(BaseResponse):
    id: str
    message_id: Optional[str] = None
    is_current: Optional[bool] = None
    content: Optional[str] = None
    reasoning_content: Optional[str] = None
    meta_data: Optional[dict] = None

    class Config:
        from_attributes = True
