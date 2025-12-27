from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict

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

    model_config = ConfigDict(from_attributes=True)


class ModelProviderBaseOut(BaseResponse):
    id: str
    user_id: Optional[str] = None
    name: Optional[str] = None
    provider: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ModelProviderOut(ModelProviderBaseOut):
    models: Optional[List[ModelOut]] = []
