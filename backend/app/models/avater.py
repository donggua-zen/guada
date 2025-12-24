import ulid
from sqlalchemy import String, DateTime, Integer, Boolean, Column
from sqlalchemy.sql import func


class Avatar:
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    filename = Column(String(255))
    file_size = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())