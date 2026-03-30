"""
记忆工具提供者实现

提供长期记忆的增删改查功能
已重构为统一的 IToolProvider 接口，移除 Family 中间层
存放在 providers 目录，符合统一架构规范
"""

import json
import logging
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.memory_repository import MemoryRepository
from app.services.tools.providers.tool_provider_base import (
    IToolProvider,
    ToolCallRequest,
    ToolCallResponse,
    ToolProviderConfig,
)
from app.utils.openai_tool_converter import convert_to_openai_tool

logger = logging.getLogger(__name__)


# ============================================================================
# Pydantic 参数模型（用于自动生成 Schema）
# ============================================================================


class AddMemoryParams(BaseModel):
    """添加记忆的参数"""

    content: str = Field(..., description="要记住的内容")
    memory_type: Literal["general", "emotional", "factual"] = Field(
        default="general",
        description="记忆类型：general(一般)/emotional(情感)/factual(事实)",
    )
    importance: int = Field(
        default=5,
        ge=1,
        le=10,
        description="重要性评分 (1-10)，日常对话 (1-3), 偏好 (4-6), 关键信息 (7-10)",
    )
    tags: List[str] = Field(
        default_factory=list, description="标签列表，用于分类和检索"
    )


class SearchMemoriesParams(BaseModel):
    """搜索记忆的参数"""

    query: str = Field(..., description="搜索关键词")
    memory_type: Optional[Literal["general", "emotional", "factual"]] = Field(
        default=None, description="记忆类型过滤"
    )
    min_importance: Optional[int] = Field(
        default=None, ge=1, le=10, description="最小重要性"
    )
    limit: int = Field(default=10, ge=1, description="返回数量限制")


class EditMemoryParams(BaseModel):
    """编辑记忆的参数"""

    memory_id: str = Field(..., description="记忆 ID")
    content: Optional[str] = Field(default=None, description="新的记忆内容")
    importance: Optional[int] = Field(
        default=None, ge=1, le=10, description="新的重要性评分"
    )


class SummarizeMemoriesParams(BaseModel):
    """总结记忆参数"""

    limit: int = Field(default=20, ge=1, description="最多总结多少条记忆")


class MemoryToolProvider(IToolProvider):
    """记忆工具提供者（统一实现）

    提供长期记忆的增删改查功能
    已重构为统一的 IToolProvider 接口，移除 Family 中间层

    Attributes:
        session: 数据库会话
        repo: 记忆仓库
    """

    @property
    def namespace(self) -> str:
        """命名空间：memory"""
        return "memory"

    def __init__(self, session: AsyncSession):
        """初始化

        Args:
            session: 数据库会话
        """
        self.session = session
        self.repo = MemoryRepository(session)
        self._initialized = False
        # 延迟初始化 tools，避免在 __init__ 中引用未定义的方法
        self.tools: Dict[str, Dict[str, Any]] = {}

    async def _get_tools_internal(
        self, enabled_ids: Optional[List[str] | bool] = None
    ) -> Dict[str, Dict[str, Any]]:
        """获取工具列表（使用 Pydantic 自动生成 Schema，返回完整 OpenAI 格式）

        Returns:
            Dict: {tool_name: openai_format_schema}
                  每个 schema 都是完整的 OpenAI Function Calling 格式
                  注意：tool_name 不含命名空间，由父类 get_tools_namespaced() 添加
        """
        # 延迟初始化工具 Schema
        
        if not self.tools:
            from app.utils.openai_tool_converter import convert_to_openai_tool

            self.tools = {
                "add_memory": convert_to_openai_tool(
                    MemoryToolProvider.add_memory, description="添加新的长期记忆"
                ),
                "search_memories": convert_to_openai_tool(
                    MemoryToolProvider.search_memories, description="搜索长期记忆"
                ),
                "edit_memory": convert_to_openai_tool(
                    MemoryToolProvider.edit_memory, description="编辑已有记忆"
                ),
                "summarize_memories": convert_to_openai_tool(
                    MemoryToolProvider.summarize_memories,
                    description="总结所有长期记忆",
                ),
            }

        if isinstance(enabled_ids, bool) and enabled_ids:
            return self.tools
        elif isinstance(enabled_ids, list) and enabled_ids:
            return {
                name: self.tools[name] for name in enabled_ids if name in self.tools
            }
        else:
            return {}

    async def _execute_internal(
        self, request: "ToolCallRequest", inject_params: Optional[Dict[str, Any]] = None
    ) -> "ToolCallResponse":
        """实际执行记忆工具调用（名称已去除前缀）

        Args:
            request: 工具调用请求（名称已去除 memory__ 前缀）
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            ToolCallResponse: 工具调用结果
        """
        from app.services.tools.providers.tool_provider_base import ToolCallResponse

        try:
            tool_name = request.name  # 已经是去掉前缀的名称
            arguments = json.loads(request.arguments)

            # 直接使用注入参数（由 execute_with_namespace() 传递）
            result_str = await self._execute_tool(tool_name, arguments, inject_params)

            return ToolCallResponse(
                tool_call_id=request.id,
                name=f"{self.namespace}__{tool_name}",
                content=result_str,
                is_error=False,
            )
        except Exception as e:
            logger.error(f"Memory provider error: {e}")
            logger.exception(e)
            return ToolCallResponse(
                tool_call_id=request.id,
                name=request.name,
                content=str(e),
                is_error=True,
            )

    async def _execute_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        inject_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """执行具体的记忆工具逻辑

        改进：将 arguments 转换为对应的 Pydantic 模型，利用模型验证功能
        新增：inject_params 用于传递注入参数（如 session_id），不写入模型

        Args:
            tool_name: 工具名称（不含前缀）
            arguments: 参数字典（工具参数，不包含注入参数）
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            执行结果字符串
        """
        if inject_params is None:
            inject_params = {}

        if tool_name == "add_memory":
            # 转换为 Pydantic 模型，自动验证参数
            params = AddMemoryParams(**arguments)
            return await self.add_memory(params, inject_params)
        elif tool_name == "search_memories":
            params = SearchMemoriesParams(**arguments)
            return await self.search_memories(params, inject_params)
        elif tool_name == "edit_memory":
            params = EditMemoryParams(**arguments)
            return await self.edit_memory(params, inject_params)
        elif tool_name == "summarize_memories":
            params = SummarizeMemoriesParams(**arguments)
            return await self.summarize_memories(params, inject_params)
        else:
            return f"Unknown memory tool: {tool_name}"

    async def is_available(self, tool_name: str) -> bool:
        """检查工具是否可用

        改进：支持带命名空间前缀和不带前缀的检查
        """
        # 支持带前缀和不带前缀的检查
        base_name = tool_name.replace(f"{self.namespace}__", "")
        # 使用 _get_tools_internal() 获取工具（不含命名空间）
        tools = await self._get_tools_internal(enabled_ids=True)
        return base_name in tools or tool_name in tools

    async def add_memory(
        self, params: AddMemoryParams, inject_params: Optional[Dict[str, Any]] = None
    ) -> str:
        """添加记忆

        改进：使用 Pydantic 模型参数，自动验证数据

        Args:
            params: 添加记忆参数（已验证）
            inject_params: 注入参数（如 session_id）
        """
        # 从注入参数中获取 session_id
        session_id = (
            inject_params.get("session_id", "unknown") if inject_params else "unknown"
        )

        memory = await self.repo.create_memory(
            session_id=session_id,
            content=params.content,
            memory_type=params.memory_type,
            importance=params.importance,
            tags=params.tags,
        )
        return f"✓ 记忆已添加 (ID: {memory.id}, 重要性：{memory.importance})"

    async def search_memories(
        self,
        params: SearchMemoriesParams,
        inject_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """搜索记忆

        改进：使用 Pydantic 模型参数，自动验证数据

        Args:
            params: 搜索记忆参数（已验证）
            inject_params: 注入参数（如 session_id）
        """
        # 从注入参数中获取 session_id
        session_id = (
            inject_params.get("session_id", "unknown") if inject_params else "unknown"
        )

        memories = await self.repo.search_memories(
            session_id=session_id,
            query=params.query,
            memory_type=params.memory_type,
            min_importance=params.min_importance,
            limit=params.limit,
        )

        if not memories:
            return "未找到相关记忆"

        results = []
        for mem in memories:
            results.append(
                f"[{mem.importance}][{mem.memory_type}] {mem.content} "
                f"(标签：{', '.join(mem.tags or [])})"
            )

        return f"找到 {len(memories)} 条记忆:\n" + "\n".join(results)

    async def edit_memory(
        self, params: EditMemoryParams, inject_params: Optional[Dict[str, Any]] = None
    ) -> str:
        """编辑记忆

        改进：使用 Pydantic 模型参数，自动验证数据

        Args:
            params: 编辑记忆参数（已验证）
            inject_params: 注入参数（如 session_id）
        """
        # 从注入参数中获取 session_id（用于权限验证）
        session_id = inject_params.get("session_id") if inject_params else None
        memory = await self.repo.update_memory(
            memory_id=params.memory_id,
            content=params.content,
            importance=params.importance,
        )

        if not memory:
            return f"未找到记忆：{params.memory_id}"

        return f"✓ 记忆已更新 (ID: {memory.id})"

    async def summarize_memories(
        self,
        params: SummarizeMemoriesParams,
        inject_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """总结记忆

        改进：使用 Pydantic 模型参数，自动验证数据

        Args:
            params: 总结记忆参数（已验证）
            inject_params: 注入参数（如 session_id）
        """
        # 从注入参数中获取 session_id
        session_id = (
            inject_params.get("session_id", "unknown") if inject_params else "unknown"
        )

        summary = await self.repo.summarize_memories(
            session_id=session_id,
            limit=params.limit,
        )
        return f"长期记忆摘要:\n{summary}"

    async def get_prompt(self, inject_params: Optional[Dict[str, Any]] = None) -> str:
        """获取记忆工具的提示词注入（注入当前记忆）

        Args:
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            str: 包含记忆内容的提示词
        """
        try:
            # 从注入参数中获取 session_id
            session_id = (
                inject_params.get("session_id", "unknown")
                if inject_params
                else "unknown"
            )
            memories = await self._get_relevant_memories(session_id)

            if not memories:
                return ""  # 没有记忆，不注入提示词

            # 构建记忆提示词
            prompt_parts = ["【重要记忆】"]

            for memory in memories[:5]:  # 最多注入 5 条记忆
                prompt_parts.append(
                    f"- {memory.get('content', '')} "
                    f"(类型：{memory.get('memory_type', 'general')}, "
                    f"重要性：{memory.get('importance', 5)}/10)"
                )

            prompt_parts.append("\n在与用户对话时，请考虑以上记忆内容。")

            return "\n".join(prompt_parts)

        except Exception as e:
            logger.error(f"Error getting memory prompt: {e}")
            return ""  # 出错时返回空字符串，不影响对话

    async def _get_relevant_memories(self, session_id: str) -> List[Dict[str, Any]]:
        """获取与当前会话相关的记忆（内部方法）

        TODO: 实现记忆查询逻辑
        这里可以根据 session_id 查询最近的记忆
        或者根据对话上下文进行向量搜索
        """
        return []


# ============================================================================
# 向后兼容：保留旧类名（已废弃）
# ============================================================================

# 为了保持向后兼容，将旧的 MemoryToolFamily 指向新的 MemoryToolProvider
MemoryToolFamily = MemoryToolProvider
