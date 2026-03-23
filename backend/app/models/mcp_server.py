from datetime import datetime, timezone
from typing import Optional
import ulid
from sqlalchemy import String, DateTime, JSON, Column, Boolean
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func
from app.database import ModelBase


class MCPServer(ModelBase):
    __tablename__ = "mcp_server"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    name = Column(String(255), nullable=False)
    url = Column(String(500), nullable=False)
    description = Column(String(1000), nullable=True)
    headers = Column(JSON, nullable=True)  # 存储 HTTP 请求头字典
    tools = Column(JSON, nullable=True)  # 存储 MCP 工具列表（自动获取）
    enabled = Column(Boolean, default=True, nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self):
        return f"<MCPServer(id={self.id}, name={self.name}, url={self.url})>"