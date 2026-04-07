from datetime import datetime
from typing import Optional, List

from app.schemas.base import CamelBaseModel, BaseResponse


class UserBase(CamelBaseModel):
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    parent_id: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class UserCreate(CamelBaseModel):
    role: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: str
    password: str


class UserUpdate(CamelBaseModel):
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    parent_id: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class UserInDBBase(UserBase):
    id: str


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


class UserVerifyResponse(BaseResponse):
    access_token: str
    user: User
