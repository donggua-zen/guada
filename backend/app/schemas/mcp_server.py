from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import BaseResponse


class MCPServerBase(BaseModel):
    """MCP 服务器基础信息"""
    name: str = Field(..., min_length=1, max_length=255, description="服务器名称")
    url: str = Field(..., min_length=1, max_length=500, description="服务地址 URL")
    description: Optional[str] = Field(None, max_length=1000, description="描述信息")
    headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="HTTP 请求头")
    tools: Optional[Dict[str, Any]] = Field(default=None, description="MCP 工具列表（自动获取）")
    enabled: bool = True


class MCPServerCreate(MCPServerBase):
    """创建 MCP 服务器请求体"""
    pass


class MCPServerUpdate(BaseModel):
    """更新 MCP 服务器请求体"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    url: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=1000)
    headers: Optional[Dict[str, str]] = None
    tools: Optional[Dict[str, Any]] = None
    enabled: Optional[bool] = None


class MCPServerInDBBase(MCPServerBase):
    """数据库中的 MCP 服务器"""
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MCPServer(MCPServerInDBBase):
    """MCP 服务器详细信息"""
    pass


class MCPServerOut(BaseResponse):
    """MCP 服务器响应"""
    id: str
    name: str
    url: str
    description: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    tools: Optional[Dict[str, Any]] = None
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)