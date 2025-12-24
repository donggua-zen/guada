from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel


class SummaryBase(BaseModel):
    session_id: Optional[str] = None
    master_summary: Optional[str] = None
    last_message_id: Optional[str] = None
    history: Optional[List[Any]] = None


class SummaryCreate(BaseModel):
    session_id: str
    master_summary: Optional[str] = None
    last_message_id: Optional[str] = None
    history: Optional[List[Any]] = None


class SummaryUpdate(BaseModel):
    master_summary: Optional[str] = None
    last_message_id: Optional[str] = None
    history: Optional[List[Any]] = None


class SummaryInDBBase(SummaryBase):
    id: str

    class Config:
        from_attributes = True


class Summary(SummaryInDBBase):
    pass


class SummaryOut(BaseModel):
    id: str
    session_id: Optional[str] = None
    master_summary: Optional[str] = None
    last_message_id: Optional[str] = None
    history: Optional[List[Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True