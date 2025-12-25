from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

from app.schemas.base import BaseResponse
from .model import ModelOut  # 导入Model schema


class ModelProviderBase(BaseModel):
    user_id: Optional[str] = None
    name: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None


class ModelProviderCreate(BaseModel):
    name: str
    api_url: str
    api_key: str


class ModelProviderUpdate(BaseModel):
    name: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None


class ModelProviderInDBBase(ModelProviderBase):
    id: str

    class Config:
        from_attributes = True


class ModelProviderOut(BaseResponse):
    id: str
    user_id: Optional[str] = None
    name: Optional[str] = None
    provider: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    models: Optional[List[ModelOut]] = []

    class Config:
        from_attributes = True
