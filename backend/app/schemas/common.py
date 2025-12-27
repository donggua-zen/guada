# schemas/common.py
from typing import Optional, TypeVar, Generic, List
from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: Optional[int] = None
    page: Optional[int] = None
    size: Optional[int] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)
