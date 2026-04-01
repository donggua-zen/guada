"""
记忆工具提供者实现

提供长期记忆和短期记忆的完整管理功能
已重构为支持长期/短期记忆分离架构
存放在 providers 目录，符合统一架构规范
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from enum import Enum
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
# 枚举定义
# ============================================================================


class MemoryCategory(str, Enum):
    """记忆分类"""

    LONG_TERM = "long_term"
    SHORT_TERM = "short_term"


class WriteMode(str, Enum):
    """写入模式"""

    APPEND = "append"  # 追加模式（默认）
    OVERWRITE = "overwrite"  # 覆盖模式


class LongTermMemoryType(str, Enum):
    """长期记忆类型"""

    FACTUAL = "factual"
    SOUL = "soul"


class ViewLongTermMemoryParams(BaseModel):
    """查看长期记忆参数"""

    memory_type: LongTermMemoryType = Field(
        ...,
        description="长期记忆类型：FACTUAL(事实性)/SOUL(人格定义)",
    )


class ShortTermMemoryType(str, Enum):
    """短期记忆类型"""

    TEMPORARY = "temporary"
    CONTEXT = "context"


# ============================================================================
# Pydantic 参数模型（用于自动生成 Schema）
# ============================================================================


# ============================================================================
# 长期记忆参数模型（仅支持编辑/Upsert）
# ============================================================================


class UpsertLongTermMemoryParams(BaseModel):
    """Upsert 长期记忆参数（按类型编辑或自动创建）

    设计说明:
    - 基于 memory_type 进行 Upsert 操作
    - 如果该类型的记录存在则更新，不存在则自动创建
    - 支持两种写入模式：追加（默认）和覆盖
    """

    memory_type: LongTermMemoryType = Field(
        default=LongTermMemoryType.FACTUAL,
        description="长期记忆类型：FACTUAL(事实性)/SOUL(人格定义)",
    )
    content: str = Field(..., description="记忆内容")
    write_mode: WriteMode = Field(
        default=WriteMode.APPEND,
        description="写入模式：append(追加，默认)/overwrite(覆盖)",
    )


# ============================================================================
# 短期记忆参数模型（完整 CRUD）
# ============================================================================


class AddShortTermMemoryParams(BaseModel):
    """添加短期记忆参数"""

    content: str = Field(..., description="要记住的内容")
    memory_type: ShortTermMemoryType = Field(
        default=ShortTermMemoryType.TEMPORARY,
        description="短期记忆类型：TEMPORARY(临时)/CONTEXT(上下文)",
    )
    ttl_seconds: Optional[int] = Field(
        default=3600,  # 默认 1 小时过期
        ge=60,
        description="生存时间（秒），过期后自动清理",
    )
    tags: List[str] = Field(default_factory=list, description="标签列表")


class SearchShortTermMemoryParams(BaseModel):
    """搜索短期记忆参数"""

    query: str = Field(..., description="搜索关键词")
    memory_type: Optional[ShortTermMemoryType] = Field(
        default=None, description="记忆类型过滤"
    )
    limit: int = Field(default=10, ge=1, description="返回数量限制")


class DeleteShortTermMemoryParams(BaseModel):
    """删除短期记忆参数"""

    memory_id: str = Field(..., description="要删除的记忆 ID")


class MemoryToolProvider(IToolProvider):
    """记忆工具提供者（重构版）

    工具列表设计:
    - long_term__view: 查看长期记忆
    - long_term__edit: 编辑长期记忆
    （短期记忆工具暂时不暴露给 AI）

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
    ) -> List[Dict[str, Any]]:
        """获取工具列表（重构为分组设计）

        Returns:
            List[Dict[str, Any]]: 工具 schema 列表，每个都是完整的 OpenAI Function Calling 格式
                                  列表中的每个元素包含 tool_name 作为 key
        """
        if not self.tools:
            from app.utils.openai_tool_converter import convert_to_openai_tool

            # 长期记忆工具组
            long_term_tools = [
                convert_to_openai_tool(
                    self._long_term__view,
                    name="long_term__view",
                    description="查看长期记忆（支持按类型筛选）",
                ),
                convert_to_openai_tool(
                    self._long_term__edit,
                    name="long_term__edit",
                    description="Upsert 长期记忆（按类型编辑或自动创建）",
                ),
            ]

            # 暂时不暴露短期记忆工具给 AI
            # # 短期记忆工具组
            # short_term_tools = [
            #     convert_to_openai_tool(
            #         self._add_short_term,
            #         name="short_term__add",
            #         description="添加短期记忆",
            #     ),
            #     convert_to_openai_tool(
            #         self._search_short_term,
            #         name="short_term__search",
            #         description="搜索短期记忆",
            #     ),
            #     convert_to_openai_tool(
            #         self._delete_short_term,
            #         name="short_term__delete",
            #         description="删除短期记忆",
            #     ),
            # ]
            self.tools = long_term_tools

        if isinstance(enabled_ids, bool) and enabled_ids:
            return self.tools
        elif isinstance(enabled_ids, list) and enabled_ids:
            # 过滤列表
            filtered_list = []
            for tool_item in self.tools:
                tool_name = tool_item["function"]["name"]
                if tool_name in enabled_ids:
                    filtered_list.append(tool_item)
            return filtered_list
        else:
            return []

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
            arguments = request.arguments

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
        """执行具体的记忆工具逻辑（重构版）

        设计说明:
        - 将 arguments 转换为对应的 Pydantic 模型，利用模型验证功能
        - inject_params 用于传递注入参数（如 session_id），不写入模型

        Args:
            tool_name: 工具名称（不含前缀，如 "long_term__edit"）
            arguments: 参数字典（工具参数，不包含注入参数）
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            执行结果字符串
        """
        if inject_params is None:
            inject_params = {}

        # 验证 session_id 注入
        session_id = inject_params.get("session_id")
        if not session_id:
            return "❌ 错误：缺少 session_id 注入参数"

        # 长期记忆工具
        if tool_name == "long_term__view":
            params = ViewLongTermMemoryParams(**arguments)
            return await self._long_term__view(params, session_id)
        elif tool_name == "long_term__edit":
            params = UpsertLongTermMemoryParams(**arguments)
            return await self._long_term__edit(params, session_id)

        # 短期记忆工具
        elif tool_name == "short_term__add":
            params = AddShortTermMemoryParams(**arguments)
            return await self._add_short_term(params, session_id)

        elif tool_name == "short_term__search":
            params = SearchShortTermMemoryParams(**arguments)
            return await self._search_short_term(params, session_id)

        elif tool_name == "short_term__delete":
            params = DeleteShortTermMemoryParams(**arguments)
            return await self._delete_short_term(params, session_id)

        else:
            return f"❌ 未知工具：{tool_name}"

    # ============================================================================
    # 长期记忆工具方法
    # ============================================================================

    async def _long_term__view(
        self,
        params: ViewLongTermMemoryParams,
        session_id: str,
    ) -> str:
        """查看长期记忆（支持按类型筛选）

        Args:
            params: 查看参数
            session_id: 会话 ID

        Returns:
            格式化后的记忆内容
        """
        from sqlalchemy import select, desc
        from app.models.memory import Memory, MemoryCategory

        try:
            # 构建查询
            stmt = (
                select(Memory)
                .filter(
                    Memory.session_id == session_id,
                    Memory.category == MemoryCategory.LONG_TERM.value,
                    Memory.memory_type == params.memory_type.value,
                )
                .order_by(desc(Memory.importance), desc(Memory.created_at))
            )

            result = await self.session.execute(stmt)
            memories = result.scalars().all()

            if not memories:
                return f"❌ 未找到{params.memory_type.value}类型的长期记忆"

            results = []
            for i, mem in enumerate(memories, 1):
                # created = mem.created_at.strftime("%Y-%m-%d %H:%M")
                results.append(f"{i}. {mem.content}")

            return "\n".join(results)

        except Exception as e:
            logger.error(f"Error viewing long term memories: {e}")
            return f"❌ 查看长期记忆时出错：{str(e)}"

    async def _long_term__edit(
        self,
        params: UpsertLongTermMemoryParams,
        session_id: str,
    ) -> str:
        """Upsert 长期记忆（按类型编辑或自动创建）

        Args:
            params: Upsert 参数
            session_id: 会话 ID（用于数据隔离）
        """
        memory = await self.repo.upsert_long_term_memory(
            session_id=session_id,
            memory_type=params.memory_type.value,
            content=params.content,
            write_mode=params.write_mode.value,
        )

        mode_desc = "追加" if params.write_mode == WriteMode.APPEND else "覆盖"
        return f"✓ 长期记忆已{mode_desc}"

    # ============================================================================
    # 短期记忆工具方法
    # ============================================================================

    async def _add_short_term(
        self,
        params: AddShortTermMemoryParams,
        session_id: str,
    ) -> str:
        """添加短期记忆

        Args:
            params: 添加参数
            session_id: 会话 ID
        """
        memory = await self.repo.add_short_term_memory(
            session_id=session_id,
            content=params.content,
            memory_type=params.memory_type.value,
            ttl_seconds=params.ttl_seconds or 3600,
            tags=params.tags,
        )

        expires_at = memory.expires_at
        if expires_at:
            expires_str = expires_at.strftime("%Y-%m-%d %H:%M")
        else:
            expires_str = "永不过期"

        return f"✓ 短期记忆已添加 (ID: {memory.id}, 过期时间：{expires_str})"

    async def _search_short_term(
        self,
        params: SearchShortTermMemoryParams,
        session_id: str,
    ) -> str:
        """搜索短期记忆

        Args:
            params: 搜索参数
            session_id: 会话 ID
        """
        memories = await self.repo.search_short_term_memories(
            session_id=session_id,
            query=params.query,
            memory_type=params.memory_type.value if params.memory_type else None,
            limit=params.limit,
        )

        if not memories:
            return "❌ 未找到相关短期记忆"

        results = []
        for mem in memories:
            expires_str = ""
            if mem.expires_at:
                expires_str = f" [过期：{mem.expires_at.strftime('%m-%d %H:%M')}]"

            results.append(f"- {mem.content}{expires_str}")

        return f"找到 {len(memories)} 条短期记忆:\n" + "\n".join(results)

    async def _delete_short_term(
        self,
        params: DeleteShortTermMemoryParams,
        session_id: str,
    ) -> str:
        """删除短期记忆

        Args:
            params: 删除参数
            session_id: 会话 ID（用于权限验证）
        """
        success = await self.repo.delete_short_term_memory(
            session_id=session_id,
            memory_id=params.memory_id,
        )

        if not success:
            return f"❌ 未找到记忆或无权删除：{params.memory_id}"

        return f"✓ 短期记忆已删除 (ID: {params.memory_id})"

    async def get_prompt(self, inject_params: Optional[Dict[str, Any]] = None) -> str:
        """获取记忆工具的提示词注入（注入所有长期记忆 + 工具使用说明）

        Args:
            inject_params: 注入参数字典（如 session_id, user_id 等）

        Returns:
            str: 包含记忆内容和工具用法的提示词
        """
        try:
            # 从注入参数中获取 session_id
            session_id = (
                inject_params.get("session_id", "unknown")
                if inject_params
                else "unknown"
            )

            # 获取所有长期记忆（不限制数量）
            long_term_memories = await self._get_long_term_memories(session_id)

            prompt_parts = []

            # ========== 第一部分：长期记忆注入 ==========
            if long_term_memories:
                prompt_parts.append("【重要记忆】")

                # 按类型分组展示
                factual_memories = [
                    m for m in long_term_memories if m.get("memory_type") == "factual"
                ]
                soul_memories = [
                    m for m in long_term_memories if m.get("memory_type") == "soul"
                ]

                prompt_parts.append("\n### 事实性记忆 (FACTUAL)")
                prompt_parts.append(
                    "这些是核心事实知识库，包括用户偏好、重要决策、项目状态等关键信息："
                )
                if factual_memories:

                    for i, memory in enumerate(factual_memories, 1):
                        prompt_parts.append(f"{i}. {memory.get('content', '')} ")
                else:
                    prompt_parts.append("目前没有事实性记忆")

                prompt_parts.append("\n### 人格定义 (SOUL)")
                prompt_parts.append("这些定义了 AI 的角色定位、语言风格和行为规则：")
                if soul_memories:
                    for i, memory in enumerate(soul_memories, 1):
                        prompt_parts.append(f"{i}. {memory.get('content', '')} ")
                else:
                    prompt_parts.append("目前没有人格定义记忆")
                prompt_parts.append(
                    "\n在与用户对话时，请始终考虑以上记忆内容，确保回应符合已知信息和角色定位。\n"
                )

            # ========== 第二部分：工具使用说明 ==========
            prompt_parts.append("【记忆工具使用说明】")

            tool_instructions = """
你拥有以下记忆管理工具，可以主动调用它们来维护和更新长期记忆：

### 1. 查看长期记忆 (long_term__view)
**用途**: 查看当前已存储的长期记忆

**何时使用**:
- 在对话开始时回顾已有的重要记忆
- 回答用户关于'你还记得什么'的问题
- 确认是否需要更新或补充记忆

**参数**:
- `memory_type`: 必选，'factual'(事实) 或 'soul'(人格定义)

**示例**:
```json
{
  "name": "memory__long_term__view",
  "arguments": {
    "memory_type": "factual"
  }
}
```

### 2. 长期记忆管理 (long_term__edit)
**用途**: 添加或更新重要的长期记忆

**何时使用**:
- 用户明确表达了个人偏好（如'我喜欢喝咖啡'）
- 用户分享了重要事实（如'我在北京工作'）
- 用户做出了关键决策（如'我决定学习 Python'）
- 需要记录用户的价值观或信念

**注意事项**:
- 确保内容简洁明了，分类清晰
- 避免重复信息，只记录最新内容
- 如果冗余内容过多，请精简记忆内容并使用覆盖模式替换

**写入模式**:
- `append`(默认): 追加模式，将新内容添加到现有记忆中，适合累积信息
- `overwrite`: 覆盖模式，完全替换原有记忆，适合修正或更新信息

**参数**:
- `memory_type`: 'factual'(事实) 或 'soul'(人格定义)
- `content`: 要记住的内容（简洁明了）
- `write_mode`: 'append'(追加) 或 'overwrite'(覆盖)，默认 'append'

**示例 1 - 追加模式**:
```json
{
  "name": "memory__long_term__edit",
  "arguments": {
    "memory_type": "factual",
    "content": "用户喜欢喝黑咖啡，不加糖也不加奶",
    "write_mode": "append"
  }
}
```

**示例 2 - 覆盖模式**:
```json
{
  "name": "memory__long_term__edit",
  "arguments": {
    "memory_type": "factual",
    "content": "用户现在住在上海（之前在北京）",
    "write_mode": "overwrite"
  }
}
```
"""
            prompt_parts.append(tool_instructions)

            # ========== 第三部分：使用策略 ==========
            # prompt_parts.append("\n【记忆使用策略】")
            # prompt_parts.append(
            #     "1. **主动记录**: 当用户分享重要信息时，立即使用 `long_term__edit` 记录"
            # )
            # prompt_parts.append(
            #     "2. **定期回顾**: 在对话开始时，搜索相关记忆以提供个性化服务"
            # )
            # prompt_parts.append(
            #     "3. **及时更新**: 当信息变化时，再次调用 `long_term__edit` 更新同类型记忆"
            # )
            # prompt_parts.append("4. **清理维护**: 适时删除过期或无用的短期记忆")
            # prompt_parts.append("5. **重要性评估**:\n")
            # prompt_parts.append("   - 1-3 分：日常对话，无需特别记录")
            # prompt_parts.append("   - 4-6 分：用户偏好和习惯，值得记住")
            # prompt_parts.append("   - 7-10 分：关键信息，必须长期保存\n")

            return "\n".join(prompt_parts)

        except Exception as e:
            logger.error(f"Error getting memory prompt: {e}")
            return ""  # 出错时返回空字符串，不影响对话

    async def _get_long_term_memories(self, session_id: str) -> List[Dict[str, Any]]:
        """获取所有长期记忆（用于提示词注入）

        Args:
            session_id: 会话 ID

        Returns:
            List[Dict[str, Any]]: 长期记忆列表
        """
        try:
            # 使用 Repository 获取所有长期记忆
            from sqlalchemy import select, desc
            from app.models.memory import Memory, MemoryCategory

            stmt = (
                select(Memory)
                .filter(
                    Memory.session_id == session_id,
                    Memory.category == MemoryCategory.LONG_TERM.value,
                )
                .order_by(desc(Memory.importance), desc(Memory.created_at))
            )

            result = await self.session.execute(stmt)
            memories = result.scalars().all()

            return [mem.to_dict() for mem in memories]

        except Exception as e:
            logger.error(f"Error getting long term memories: {e}")
            return []


# ============================================================================
# 向后兼容：保留旧类名（已废弃）
# ============================================================================

# 为了保持向后兼容，将旧的 MemoryToolFamily 指向新的 MemoryToolProvider
MemoryToolFamily = MemoryToolProvider
