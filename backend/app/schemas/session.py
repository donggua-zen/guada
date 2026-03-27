from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict

from app.schemas.base import BaseResponse
from app.schemas.session_settings import SessionSettings
from .message import Message  # 导入 Message schema
from .model import Model, ModelOut  # 导入 Model schema
from .character import CharacterOut, CharacterItemOut  # 导入 Character schema


class SessionBase(BaseModel):
    title: Optional[str] = None
    user_id: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None


class SessionCreate(BaseModel):
    character_id: str  # 必填，绑定角色
    title: Optional[str] = None  # 可选，会话标题
    model_id: Optional[str] = None  # 可选，如果提供则覆盖角色的 model_id
    settings: Optional[SessionSettings] = None  # 可选，只保存覆盖的配置（max_memory_length）


class SessionUpdate(BaseModel):
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
    description: Optional[str] = None
    model_id: Optional[str] = None
    character_id: Optional[str] = None  # 添加角色 ID
    settings: Optional[SessionSettings] = None
    character: Optional[CharacterItemOut] = None  # 使用 CharacterItemOut(不含 model)
    # ✅ 时间字段已从 BaseResponse 自动继承：created_at, updated_at, last_active_at

    model_config = ConfigDict(from_attributes=True)


class SessionOut(SessionItemOut):
    model: Optional[ModelOut] = None  # 添加模型信息
    character: Optional[CharacterItemOut] = None  # 添加角色信息

    model_config = ConfigDict(from_attributes=True)