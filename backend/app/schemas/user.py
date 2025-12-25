from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

from app.schemas.base import BaseResponse


class UserBase(BaseModel):
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    parent_id: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class UserCreate(BaseModel):
    role: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: str
    password: str


class UserUpdate(BaseModel):
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    parent_id: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class UserInDBBase(UserBase):
    id: str

    class Config:
        from_attributes = True


class User(UserInDBBase):
    pass


class UserWithPassword(UserInDBBase):
    password_hash: str


class UserOut(BaseResponse):
    id: str
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    parent_id: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True
