"""
知识库 API Schema 定义

提供请求/响应数据的 Pydantic 模型验证
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from app.schemas.base import BaseResponse, CamelBaseModel


class ChatStreamRequest(CamelBaseModel):
    """知识库搜索请求"""

    session_id: str = Field(..., description="会话 ID")
    message_id: str = Field(..., description="消息 ID")
    regeneration_mode: Optional[str] = Field(None, description="再生模式", enum=["overwrite", "multi_version"])
    assistant_message_id: Optional[str] = Field(None, description="助手消息 ID")
