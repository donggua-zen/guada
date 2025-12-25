from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel

from app.schemas.base import BaseResponse
from app.schemas.session_settings import SessionSettings
from .model import ModelOut  # 导入Model schema


class CharacterBase(BaseModel):
    user_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    is_public: Optional[bool] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None


class CharacterCreate(BaseModel):
    title: str
    model_id: str
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    is_public: Optional[bool] = False
    settings: Optional[SessionSettings] = None


class CharacterUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    is_public: Optional[bool] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None


class CharacterInDBBase(CharacterBase):
    id: str

    class Config:
        from_attributes = True


class Character(CharacterInDBBase):
    pass


class CharacterItemOut(BaseResponse):
    id: str
    user_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    is_public: Optional[bool] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None

    class Config:
        from_attributes = True


class CharacterOut(CharacterItemOut):
    model: Optional[ModelOut] = None  # 添加模型信息

    class Config:
        from_attributes = True
