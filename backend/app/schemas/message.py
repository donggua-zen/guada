from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from .file import File, FileOut  # 导入File schema
from .message_content import (
    MessageContent,
    MessageContentOut,
)  # 导入MessageContent schema


class MessageBase(BaseModel):
    session_id: Optional[str] = None
    role: Optional[str] = None
    parent_id: Optional[str] = None


class MessageCreate(BaseModel):
    session_id: str
    role: str
    content: str
    files: Optional[List[dict]] = None
    parent_id: Optional[str] = None
    replace_message_id: Optional[str] = None
    meta_data: Optional[dict] = None


class MessageUpdate(BaseModel):
    content: Optional[str] = None
    meta_data: Optional[dict] = None


class MessageInDBBase(MessageBase):
    id: str

    class Config:
        from_attributes = True


class Message(MessageInDBBase):
    files: Optional[List[File]] = []
    contents: Optional[List[MessageContent]] = []


class MessageOut(BaseModel):
    id: str
    session_id: Optional[str] = None
    role: Optional[str] = None
    parent_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    files: Optional[List[FileOut]] = []
    contents: Optional[List[MessageContentOut]] = []

    class Config:
        from_attributes = True
