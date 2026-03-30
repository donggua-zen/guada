"""
改进方案 2：会话级参数自动注入

解决记忆工具需要 session_id 但 LLM 不会提供的问题
"""

# ============================================================================
# 方案设计：拦截器模式 + 参数签名检测
# ============================================================================

"""
架构设计：

AgentService._handle_all_tool_calls()
    ↓
[参数注入拦截器] ← 根据当前 session 自动注入 system_params
    ↓
ToolOrchestrator.execute_batch()
    ↓
各个 ToolProvider.execute()
"""

# ============================================================================
# Step 1: 定义参数注入规则
# ============================================================================

"""
文件：app/services/tools/tool_injector.py (新建)
"""

import inspect
from typing import Any, Callable, Dict, List, Optional, get_type_hints
from functools import wraps


class ToolParameterInjector:
    """工具参数注入器
    
    根据工具函数的参数签名，自动注入系统级参数
    """
    
    # 系统级参数列表（按优先级排序）
    SYSTEM_PARAMS = {
        'session_id': str,      # 会话 ID（最高优先级）
        'user_id': str,         # 用户 ID（未来扩展）
        'character_id': str,    # 角色 ID（未来扩展）
    }
    
    def __init__(self):
        self._injection_cache: Dict[str, List[str]] = {}
    
    def inject_params(
        self, 
        tool_name: str, 
        arguments: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """注入系统参数到工具调用参数中
        
        Args:
            tool_name: 工具名称
            arguments: 原始参数字典（来自 LLM）
            context: 上下文信息（包含 session_id 等）
            
        Returns:
            注入后的参数字典
        """
        # 检查是否需要注入（缓存优化）
        if tool_name not in self._injection_cache:
            self._injection_cache[tool_name] = self._detect_system_params(tool_name)
        
        params_to_inject = self._injection_cache[tool_name]
        
        # 如果没有系统参数需要注入，直接返回
        if not params_to_inject:
            return arguments
        
        # 创建新的参数字典（不修改原始数据）
        injected_args = arguments.copy()
        
        # 注入系统参数
        for param_name in params_to_inject:
            if param_name in context:
                injected_args[param_name] = context[param_name]
        
        return injected_args
    
    def _detect_system_params(self, tool_name: str) -> List[str]:
        """检测工具函数需要哪些系统参数
        
        通过分析工具函数的参数签名来检测
        
        Returns:
            需要注入的系统参数列表
        """
        # 延迟导入避免循环引用
        from app.services.tools.families.memory_tool_family import MemoryToolFamily
        
        # 获取工具族实例
        # 注意：这里需要根据实际架构调整获取方式
        family = None
        
        # 尝试从不同 Provider 获取工具函数
        if tool_name.startswith('memory__'):
            family = MemoryToolFamily(None)  # type: ignore
            
            # 去掉前缀获取真实工具名
            base_tool_name = tool_name.replace('memory__', '')
            
            # 获取对应的方法
            if hasattr(family, f'_{base_tool_name}'):
                method = getattr(family, f'_{base_tool_name}')
                return self._inspect_method_signature(method)
        
        return []
    
    def _inspect_method_signature(self, method: Callable) -> List[str]:
        """分析方法签名，提取系统参数
        
        Returns:
            系统参数名称列表
        """
        try:
            # 获取参数签名
            sig = inspect.signature(method)
            params_needed = []
            
            for param_name, param in sig.parameters.items():
                # 跳过 self、arguments 等特殊参数
                if param_name in ('self', 'args', 'kwargs'):
                    continue
                
                # 检查是否是系统参数
                if param_name in self.SYSTEM_PARAMS:
                    # 进一步验证类型
                    param_annotation = param.annotation
                    if param_annotation == inspect.Parameter.empty or \
                       param_annotation == self.SYSTEM_PARAMS[param_name]:
                        params_needed.append(param_name)
            
            return params_needed
            
        except Exception as e:
            # 签名检测失败时不注入
            return []
    
    def clear_cache(self):
        """清空缓存（用于工具更新后）"""
        self._injection_cache.clear()


# ============================================================================
# Step 2: 在 AgentService 中集成注入器
# ============================================================================

"""
文件：app/services/agent_service.py (修改)
"""

class AgentService:
    def __init__(
        self,
        session_repo: SessionRepository,
        model_repo: ModelRepository,
        message_repo: MessageRepository,
        memory_manager_service: MemoryManagerService,
        setting_service: SettingsManager,
        mcp_tool_manager: MCPToolManager,
        tool_orchestrator: ToolOrchestrator,
    ):
        self.session_repo = session_repo
        self.model_repo = model_repo
        self.message_repo = message_repo
        self.memory_manager_service = memory_manager_service
        self.setting_service = setting_service
        self.mcp_tool_manager = mcp_tool_manager
        self.tool_orchestrator = tool_orchestrator
        
        # ✅ 新增：参数注入器
        from app.services.tools.tool_injector import ToolParameterInjector
        self.param_injector = ToolParameterInjector()
    
    async def _handle_all_tool_calls(
        self,
        tool_calls: List[Dict[str, Any]],
        session_id: str,  # ✅ 新增参数
    ) -> List[Dict[str, Any]]:
        """处理所有工具调用（带参数注入）
        
        Args:
            tool_calls: 工具调用列表
            session_id: 当前会话 ID（用于自动注入）
            
        Returns:
            工具执行结果列表
        """
        from app.services.tools.providers.tool_provider_base import ToolCallRequest
        
        # ✅ 构建注入上下文
        injection_context = {
            'session_id': session_id,
            # 未来可以扩展更多参数
            # 'user_id': current_user.id,
            # 'character_id': session.character_id,
        }
        
        # ✅ 为每个工具调用注入参数
        requests = []
        for tc in tool_calls:
            # 解析参数
            arguments = json.loads(tc["arguments"])
            
            # 🔥 自动注入系统参数
            injected_arguments = self.param_injector.inject_params(
                tool_name=tc["name"],
                arguments=arguments,
                context=injection_context,
            )
            
            # 创建请求对象
            requests.append(
                ToolCallRequest(
                    id=tc["id"],
                    name=tc["name"],
                    arguments=json.dumps(injected_arguments),  # ✅ 使用注入后的参数
                )
            )
        
        # 批量执行（自动路由到正确的提供者）
        responses = await self.tool_orchestrator.execute_batch(requests)
        
        # 格式化为 OpenAI 兼容格式
        return [
            {
                "tool_call_id": r.tool_call_id,
                "role": r.role,
                "name": r.name,
                "content": r.content,
            }
            for r in responses
        ]


# ============================================================================
# Step 3: 更新 completions 方法传递 session_id
# ============================================================================

"""
在 AgentService.completions() 方法中调用时传递 session_id
"""

async def completions(
    self,
    session_id: str,
    user_message_id: str,
    character_id: Optional[str] = None,
    # ... 其他参数
) -> AsyncGenerator[Dict[str, Any], None]:
    # ... 前面的代码保持不变
    
    # 处理工具调用
    if tool_calls:
        tool_results = await self._handle_all_tool_calls(
            tool_calls=tool_calls,
            session_id=session_id,  # ✅ 传递 session_id
        )
        
        # ... 后续处理


# ============================================================================
# Step 4: 简化记忆工具实现（不再需要手动验证 session_id）
# ============================================================================

"""
文件：app/services/tools/families/memory_tool_family.py (优化版)
"""

class MemoryToolFamily(IToolFamily):
    async def _add_memory(self, args: Dict[str, Any]) -> str:
        """添加记忆
        
        ⚠️ 现在 session_id 已由系统自动注入，无需手动验证
        """
        # ✅ session_id 保证存在（由注入器保证）
        session_id = args["session_id"]
        
        memory = await self.repo.create_memory(
            session_id=session_id,
            content=args["content"],
            memory_type=args.get("memory_type", "general"),
            importance=args.get("importance", 5),
            tags=args.get("tags", []),
        )
        return f"✓ 记忆已添加 (ID: {memory.id}, 重要性：{memory.importance})"
    
    async def _search_memories(self, args: Dict[str, Any]) -> str:
        """搜索记忆
        
        ⚠️ session_id 已自动注入
        """
        session_id = args["session_id"]
        
        memories = await self.repo.search_memories(
            session_id=session_id,
            query=args["query"],
            memory_type=args.get("memory_type"),
            min_importance=args.get("min_importance"),
            limit=args.get("limit", 10),
        )
        
        if not memories:
            return "未找到相关记忆"
        
        results = []
        for mem in memories:
            results.append(
                f"[{mem.importance}⭐][{mem.memory_type}] {mem.content} "
                f"(标签：{', '.join(mem.tags or [])})"
            )
        
        return f"找到 {len(memories)} 条记忆:\n" + "\n".join(results)


# ============================================================================
# 备选方案：在 ToolOrchestrator 层面拦截
# ============================================================================

"""
如果不希望在 AgentService 中处理，可以在 ToolOrchestrator 中添加拦截器
"""

class ToolOrchestrator:
    def __init__(self):
        self._providers: List[Tuple[int, IToolProvider]] = []
        self._tools_cache: Dict[str, IToolProvider] = {}
        
        # ✅ 添加注入器
        from app.services.tools.tool_injector import ToolParameterInjector
        self.param_injector = ToolParameterInjector()
    
    async def execute(
        self, 
        request: ToolCallRequest,
        context: Optional[Dict[str, Any]] = None,  # ✅ 新增可选上下文
    ) -> ToolCallResponse:
        """执行工具调用（带参数注入）
        
        Args:
            request: 工具调用请求
            context: 上下文信息（包含 session_id 等）
        """
        provider = await self.find_provider_for_tool(request.name)
        
        if provider is None:
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=f"Tool not found: {request.name}",
                is_error=True
            )
        
        # ✅ 注入参数
        if context:
            injected_arguments = self.param_injector.inject_params(
                tool_name=request.name,
                arguments=request.arguments,
                context=context,
            )
            # 创建新的请求对象
            request = ToolCallRequest(
                id=request.id,
                name=request.name,
                arguments=injected_arguments,
            )
        
        # 委托给具体提供者执行
        return await provider.execute(request)
    
    async def execute_batch(
        self, 
        requests: List[ToolCallRequest],
        context: Optional[Dict[str, Any]] = None,  # ✅ 新增可选上下文
    ) -> List[ToolCallResponse]:
        """批量执行工具调用（带参数注入）"""
        if not requests:
            return []
        
        # 为每个请求注入参数
        if context:
            injected_requests = []
            for req in requests:
                injected_arguments = self.param_injector.inject_params(
                    tool_name=req.name,
                    arguments=req.arguments,
                    context=context,
                )
                injected_requests.append(
                    ToolCallRequest(
                        id=req.id,
                        name=req.name,
                        arguments=injected_arguments,
                    )
                )
            requests = injected_requests
        
        # 并发执行
        tasks = [self.execute(req) for req in requests]
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
        
        return responses


# ============================================================================
# 方案总结与推荐
# ============================================================================

"""
✅ 推荐方案：在 AgentService 层面拦截

理由：
1. 职责清晰：AgentService 负责业务逻辑编排，包括参数注入
2. 性能更好：在批量执行前一次性注入，而不是每次 execute 都注入
3. 易于调试：注入逻辑集中在一个地方
4. 符合分层架构：AgentService → ToolOrchestrator → Provider

实施步骤：
1. 创建 ToolParameterInjector 类（参数签名检测）
2. 在 AgentService 中集成注入器
3. 修改 _handle_all_tool_calls() 接受 session_id 参数
4. 更新所有调用 _handle_all_tool_calls() 的地方
5. 简化记忆工具实现（移除手动验证）
6. 运行测试确保注入正常工作

向后兼容性：
- 不影响现有不需要 session_id 的工具（注入器会自动检测）
- MCP 工具和本地工具不受影响
- 可以逐步迁移到新机制
"""
