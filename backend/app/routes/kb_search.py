"""
知识库搜索 API 路由

提供基于向量相似度的语义搜索功能
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.knowledge_base import (
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    SearchChunkResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/knowledge-bases/{kb_id}/search", tags=["Knowledge Base Search"]
)


@router.post("", response_model=KnowledgeSearchResponse)
async def search_knowledge_base(
    kb_id: str,
    search_request: KnowledgeSearchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    在知识库中搜索相似内容（支持混合搜索）

    - **query**: 查询文本
    - **top_k**: 返回结果数量（1-20）
    - **filter_file_id**: 可选，按文件 ID 过滤
    - **use_hybrid_search**: 是否使用混合搜索（默认 True）
    - **semantic_weight**: 语义权重（0.0-1.0，默认 0.6）
    - **keyword_weight**: 关键词权重（0.0-1.0，默认 0.4）

    使用向量相似度搜索，支持语义匹配和关键词混合搜索
    """
    from app.repositories.kb_repository import KBRepository
    from app.repositories.kb_file_repository import KBFileRepository
    from app.services.vector_service import VectorService

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 初始化向量服务
        vector_service = VectorService()

        # 构建过滤条件
        filter_metadata = None
        if search_request.filter_file_id:
            filter_metadata = {"file_id": search_request.filter_file_id}

        # 通过 model_id 查询向量模型配置
        from app.repositories.model_repository import ModelRepository

        model_repo = ModelRepository(session)
        model = await model_repo.get_model(kb.embedding_model_id)

        if not model:
            raise HTTPException(
                status_code=400, detail=f"向量模型不存在：{kb.embedding_model_id}"
            )

        provider_name = model.provider.name
        model_name = model.model_name
        logger.info(f"使用向量模型：provider={provider_name}, model={model_name}")

        # 执行混合搜索
        results = await vector_service.search_similar_chunks_hybrid(
            knowledge_base_id=kb_id,
            query_text=search_request.query,
            base_url=model.provider.api_url or "",
            api_key=model.provider.api_key or "",
            model_name=model_name,
            top_k=search_request.top_k,
            filter_metadata=filter_metadata,
            use_hybrid=search_request.use_hybrid_search,
            semantic_weight=search_request.semantic_weight,
            keyword_weight=search_request.keyword_weight,
        )

        

        # 格式化结果
        formatted_results = []
        for result in results:
            chunk_response = SearchChunkResponse(
                content=result["content"],
                metadata=result["metadata"],
                similarity=result.get("similarity", 0.0),  # 兼容旧版
                file_name=result["metadata"].get("file_name"),
                # 混合搜索分数字段（如果存在）
                semantic_score=result.get("semantic_score"),
                keyword_score=result.get("keyword_score"),
                final_score=result.get("final_score"),
            )
            formatted_results.append(chunk_response)

        search_mode = "混合搜索" if search_request.use_hybrid_search else "纯语义搜索"
        logger.info(
            f"{search_mode}完成：query='{search_request.query}', results={len(formatted_results)}"
        )

        return KnowledgeSearchResponse(
            query=search_request.query,
            results=formatted_results,
            total=len(formatted_results),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"搜索失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/test")
async def test_search(
    kb_id: str,
    query: str = Query(..., description="测试查询文本"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    测试搜索功能（简化版）

    用于快速测试知识库的搜索效果
    """
    from app.repositories.kb_repository import KBRepository
    from app.services.vector_service import VectorService

    try:
        # 验证知识库
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问")

        # 通过 model_id 查询向量模型配置
        from app.repositories.model_repository import ModelRepository

        model_repo = ModelRepository(session)
        model = await model_repo.get_model(kb.embedding_model_id)

        if not model:
            raise HTTPException(
                status_code=400, detail=f"向量模型不存在：{kb.embedding_model_id}"
            )

        provider_name = model.provider.name
        model_name = model.model_name

        # 执行搜索
        vector_service = VectorService()
        results = await vector_service.search_similar_chunks(
            knowledge_base_id=kb_id,
            query_text=query,
            provider_name=provider_name,
            model_name=model_name,
            top_k=5,
        )

        return {
            "query": query,
            "results_count": len(results),
            "results": results,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"测试搜索失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))
