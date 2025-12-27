from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict

from app.schemas.base import BaseResponse
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

    model_config = ConfigDict(from_attributes=True)


class Session(SessionInDBBase):
    messages: Optional[List[Message]] = []


class SessionItemOut(BaseResponse):
    id: str
    title: Optional[str] = None
    user_id: Optional[str] = None
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None

    model_config = ConfigDict(from_attributes=True)


class SessionOut(SessionItemOut):
    model: Optional[ModelOut] = None  # 添加模型信息

    model_config = ConfigDict(from_attributes=True)