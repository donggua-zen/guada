"""
工具编排器 - ToolOrchestrator

负责:
1. 管理多个工具提供者 (Provider)
2. 根据工具名自动路由到正确的提供者
3. 批量并发执行工具调用
4. 提供工具缓存优化性能
"""

import logging
from typing import Any, Dict, List, Optional, Tuple
from asyncio import gather

from .providers.tool_provider_base import IToolProvider, ToolCallRequest, ToolCallResponse

logger = logging.getLogger(__name__)


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
        self._providers: List[Tuple[int, IToolProvider]] = []
        self._tools_cache: Dict[str, IToolProvider] = {}
    
    def add_provider(self, provider: IToolProvider, priority: int = 0):
        """添加工具提供者
        
        Args:
            provider: 工具提供者实例
            priority: 优先级（数字越小优先级越高，默认为 0）
            
        注意:
            - 提供者会按优先级排序（数字小的在前）
            - 查找工具时会按顺序遍历所有提供者
        """
        self._providers.append((priority, provider))
        self._providers.sort(key=lambda x: x[0])  # 按优先级排序
        self._tools_cache.clear()  # 清空缓存
        logger.info(f"Added tool provider with priority {priority}")
    
    async def get_all_tools(self) -> Dict[str, Dict[str, Any]]:
        """获取所有工具（合并所有提供者）
        
        Returns:
            Dict: {tool_name: tool_schema}
            
        注意:
            - 如果多个提供者有同名工具，优先级高的会覆盖低的
            - 结果会缓存，下次调用直接返回
        """
        all_tools = {}
        
        for _, provider in self._providers:
            try:
                tools = await provider.get_tools()
                all_tools.update(tools)
            except Exception as e:
                logger.error(f"Error getting tools from provider: {e}")
                logger.exception(e)
        
        logger.debug(f"Total tools available: {len(all_tools)}")
        return all_tools
    
    async def get_all_tools_schema(
        self,
        enabled_tools: Optional[list] = None,
        enabled_mcp_servers: Optional[list] = None,
    ) -> list:
        """获取所有工具的 schema（OpenAI Function Calling 格式）
        
        Args:
            enabled_tools: 已启用的工具 ID/名称列表（None 表示全部启用）
                          - 对于本地工具：检查是否在列表中
                          - 对于 MCP 工具：检查其服务器是否在 enabled_mcp_servers 中
            enabled_mcp_servers: 已启用的 MCP 服务器 ID 列表（None 表示全部启用）
            
        Returns:
            List[Dict]: OpenAI Function Calling 格式的工具 schema 列表
            
        示例:
            [
                {
                    "type": "function",
                    "function": {
                        "name": "get_current_time",
                        "description": "Get current time",
                        "parameters": {...}
                    }
                },
                {
                    "type": "function", 
                    "function": {
                        "name": "mcp__search",
                        "description": "Search the web",
                        "parameters": {...}
                    }
                }
            ]
        """
        all_tools = await self.get_all_tools()
        tools_schema = []
        
        for tool_name, tool_data in all_tools.items():
            # 跳过未启用的本地工具
            is_mcp_tool = tool_name.startswith("mcp__")
            
            if not is_mcp_tool and enabled_tools is not None:
                # 本地工具：检查是否在启用列表中
                if tool_name not in enabled_tools:
                    logger.debug(f"Skipping disabled local tool: {tool_name}")
                    continue
            
            # 跳过未启用的 MCP 工具
            if is_mcp_tool and enabled_mcp_servers is not None:
                # MCP 工具：检查其服务器是否在启用列表中
                server_id = tool_data.get("_mcp_server_id")
                if server_id and server_id not in enabled_mcp_servers:
                    logger.debug(f"Skipping disabled MCP tool (server {server_id}): {tool_name}")
                    continue
            
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
        
        logger.info(f"Generated schema for {len(tools_schema)} tools (filtered from {len(all_tools)} total tools)")
        return tools_schema
    
    async def find_provider_for_tool(self, tool_name: str) -> Optional[IToolProvider]:
        """查找能处理指定工具的提供者
        
        Args:
            tool_name: 工具名称
            
        Returns:
            IToolProvider: 工具提供者或 None
            
        策略:
            1. 先检查缓存（O(1)）
            2. 遍历所有提供者查找（O(n)）
            3. 找到后缓存结果
        """
        # 检查缓存
        if tool_name in self._tools_cache:
            logger.debug(f"Found cached provider for tool: {tool_name}")
            return self._tools_cache[tool_name]
        
        # 遍历所有提供者查找
        for _, provider in self._providers:
            try:
                if await provider.is_available(tool_name):
                    self._tools_cache[tool_name] = provider
                    logger.info(f"Found provider for tool: {tool_name}")
                    return provider
            except Exception as e:
                logger.error(f"Error checking provider for tool {tool_name}: {e}")
                logger.exception(e)
        
        logger.warning(f"No provider found for tool: {tool_name}")
        return None
    
    async def execute(self, request: ToolCallRequest) -> ToolCallResponse:
        """执行工具调用（自动路由到正确的提供者）
        
        Args:
            request: 工具调用请求
            
        Returns:
            ToolCallResponse: 工具调用结果
            
        Raises:
            ValueError: 如果找不到对应的工具提供者
            
        流程:
            1. 查找能处理该工具的提供者
            2. 委托给提供者执行
            3. 如果未找到提供者，返回错误响应
        """
        provider = await self.find_provider_for_tool(request.name)
        
        if provider is None:
            logger.warning(f"Tool not found: {request.name}")
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Tool not found: {request.name}",
                is_error=True
            )
        
        # 委托给具体提供者执行
        try:
            logger.debug(f"Executing tool {request.name} via {provider.__class__.__name__}")
            return await provider.execute(request)
        except Exception as e:
            logger.error(f"Error executing tool {request.name}: {e}")
            logger.exception(e)
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True
            )
    
    async def execute_batch(
        self, 
        requests: List[ToolCallRequest]
    ) -> List[ToolCallResponse]:
        """批量执行工具调用
        
        Args:
            requests: 工具调用请求列表
            
        Returns:
            List[ToolCallResponse]: 工具调用结果列表
            
        特点:
            - 并发执行所有请求（使用 asyncio.gather）
            - 异常会被转换为错误响应，不会中断其他请求
            - 适合一次调用多个工具的场景
            
        示例:
            responses = await orchestrator.execute_batch([
                ToolCallRequest(id="1", name="tool1", arguments={}),
                ToolCallRequest(id="2", name="tool2", arguments={}),
            ])
        """
        if not requests:
            return []
        
        # 创建所有任务
        tasks = [self.execute(req) for req in requests]
        
        # 并发执行
        results = await gather(*tasks, return_exceptions=True)
        
        # 处理异常情况
        responses = []
        for req, result in zip(requests, results):
            if isinstance(result, Exception):
                logger.error(f"Exception in batch execution for {req.name}: {result}")
                responses.append(ToolCallResponse(
                    tool_call_id=req.id,
                    name=req.name,
                    content=str(result),
                    is_error=True
                ))
            else:
                responses.append(result)
        
        logger.debug(f"Batch executed {len(requests)} tool calls")
        return responses
    
    def clear_cache(self):
        """清空工具缓存
        
        使用场景:
            - 工具提供者发生变化（添加/删除）
            - 工具注册信息更新
            - 调试和测试
        """
        self._tools_cache.clear()
        logger.info("Tool cache cleared")
