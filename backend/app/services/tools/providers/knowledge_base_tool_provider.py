"""
知识库工具提供者实现

提供知识库相关的工具调用功能：
1. 知识库语义搜索接口
2. 知识库文件列表接口
3. 知识库文件分块详情接口

存放在 providers 目录，符合统一架构规范
"""

import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tools.providers.tool_provider_base import (
    IToolProvider,
    ToolCallRequest,
    ToolCallResponse,
)
from app.utils.openai_tool_converter import convert_to_openai_tool

logger = logging.getLogger(__name__)


# ============================================================================
# Pydantic 参数模型（用于自动生成 Schema）
# ============================================================================


class SearchKnowledgeBaseParams(BaseModel):
    """知识库语义搜索参数"""

    knowledge_base_id: str = Field(..., description="目标知识库 ID（必填）")
    query: str = Field(..., description="用户搜索的自然语言文本（必填）")
    file_id: Optional[str] = Field(
        None, description="限制搜索范围的特定文件 ID（可选）"
    )
    top_k: int = Field(..., ge=1, le=20, description="期望返回的最相似分块数量（必填）")


class ListKnowledgeBaseFilesParams(BaseModel):
    """知识库文件列表参数"""

    knowledge_base_id: str = Field(..., description="目标知识库 ID（必填）")


class GetKnowledgeBaseChunksParams(BaseModel):
    """知识库文件分块详情参数"""

    knowledge_base_id: str = Field(..., description="目标知识库 ID（必填）")
    file_id: str = Field(..., description="指定文件 ID（必填）")
    chunk_index: int = Field(..., ge=0, description="起始分块的索引位置（必填）")
    limit: int = Field(
        ..., ge=1, le=10, description="获取的分块数量（必填，最大值为 10）"
    )


class KnowledgeBaseToolProvider(IToolProvider):
    """知识库工具提供者

    工具列表设计:
    - search: 知识库语义搜索
    - list_files: 知识库文件列表
    - get_chunks: 知识库文件分块详情

    Attributes:
        session: 数据库会话
    """

    @property
    def namespace(self) -> str:
        """命名空间：knowledge_base"""
        return "knowledge_base"

    def __init__(self, session: AsyncSession):
        """初始化

        Args:
            session: 数据库会话
        """
        self.session = session
        self._initialized = False
        # 延迟初始化 tools，避免在 __init__ 中引用未定义的方法
        self.tools: List[Dict[str, Any]] = []

    async def _get_tools_internal(
        self, enabled_ids: Optional[List[str] | bool] = None
    ) -> List[Dict[str, Any]]:
        """获取工具列表

        Returns:
            List[Dict[str, Any]]: 工具 schema 列表，每个都是完整的 OpenAI Function Calling 格式
                                  列表中的每个元素包含 tool_name 作为 key
        """
        if not self.tools:
            # 知识库工具组
            kb_tools = [
                convert_to_openai_tool(
                    self._search,
                    name="search",
                    description="在知识库中进行语义搜索，返回最相似的分块内容",
                ),
                convert_to_openai_tool(
                    self._list_files,
                    name="list_files",
                    description="获取知识库下所有已上传文件的元数据列表",
                ),
                convert_to_openai_tool(
                    self._get_chunks,
                    name="get_chunks",
                    description="获取指定文件的特定分块内容（支持分页，最多 10 个分块）",
                ),
            ]
            self.tools = kb_tools

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
        """实际执行知识库工具调用

        Args:
            request: 工具调用请求（名称已去除 knowledge_base__ 前缀）
            inject_params: 注入参数字典（如 user_id 等）

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
            logger.error(f"Knowledge base provider error: {e}")
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
        """执行具体的知识库工具逻辑

        Args:
            tool_name: 工具名称（不含前缀，如 "search", "list_files", "get_chunks"）
            arguments: 参数字典（工具参数，不包含注入参数）
            inject_params: 注入参数字典（如 user_id 等）

        Returns:
            执行结果字符串
        """
        if inject_params is None:
            inject_params = {}

        # 验证 user_id 注入（用于权限验证）
        user_id = inject_params.get("user_id")
        if not user_id:
            return "❌ 错误：缺少 user_id 注入参数"

        # 知识库搜索工具
        if tool_name == "search":
            params = SearchKnowledgeBaseParams(**arguments)
            return await self._search(params, user_id)

        # 知识库文件列表工具
        elif tool_name == "list_files":
            params = ListKnowledgeBaseFilesParams(**arguments)
            return await self._list_files(params, user_id)

        # 知识库文件分块详情工具
        elif tool_name == "get_chunks":
            params = GetKnowledgeBaseChunksParams(**arguments)
            return await self._get_chunks(params, user_id)

        else:
            return f"❌ 未知工具：{tool_name}"

    # ============================================================================
    # 工具方法实现
    # ============================================================================

    async def _search(
        self,
        params: SearchKnowledgeBaseParams,
        user_id: str,
    ) -> str:
        """知识库语义搜索

        Args:
            params: 搜索参数
            user_id: 用户 ID（用于权限验证）

        Returns:
            JSON 格式化的搜索结果
        """
        try:
            from app.repositories.kb_repository import KBRepository
            from app.repositories.model_repository import ModelRepository
            from app.services.vector_service import VectorService
            import json

            # 验证知识库权限（基础验证：确保是用户的知识库）
            kb_repo = KBRepository(self.session)
            kb = await kb_repo.get_kb(params.knowledge_base_id)

            if not kb:
                return json.dumps(
                    {"success": False, "error": "知识库不存在", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            if kb.user_id != user_id:
                return json.dumps(
                    {"success": False, "error": "无权访问该知识库", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            # 初始化向量服务
            vector_service = VectorService()

            # 构建过滤条件
            filter_metadata = None
            if params.file_id:
                filter_metadata = {"file_id": params.file_id}

            # 通过 model_id 查询向量模型配置
            model_repo = ModelRepository(self.session)
            model = await model_repo.get_model(kb.embedding_model_id)

            if not model:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"向量模型不存在：{kb.embedding_model_id}",
                        "data": None,
                    },
                    ensure_ascii=False,
                    indent=2,
                )

            provider_name = model.provider.name
            model_name = model.model_name
            base_url = model.provider.api_url
            api_key = model.provider.api_key
            logger.info(f"使用向量模型：provider={provider_name}, model={model_name}")

            # 执行搜索
            results = await vector_service.search_similar_chunks(
                knowledge_base_id=params.knowledge_base_id,
                query_text=params.query,
                base_url=base_url,  # 修改：传递 base_url
                api_key=api_key,  # 修改：传递 api_key
                model_name=model_name,
                top_k=params.top_k,
                filter_metadata=filter_metadata,
            )

            if not results:
                return json.dumps(
                    {
                        "success": True,
                        "error": None,
                        "data": {
                            "query": params.query,
                            "results": [],
                            "total": 0,
                            "message": "未找到相关结果",
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                )

            # 构建结构化结果
            structured_results = []
            for result in results:
                content = result["content"]
                metadata = result["metadata"]
                similarity = result["similarity"]
                file_id = metadata.get("file_id", "unknown")

                # 获取文件名
                file_name = await self._get_file_name(file_id)

                structured_results.append(
                    {
                        "content": content,
                        "metadata": {**metadata, "file_name": file_name},
                        "similarity": round(similarity, 4),
                    }
                )

            response_data = {
                "success": True,
                "error": None,
                "data": {
                    "query": params.query,
                    "results": structured_results,
                    "total": len(structured_results),
                },
            }

            return json.dumps(response_data, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"Error searching knowledge base: {e}")
            import json

            return json.dumps(
                {"success": False, "error": f"搜索时出错：{str(e)}", "data": None},
                ensure_ascii=False,
                indent=2,
            )

    async def _list_files(
        self,
        params: ListKnowledgeBaseFilesParams,
        user_id: str,
    ) -> str:
        """知识库文件列表

        Args:
            params: 文件列表参数
            user_id: 用户 ID（用于权限验证）

        Returns:
            JSON 格式化的文件列表
        """
        try:
            from app.repositories.kb_repository import KBRepository
            from app.repositories.kb_file_repository import KBFileRepository
            import json

            # 验证知识库权限（基础验证：确保是用户的知识库）
            kb_repo = KBRepository(self.session)
            kb = await kb_repo.get_kb(params.knowledge_base_id)

            if not kb:
                return json.dumps(
                    {"success": False, "error": "知识库不存在", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            if kb.user_id != user_id:
                return json.dumps(
                    {"success": False, "error": "无权访问该知识库", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            # 获取文件列表（只返回已处理完成的文件）
            file_repo = KBFileRepository(self.session)
            completed_files = await file_repo.get_files_by_knowledge_base_and_status(
                knowledge_base_id=params.knowledge_base_id, statuses=["completed"]
            )

            if not completed_files:
                return json.dumps(
                    {
                        "success": True,
                        "error": None,
                        "data": {
                            "files": [],
                            "total": 0,
                            "knowledge_base_id": params.knowledge_base_id,
                            "filter": "completed_only",
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                )

            # 构建结构化文件列表
            structured_files = []
            for file in completed_files:
                structured_files.append(
                    {
                        "id": file.id,
                        "display_name": file.display_name,
                        "file_name": file.file_name,
                        "file_size": file.file_size,
                        "file_size_formatted": self._format_file_size(file.file_size),
                        "file_type": file.file_type,
                        "file_extension": file.file_extension,
                        "processing_status": file.processing_status,
                        "progress_percentage": file.progress_percentage,
                        "current_step": file.current_step,
                        "total_chunks": file.total_chunks or 0,
                        "uploaded_at": (
                            file.uploaded_at.isoformat() if file.uploaded_at else None
                        ),
                        "processed_at": (
                            file.processed_at.isoformat() if file.processed_at else None
                        ),
                    }
                )

            response_data = {
                "success": True,
                "error": None,
                "data": {
                    "files": structured_files,
                    "total": len(structured_files),
                    "knowledge_base_id": params.knowledge_base_id,
                    "filter": "completed_only",
                    "note": "只返回处理完成的文件",
                },
            }

            return json.dumps(response_data, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"Error listing knowledge base files: {e}")
            import json

            return json.dumps(
                {
                    "success": False,
                    "error": f"获取文件列表时出错：{str(e)}",
                    "data": None,
                },
                ensure_ascii=False,
                indent=2,
            )

    async def _get_chunks(
        self,
        params: GetKnowledgeBaseChunksParams,
        user_id: str,
    ) -> str:
        """知识库文件分块详情

        Args:
            params: 分块详情参数
            user_id: 用户 ID（用于权限验证）

        Returns:
            JSON 格式化的分块内容
        """
        try:
            from app.repositories.kb_repository import KBRepository
            from app.repositories.kb_file_repository import KBFileRepository
            from app.repositories.kb_chunk_repository import KBChunkRepository
            import json

            # 验证知识库权限（基础验证：确保是用户的知识库）
            kb_repo = KBRepository(self.session)
            kb = await kb_repo.get_kb(params.knowledge_base_id)

            if not kb:
                return json.dumps(
                    {"success": False, "error": "知识库不存在", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            if kb.user_id != user_id:
                return json.dumps(
                    {"success": False, "error": "无权访问该知识库", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            # 验证文件存在
            file_repo = KBFileRepository(self.session)
            file_record = await file_repo.get_file(params.file_id)

            if not file_record:
                return json.dumps(
                    {"success": False, "error": "文件不存在", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            if file_record.knowledge_base_id != params.knowledge_base_id:
                return json.dumps(
                    {"success": False, "error": "文件不属于该知识库", "data": None},
                    ensure_ascii=False,
                    indent=2,
                )

            # 获取分块列表（分页）
            chunk_repo = KBChunkRepository(self.session)
            chunks = await chunk_repo.list_chunks_by_file(
                file_id=params.file_id,
                skip=params.chunk_index,
                limit=params.limit,
            )

            if not chunks:
                return json.dumps(
                    {
                        "success": True,
                        "error": None,
                        "data": {
                            "chunks": [],
                            "total": 0,
                            "file_id": params.file_id,
                            "chunk_index": params.chunk_index,
                            "limit": params.limit,
                            "message": "未找到分块",
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                )

            # 构建结构化分块数据
            structured_chunks = []
            for chunk in chunks:
                structured_chunks.append(
                    {
                        "id": chunk.id,
                        "chunk_index": chunk.chunk_index,
                        "content": chunk.content,
                        "token_count": chunk.token_count or 0,
                        "vector_id": chunk.vector_id,
                        "embedding_dimensions": chunk.embedding_dimensions,
                        "metadata": chunk.chunk_metadata,
                    }
                )

            response_data = {
                "success": True,
                "error": None,
                "data": {
                    "chunks": structured_chunks,
                    "total": len(structured_chunks),
                    "file_id": params.file_id,
                    "file_name": file_record.display_name,
                    "chunk_index": params.chunk_index,
                    "limit": params.limit,
                    "has_more": len(chunks) == params.limit,  # 是否还有更多分块
                },
            }

            return json.dumps(response_data, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"Error getting knowledge base chunks: {e}")
            import json

            return json.dumps(
                {
                    "success": False,
                    "error": f"获取分块详情时出错：{str(e)}",
                    "data": None,
                },
                ensure_ascii=False,
                indent=2,
            )

    # ============================================================================
    # 辅助方法
    # ============================================================================

    async def _get_file_name(self, file_id: str) -> str:
        """根据文件 ID 获取文件名

        Args:
            file_id: 文件 ID

        Returns:
            文件名，如果不存在则返回 "未知文件"
        """
        try:
            from app.repositories.kb_file_repository import KBFileRepository

            file_repo = KBFileRepository(self.session)
            file_record = await file_repo.get_file(file_id)

            if file_record:
                return file_record.display_name
            return "未知文件"
        except Exception:
            logger.warning(f"无法获取文件名：file_id={file_id}")
            return "未知文件"

    @staticmethod
    def _format_file_size(size_bytes: int) -> str:
        """格式化文件大小

        Args:
            size_bytes: 字节数

        Returns:
            格式化后的大小字符串
        """
        for unit in ["B", "KB", "MB", "GB"]:
            if size_bytes < 1024.0:
                return f"{size_bytes:.2f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.2f} TB"

    async def get_prompt(self, inject_params: Optional[Dict[str, Any]] = None) -> str:
        """获取知识库工具的提示词注入

        Args:
            inject_params: 注入参数字典（如 user_id 等）

        Returns:
            str: 包含工具用法的提示词
        """
        try:
            prompt_parts = []

            prompt_parts.append("【知识库工具使用说明】")

            tool_instructions = """
你拥有以下知识库管理工具，可以主动调用它们来查询和利用知识库内容：

### 1. 知识库语义搜索 (knowledge_base__search)
**用途**: 在知识库中进行向量相似度搜索，找到最相关的内容

**何时使用**:
- 用户询问与知识库相关的问题时
- 需要查找特定主题的资料时
- 想要验证知识库中是否有相关信息时

### 2. 知识库文件列表 (knowledge_base__list_files)
**用途**: 获取知识库下所有已上传文件的元数据列表

**何时使用**:
- 用户想了解知识库里有哪些文件时
- 需要查看文件的处理状态时
- 想要获取文件 ID 以便进一步操作时

### 3. 知识库文件分块详情 (knowledge_base__get_chunks)
**用途**: 获取指定文件的特定分块内容（支持分页）

**何时使用**:
- 用户想查看某个文件的具体内容时
- 需要检查分块质量时
- 想要深入了解文件细节时

**使用建议**:
1. **先搜索再查看**: 先用 `search` 找到相关内容，如有必要再用 `get_chunks` 查看完整分块
2. **注意分页**: 使用 `get_chunks` 时，每次最多获取 10 个分块，可通过调整 `chunk_index` 实现分页
3. **权限验证**: 所有工具都会自动验证用户权限，确保只能访问自己的知识库
4. **错误处理**: 如果返回错误信息，请检查参数是否正确、知识库/文件是否存在
"""
            prompt_parts.append(tool_instructions)

            return "\n".join(prompt_parts)

        except Exception as e:
            logger.error(f"Error getting knowledge base prompt: {e}")
            return ""  # 出错时返回空字符串，不影响对话
