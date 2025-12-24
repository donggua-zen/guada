from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class ModelBase(BaseModel):
    name: Optional[str] = None
    provider_id: Optional[str] = None
    model_name: Optional[str] = None
    model_type: Optional[str] = None
    max_tokens: Optional[int] = None
    max_output_tokens: Optional[int] = None
    features: Optional[List[str]] = None


class ModelCreate(BaseModel):
    name: Optional[str] = None
    provider_id: str
    model_name: str
    model_type: str
    max_tokens: Optional[int] = None
    max_output_tokens: Optional[int] = None
    features: Optional[List[str]] = None


class ModelUpdate(BaseModel):
    name: Optional[str] = None
    model_name: Optional[str] = None
    model_type: Optional[str] = None
    max_tokens: Optional[int] = None
    max_output_tokens: Optional[int] = None
    features: Optional[List[str]] = None


class ModelInDBBase(ModelBase):
    id: str

    class Config:
        from_attributes = True


class Model(ModelInDBBase):
    pass


class ModelOut(BaseModel):
    id: str
    name: Optional[str] = None
    provider_id: Optional[str] = None
    model_name: Optional[str] = None
    model_type: Optional[str] = None
    max_tokens: Optional[int] = None
    max_output_tokens: Optional[int] = None
    features: Optional[List[str]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
