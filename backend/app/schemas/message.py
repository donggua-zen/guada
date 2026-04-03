from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict

from app.schemas.base import BaseResponse
from .file import File, FileBound, FileOut  # 导入File schema
from .message_content import (
    MessageContent,
    MessageContentOut,
)  # 导入MessageContent schema


class MessageBase(BaseModel):
    session_id: Optional[str] = None
    role: Optional[str] = None
    parent_id: Optional[str] = None


class MessageCreate(BaseModel):
    content: str
    files: Optional[List[FileBound]] = None
    replace_message_id: Optional[str] = None
    knowledge_base_ids: Optional[List[str]] = None


class MessageUpdate(BaseModel):
    content: Optional[str] = None
    current_turns_id: Optional[str] = None


class MessageInDBBase(MessageBase):
    id: str

    model_config = ConfigDict(from_attributes=True)


class Message(MessageInDBBase):
    files: Optional[List[File]] = []
    contents: Optional[List[MessageContent]] = []


class MessageOut(BaseResponse):
    id: str
    session_id: Optional[str] = None
    role: Optional[str] = None
    parent_id: Optional[str] = None
    files: Optional[List[FileOut]] = []
    contents: Optional[List[MessageContentOut]] = []
    current_turns_id: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)
