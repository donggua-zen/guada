"""
工具提供者基础接口和模型定义

定义了工具调用系统的核心抽象:
- IToolProvider: 统一的工具提供者接口
- ToolCallRequest: 统一请求模型
- ToolCallResponse: 统一响应模型
- ToolProviderConfig: 工具提供者配置
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
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


class ToolProviderConfig(BaseModel):
    """工具提供者配置

    Attributes:
        enabled: 是否启用
        namespace: 命名空间（可选，默认从类名推导）
        prompt_template: 提示词模板
        max_tokens: 提示词最大 token 数
        priority: 注入优先级（数字越小越优先）
    """

    enabled: bool = Field(default=True, description="是否启用")
    namespace: Optional[str] = Field(default=None, description="命名空间前缀")
    prompt_template: Optional[str] = Field(default=None, description="提示词模板")
    max_tokens: int = Field(default=1000, description="提示词最大 token 数")
    priority: int = Field(default=0, description="注入优先级（数字越小越优先）")


class IToolProvider(ABC):
    """工具提供者接口 - 基类

    设计原则:
        - 父类负责所有通用逻辑（命名空间处理、过滤等）
        - 子类只负责业务逻辑（真正的工具获取和执行）

    子类需要实现的抽象方法:
        - _get_tools_internal(): 获取工具列表（不含命名空间）
        - _execute_internal(): 执行工具调用（名称已去除前缀）
        - is_available(): 检查工具是否可用

    父类提供的最终方法（子类不应覆写）:
        - get_tools_namespaced(): 获取带命名空间的工具列表
        - execute_with_namespace(): 执行工具调用
    """

    # ========== 属性（子类实现）==========

    @property
    @abstractmethod
    def namespace(self) -> Optional[str]:
        """获取命名空间

        Returns:
            Optional[str]: 命名空间前缀，如果没有则返回 None

        示例:
            MemoryToolProvider.namespace = "memory"
            MCPToolProvider.namespace = "mcp"
            LocalToolProvider.namespace = "local"
        """
        pass

    # ========== 抽象方法（子类必须实现）==========

    @abstractmethod
    async def _get_tools_internal(
        self, enabled_ids: Optional[Union[List[str], bool]] = None
    ) -> Dict[str, Dict[str, Any]]:
        """获取工具列表（内部实现，不含命名空间）

        注意：这是核心抽象方法，子类必须实现

        Returns:
            Dict: {tool_name: tool_schema}
                  格式：{工具名：工具 schema}（不含命名空间前缀）
        """
        pass

    @abstractmethod
    async def _execute_internal(
        self, request: ToolCallRequest, inject_params: Optional[Dict[str, Any]] = None
    ) -> ToolCallResponse:
        """实际执行工具调用（内部实现，名称已去除前缀）

        注意：这是核心抽象方法，子类必须实现

        Args:
            request: 工具调用请求（名称已去除命名空间前缀）
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            ToolCallResponse: 工具调用结果

        Raises:
            Exception: 工具执行失败时抛出异常或返回 is_error=True 的响应
        """
        pass

    # ========== 最终方法（子类不应覆写）==========

    async def get_tools_namespaced(
        self, enabled_ids: Optional[Union[List[str], bool]] = None
    ) -> List[Dict[str, Any]]:
        """获取带命名空间的工具列表（最终实现，子类不应覆写）

        这是统一的公共方法，负责：
        1. 调用子类的 _get_tools_internal() 获取工具
        2. 添加命名空间前缀
        3. 根据 enabled_ids 过滤

        Args:
            enabled_ids: 启用的工具/服务器 ID 列表
                        - 对于 MCP：是 MCP Server 的 ID
                        - 对于 Local/Memory：直接是工具名
                        - 如果为 None 或 True：返回所有工具
                        - 如果为 False 或 []：返回空字典

        Returns:
            Dict: {namespace__tool_name: tool_schema}
                  格式：{命名空间__工具名：工具 schema}
        """
        # 1. 调用子类实现获取工具
        tools = await self._get_tools_internal(enabled_ids=enabled_ids)

        if self.namespace:
            namespaced_tools = []
            for schema in tools:
                # 添加命名空间到字典键
                namespaced_key = f"{self.namespace}__{schema["function"]["name"]}"

                # 同时更新 schema 中的 function.name
                import copy

                namespaced_schema = copy.deepcopy(schema)
                namespaced_schema["function"]["name"] = namespaced_key
                namespaced_tools.append(namespaced_schema)

            return namespaced_tools
        return tools

    async def execute_with_namespace(
        self, request: ToolCallRequest, inject_params: Optional[Dict[str, Any]] = None
    ) -> ToolCallResponse:
        """执行工具调用（最终实现，子类不应覆写）

        这是统一的公共方法，负责：
        1. 移除命名空间前缀
        2. 传递注入参数
        3. 调用子类的 _execute_internal() 执行工具
        4. 添加回命名空间前缀到响应

        Args:
            request: 工具调用请求（包含完整工具名，可能带命名空间前缀）
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            ToolCallResponse: 工具调用结果（name 字段包含命名空间前缀）
        """
        # 保存原始名称（带命名空间）
        original_name = request.name

        # 1. 如果有命名空间，移除前缀
        if self.namespace and request.name.startswith(f"{self.namespace}__"):
            stripped_name = request.name[len(self.namespace) + 2 :]
            request = ToolCallRequest(
                id=request.id,
                name=stripped_name,  # 使用去掉前缀的名称
                arguments=request.arguments,
            )

        # 2. 调用子类实现执行工具（传递注入参数）
        response = await self._execute_internal(request, inject_params)

        # 3. ✅ 添加回命名空间前缀到响应的 name 字段
        if self.namespace:
            response.name = f"{self.namespace}__{response.name}"

        return response

    # ========== 辅助方法（默认实现） ==========

    async def initialize(self) -> None:
        """初始化工具提供者（可选）

        用于执行异步初始化操作，如建立数据库连接、加载缓存等
        默认实现为空，子类可按需覆写
        """
        pass

    def get_config(self) -> "ToolProviderConfig":
        """获取工具提供者配置

        默认返回默认配置，子类可覆写

        Returns:
            ToolProviderConfig: 配置对象
        """
        return ToolProviderConfig(namespace=self.namespace)

    async def cleanup(self) -> None:
        """清理资源（可选）

        用于释放异步资源，如关闭数据库连接等
        默认实现为空，子类可按需覆写
        """
        pass

    # ========== 原有方法：工具族支持（保持向后兼容） ==========

    async def get_prompt(self, inject_params: Optional[Dict[str, Any]] = None) -> str:
        """获取当前提供者的提示词注入（支持动态内容）

        Args:
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            str: 提示词字符串

        Note:
            子类可以覆写此方法来实现具体的提示词逻辑
            默认返回空字符串（表示无提示词注入）
        """
        return ""
