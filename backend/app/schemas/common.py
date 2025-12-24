# schemas/common.py
from typing import Optional, TypeVar, Generic, List
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: Optional[int] = None
    page: Optional[int] = None
    size: Optional[int] = None

    class Config:
        # 注意：这里不需要 from_attributes=True！
        # 因为 T 是 Pydantic 模型（如 UserOut），不是 ORM 对象
        pass
