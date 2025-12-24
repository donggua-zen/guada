from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class FileBase(BaseModel):
    file_name: Optional[str] = None
    display_name: Optional[str] = None
    file_size: Optional[int] = None
    file_type: Optional[str] = None
    file_extension: Optional[str] = None
    content: Optional[str] = None
    url: Optional[str] = None
    preview_url: Optional[str] = None
    content_hash: Optional[str] = None
    upload_user_id: Optional[str] = None
    session_id: Optional[str] = None
    message_id: Optional[str] = None
    is_public: Optional[bool] = None


class FileCreate(BaseModel):
    file_name: str
    display_name: str
    file_size: int
    file_type: str
    file_extension: str
    content: Optional[str] = None
    url: Optional[str] = None
    preview_url: Optional[str] = None
    content_hash: str
    session_id: Optional[str] = None
    message_id: Optional[str] = None
    is_public: Optional[bool] = False


class FileUpdate(BaseModel):
    file_name: Optional[str] = None
    display_name: Optional[str] = None
    file_type: Optional[str] = None
    url: Optional[str] = None
    preview_url: Optional[str] = None
    is_public: Optional[bool] = None


class FileInDBBase(FileBase):
    id: str

    class Config:
        from_attributes = True


class File(FileInDBBase):
    pass


class FileOut(BaseModel):
    id: str
    file_name: Optional[str] = None
    display_name: Optional[str] = None
    file_size: Optional[int] = None
    file_type: Optional[str] = None
    file_extension: Optional[str] = None
    # content: Optional[str] = None  # 在响应中可能需要限制返回
    url: Optional[str] = None
    preview_url: Optional[str] = None
    content_hash: Optional[str] = None
    upload_user_id: Optional[str] = None
    session_id: Optional[str] = None
    message_id: Optional[str] = None
    is_public: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True