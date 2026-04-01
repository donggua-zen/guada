"""
工具编排器 - ToolOrchestrator

负责:
1. 管理多个工具提供者 (Provider)
2. 根据工具名自动路由到正确的提供者
3. 批量并发执行工具调用
4. 提供工具启用状态检查
"""

import logging
from typing import Any, Dict, List, Optional, Tuple, Union
from asyncio import gather
from pydantic import BaseModel, Field, PrivateAttr

from .providers.tool_provider_base import (
    IToolProvider,
    ToolCallRequest,
    ToolCallResponse,
)

logger = logging.getLogger(__name__)


class ProviderConfig(BaseModel):
    """单个 Provider 的配置"""

    enabled_tools: Optional[Union[List[str], bool]] = None  # 工具列表或 True(全部启用)
    extra_params: Dict[str, Any] = Field(default_factory=dict)  # 其他参数


class ToolExecutionContext(BaseModel):
    """工具执行上下文

    封装工具执行的完整环境配置，包括：
    - session_id: 会话 ID（用于注入到工具参数）
    - 各 Provider 的配置（enabled_tools 等）
    - 已启用工具的缓存（避免重复查询）

    Attributes:
        session_id: 会话 ID
        mcp: MCP Provider 配置
        local: Local Provider 配置
        memory: Memory Provider 配置
        _resolved_tools_cache: 按 namespace 缓存已解析的工具列表
    """

    session_id: str
    mcp: Optional[ProviderConfig] = None
    local: Optional[ProviderConfig] = None
    memory: Optional[ProviderConfig] = None

    # 缓存已解析的工具列表（避免重复查询）
    _resolved_tools_cache: Dict[str, List[str]] = PrivateAttr(default_factory=dict)

    def get_provider_config(self, namespace: str) -> Optional[ProviderConfig]:
        """获取指定 Provider 的配置"""
        return getattr(self, namespace, None)

    def set_resolved_tools(self, namespace: str, tools: List[str]) -> None:
        """缓存已解析的工具列表

        Args:
            namespace: Provider 命名空间
            tools: 已启用的工具名列表（含命名空间前缀）
        """
        self._resolved_tools_cache[namespace] = tools

    def get_resolved_tools(self, namespace: str) -> Optional[List[str]]:
        """获取已缓存的工具列表

        Args:
            namespace: Provider 命名空间

        Returns:
            List[str]: 已启用的工具名列表，如果未缓存则返回 None
        """
        return self._resolved_tools_cache.get(namespace)


class ToolOrchestrator:
    """工具编排器

    使用示例:
        orchestrator = ToolOrchestrator()

        # 添加提供者（按优先级排序）
        orchestrator.add_provider(LocalToolProvider(), priority=0)
        orchestrator.add_provider(MCPToolProvider(session), priority=1)

        # 获取所有工具
        all_tools = await orchestrator.get_all_tools()

        # 执行单个工具调用
        response = await orchestrator.execute(
            ToolCallRequest(id="1", name="get_current_time", arguments={})
        )

        # 批量执行工具调用
        responses = await orchestrator.execute_batch([
            ToolCallRequest(id="1", name="get_current_time", arguments={}),
            ToolCallRequest(id="2", name="mcp__search", arguments={"q": "..."}),
        ])
    """

    def __init__(self):
        """初始化工具编排器"""
        self._namespace_to_provider: Dict[str, IToolProvider] = (
            {}
        )  # ✅ 命名空间到 Provider 的映射

    def add_provider(self, provider: IToolProvider, priority: int = 0):
        """添加工具提供者

        Args:
            provider: 工具提供者实例
            priority: 优先级（数字越小优先级越高，默认为 0）

        注意:
            - ✅ 改进：自动建立命名空间到 Provider 的映射
            - ✅ 改进：移除优先级排序逻辑（不再需要）
        """
        # ✅ 改进：建立命名空间到 Provider 的映射
        if provider.namespace:
            self._namespace_to_provider[provider.namespace] = provider
            logger.info(f"Added tool provider '{provider.namespace}'")
        else:
            logger.warning(f"Provider without namespace added: {provider}")

    async def get_all_tools(
        self, context: Optional[ToolExecutionContext] = None
    ) -> list[Dict[str, Any]]:
        """获取所有工具（可带过滤）

        Args:
            context: 工具执行上下文（可选）

        Returns:
            list: [{type: "function", function: {...}}, ...]
                  ✅ 改进：直接返回 OpenAI API 要求的数组格式
                  ✅ 改进：根据 enabled_tools 过滤
        """
        all_tools_array = []

        for namespace, provider in self._namespace_to_provider.items():
            # ✅ 委托给 Provider 进行过滤
            provider_config = (
                context.get_provider_config(namespace) if context else None
            )
            enabled_ids = provider_config.enabled_tools if provider_config else None

            # ✅ 直接获取已过滤的工具（一次查询完成）
            tools_namespaced = await provider.get_tools_namespaced(enabled_ids)

            # ✅ 添加到结果数组（直接添加 schema，不需要 tool_name 作为 key）
            all_tools_array.extend(tools_namespaced)

            # ✅ 缓存已解析的工具列表（用于后续 execute() 检查）
            if context:
                # 提取纯工具名（不含命名空间）进行缓存
                pure_tool_names = [
                    tool["function"]["name"] for tool in tools_namespaced
                ]
                context.set_resolved_tools(namespace, pure_tool_names)

        logger.debug(f"Total tools available: {len(all_tools_array)}")
        return all_tools_array

    async def get_all_tools_schema(
        self,
        enabled_tools: Optional[list] = None,
        enabled_mcp_servers: Optional[list] = None,
    ) -> list:
        """获取所有工具的 schema（OpenAI Function Calling 格式）

        ⚠️ 注意：此方法已废弃，请使用 get_all_tools() + context 的方式

        Args:
            enabled_tools: 已启用的工具 ID/名称列表（None 表示全部启用）
                          ⚠️ 注意：此参数已不再使用
            enabled_mcp_servers: 已启用的 MCP 服务器 ID 列表（None 表示全部启用）
                                  ⚠️ 注意：此参数已不再使用

        Returns:
            List[Dict]: OpenAI Function Calling 格式的工具 schema 列表

        Deprecated:
            推荐使用 ToolExecutionContext 进行工具过滤：
            ```python
            context = ToolExecutionContext(
                session_id="xxx",
                mcp=ProviderConfig(enabled_tools=["server_1"]),
                local=ProviderConfig(enabled_tools=["tool_1"])
            )
            tools = await orchestrator.get_all_tools(context)
            ```
        """
        # ⚠️ 向后兼容：直接获取所有工具（不应用过滤）
        # 新的调用者应该使用 get_all_tools(context)
        all_tools = await self.get_all_tools()
        tools_schema = []

        for tool_name, tool_data in all_tools.items():
            if isinstance(tool_data, dict):
                schema = {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_data.get(
                            "description", f"Tool: {tool_name}"
                        ),
                        "parameters": tool_data.get("inputSchema", {})
                        or tool_data.get("parameters", {}),
                    },
                }
                tools_schema.append(schema)

        logger.info(
            f"Generated schema for {len(tools_schema)} tools (filtered from {len(all_tools)} total tools)"
        )
        return tools_schema

    async def get_all_tool_prompts(self, session_id: str) -> str:
        """获取所有工具的提示词注入

        Args:
            session_id: 会话 ID，用于注入动态内容

        Returns:
            合并后的提示词字符串
        """
        prompts = []

        for provider in self._namespace_to_provider.values():
            try:
                # ✅ 使用新的 get_prompt() 接口，传递注入参数
                inject_params = {"session_id": session_id}
                prompt = await provider.get_prompt(inject_params)
                if prompt:
                    prompts.append(prompt)
            except Exception as e:
                logger.error(f"Error getting prompt from provider: {e}")
                logger.exception(e)

        logger.debug(f"Collected {len(prompts)} tool prompt injections")
        return "\n\n".join(prompts)

    async def find_provider_for_tool(self, tool_name: str) -> Optional[IToolProvider]:
        """查找能处理指定工具的提供者

        Args:
            tool_name: 工具名称（必须包含命名空间前缀，如 "memory__add_memory"）

        Returns:
            IToolProvider: 工具提供者或 None

        策略:
            1. ✅ 提取命名空间前缀（O(1)）
            2. ✅ 直接从字典查找（O(1)）
            3. ✅ 找不到返回 None（不遍历后备）

        注意:
            - 如果工具名不包含命名空间前缀，直接返回 None
            - 如果命名空间未注册，直接返回 None
            - ✅ 时间复杂度：O(1)
        """
        # ✅ 改进：通过命名空间前缀直接匹配
        if "__" not in tool_name:
            logger.warning(f"Tool name without namespace prefix: {tool_name}")
            return None

        namespace = tool_name.split("__")[0]
        provider = self._namespace_to_provider.get(namespace)

        if provider:
            logger.debug(
                f"Matched tool '{tool_name}' to provider by namespace: {namespace}"
            )
            return provider
        else:
            logger.warning(
                f"Namespace '{namespace}' not registered for tool: {tool_name}"
            )
            return None

    async def execute(
        self, request: ToolCallRequest, context: Optional[ToolExecutionContext] = None
    ) -> ToolCallResponse:
        """执行工具调用（带权限检查）

        Args:
            request: 工具调用请求
            context: 工具执行上下文（包含配置）

        Returns:
            ToolCallResponse: 工具调用结果

        流程:
            1. 提取命名空间
            2. 获取 Provider 配置
            3. 委托给 Provider 进行 ID 转换
            4. 检查工具是否启用
            5. 查找 Provider
            6. 执行工具
        """
        # 1. 提取命名空间
        if "__" not in request.name:
            logger.warning(f"Tool name without namespace prefix: {request.name}")
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Error: Tool name must have namespace prefix: {request.name}",
                is_error=True,
            )

        namespace = request.name.split("__")[0]
        tool_name = request.name[len(namespace) + 2 :]

        # 2. 获取 Provider 配置
        provider_config = context.get_provider_config(namespace) if context else None

        # 3. 查找 Provider
        provider = await self.find_provider_for_tool(request.name)
        if not provider:
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Error: No provider found for tool '{request.name}'",
                is_error=True,
            )

        # 4. ✅ 直接使用 get_tools_namespaced() 检查工具是否启用
        #    不再调用 resolve_enabled_tools()，统一方法
        enabled_tools = None

        # 尝试从缓存中获取
        enabled_tools = context.get_resolved_tools(namespace)

        # 如果缓存未命中，调用 get_tools_namespaced() 获取并缓存
        if enabled_tools is None:
            logger.debug(f"Cache miss for {namespace} tools, fetching...")
            enabled_ids = provider_config.enabled_tools if provider_config else None
            tools_namespaced = await provider.get_tools_namespaced(enabled_ids)

            # 提取纯工具名（不含命名空间）进行缓存
            pure_tool_names = [tool["function"]["name"] for tool in tools_namespaced]

            if context:
                context.set_resolved_tools(namespace, pure_tool_names)

            enabled_tools = pure_tool_names
        else:
            logger.debug(f"Cache hit for {namespace} tools")

        # 5. 检查工具是否启用
        if request.name not in enabled_tools:
            logger.warning(f"Tool {request.name} is not enabled")
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Error: Tool '{tool_name}' is not enabled",
                is_error=True,
            )

        # 6. 准备传递给 Provider 的参数
        provider_request = ToolCallRequest(
            id=request.id,
            name=tool_name,  # ✅ 去掉命名空间前缀
            arguments={
                **request.arguments,
            },
        )

        # 7. 执行工具
        try:
            logger.debug(
                f"Executing tool {request.name} via {provider.__class__.__name__}"
            )
            return await provider.execute_with_namespace(
                provider_request, {"session_id": context.session_id}
            )
        except Exception as e:
            logger.error(f"Error executing tool {request.name}: {e}")
            logger.exception(e)
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True,
            )

    async def execute_batch(
        self,
        requests: List[ToolCallRequest],
        context: Optional[ToolExecutionContext] = None,
    ) -> List[ToolCallResponse]:
        """批量执行工具调用

        Args:
            requests: 工具调用请求列表
            context: 工具执行上下文（可选）

        Returns:
            List[ToolCallResponse]: 工具调用结果列表

        特点:
            - 依次执行所有请求，避免数据库并发问题
            - 异常会被转换为错误响应，不会中断后续请求
            - 适合需要按顺序调用多个工具的场景

        示例:
            responses = await orchestrator.execute_batch([
                ToolCallRequest(id="1", name="local__get_current_time", arguments={}),
                ToolCallRequest(id="2", name="mcp__search", arguments={"q": "..."}),
            ], context=context)
        """
        if not requests:
            return []

        # 依次执行所有请求
        responses = []
        for req in requests:
            try:
                result = await self.execute(req, context)
                responses.append(result)
            except Exception as e:
                logger.error(f"Exception in batch execution for {req.name}: {e}")
                responses.append(
                    ToolCallResponse(
                        tool_call_id=req.id,
                        name=req.name,
                        content=str(e),
                        is_error=True,
                    )
                )

        logger.debug(f"Batch executed {len(requests)} tool calls")
        return responses
