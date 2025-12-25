from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

from app.schemas.session_settings import SessionSettings
from .message import Message  # 导入Message schema
from .model import Model, ModelOut  # 导入Model schema


class SessionBase(BaseModel):
    title: Optional[str] = None
    user_id: Optional[str] = None
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None


class SessionCreate(BaseModel):
    title: Optional[str] = None
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None
    character_id: Optional[str] = None


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None


class SessionInDBBase(SessionBase):
    id: str

    class Config:
        from_attributes = True


class Session(SessionInDBBase):
    messages: Optional[List[Message]] = []


class SessionItemOut(BaseModel):
    id: str
    title: Optional[str] = None
    user_id: Optional[str] = None
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SessionOut(SessionItemOut):
    model: Optional[ModelOut] = None  # 添加模型信息

    class Config:
        from_attributes = True
