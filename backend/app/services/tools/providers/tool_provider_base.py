"""
工具提供者基础接口和模型定义

定义了工具调用系统的核心抽象:
- IToolProvider: 工具提供者接口
- ToolCallRequest: 统一请求模型
- ToolCallResponse: 统一响应模型
"""

from abc import ABC, abstractmethod
from typing import Any, Dict
from pydantic import BaseModel, Field


class ToolCallRequest(BaseModel):
    """工具调用请求
    
    Attributes:
        id: 工具调用 ID，用于关联请求和响应
        name: 工具名称 (如 "get_current_time", "mcp__search")
        arguments: 工具调用参数字典
    """
    id: str = Field(..., description="工具调用 ID")
    name: str = Field(..., description="工具名称")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="工具调用参数")


class ToolCallResponse(BaseModel):
    """工具调用结果
    
    Attributes:
        tool_call_id: 对应的工具调用 ID
        role: 角色标识，固定为 "tool"
        name: 工具名称
        content: 工具执行结果内容
        is_error: 是否为错误响应
    """
    tool_call_id: str = Field(..., description="工具调用 ID")
    role: str = Field(default="tool", description="角色标识")
    name: str = Field(..., description="工具名称")
    content: str = Field(..., description="工具执行结果")
    is_error: bool = Field(default=False, description="是否为错误响应")


class IToolProvider(ABC):
    """工具提供者接口
    
    所有工具提供者必须实现此接口，包括:
    - LocalToolProvider: 本地工具提供者
    - MCPToolProvider: MCP 工具提供者
    - 未来可能的其他工具提供者
    
    示例:
        class MyCustomProvider(IToolProvider):
            async def get_tools(self):
                return {"my_tool": {...}}
            
            async def execute(self, request):
                # 执行逻辑
                return ToolCallResponse(...)
            
            async def is_available(self, tool_name):
                return tool_name in self._tools
    """
    
    @abstractmethod
    async def get_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取工具列表
        
        Returns:
            Dict: 以工具名为键的工具 schema 字典
                  格式：{tool_name: tool_schema}
                  tool_schema 应包含工具的 JSON Schema 描述
        """
        pass
    
    @abstractmethod
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """执行工具调用
        
        Args:
            request: 工具调用请求
            
        Returns:
            ToolCallResponse: 工具调用结果
            
        Raises:
            Exception: 工具执行失败时抛出异常或返回 is_error=True 的响应
        """
        pass
    
    @abstractmethod
    async def is_available(self, tool_name: str) -> bool:
        """检查工具是否可用
        
        Args:
            tool_name: 工具名称
            
        Returns:
            bool: 工具是否可用
        """
        pass
