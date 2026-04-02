"""
知识库管理 API 路由

提供知识库的 CRUD 操作接口
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.dependencies import get_current_user
from app.models.user import User
from app.services.kb_file_service import KBFileService
from app.schemas.knowledge_base import (
    KnowledgeBaseCreate,
    KnowledgeBaseUpdate,
    KnowledgeBaseResponse,
    KnowledgeBaseListResponse,
    MessageResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/knowledge-bases", tags=["Knowledge Base"])


@router.post("", response_model=KnowledgeBaseResponse, status_code=201)
async def create_knowledge_base(
    kb_data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    创建知识库
    
    - **name**: 知识库名称
    - **embedding_model_id**: 向量模型 ID（关联 model 表）
    - **chunk_max_size**: 最大分块大小（字符数）
    - **chunk_overlap_size**: 分块重叠大小（字符数）
    - **chunk_min_size**: 最小分块大小（字符数）
    """
    from app.repositories.kb_repository import KBRepository
    
    try:
        kb_repo = KBRepository(session)
        
        # 创建知识库
        kb = await kb_repo.create_kb(
            name=kb_data.name,
            user_id=current_user.id,
            embedding_model_id=kb_data.embedding_model_id,
            description=kb_data.description,
            chunk_max_size=kb_data.chunk_max_size,
            chunk_overlap_size=kb_data.chunk_overlap_size,
            chunk_min_size=kb_data.chunk_min_size,
            is_public=kb_data.is_public,
            metadata_config=kb_data.metadata_config,
        )
        
        logger.info(f"创建知识库成功：{kb.id}, user={current_user.id}")
        return kb
        
    except Exception as e:
        logger.exception(f"创建知识库失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=KnowledgeBaseListResponse)
async def list_knowledge_bases(
    skip: int = Query(0, ge=0, description="跳过数量"),
    limit: int = Query(20, ge=1, le=100, description="返回数量限制"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """列出当前用户的所有知识库"""
    from app.repositories.kb_repository import KBRepository
    
    try:
        kb_repo = KBRepository(session)
        
        # 获取列表和总数
        kbs = await kb_repo.list_kbs(current_user.id, skip=skip, limit=limit)
        total = await kb_repo.count_kbs(current_user.id)
        
        return KnowledgeBaseListResponse(
            items=kbs,
            total=total,
            skip=skip,
            limit=limit,
        )
        
    except Exception as e:
        logger.exception(f"获取知识库列表失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}", response_model=KnowledgeBaseResponse)
async def get_knowledge_base(
    kb_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """获取知识库详情"""
    from app.repositories.kb_repository import KBRepository
    
    try:
        kb_repo = KBRepository(session)
        
        # 获取知识库
        kb = await kb_repo.get_kb(kb_id)
        
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        
        # 验证权限
        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")
        
        return kb
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"获取知识库失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{kb_id}", response_model=KnowledgeBaseResponse)
async def update_knowledge_base(
    kb_id: str,
    kb_data: KnowledgeBaseUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """更新知识库"""
    from app.repositories.kb_repository import KBRepository
    
    try:
        kb_repo = KBRepository(session)
        
        # 获取知识库
        kb = await kb_repo.get_kb(kb_id)
        
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        
        # 验证权限
        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")
        
        # 更新知识库
        update_data = kb_data.model_dump(exclude_unset=True)
        updated_kb = await kb_repo.update_kb(kb_id, update_data)
        
        logger.info(f"更新知识库成功：{kb_id}")
        return updated_kb
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"更新知识库失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{kb_id}", response_model=MessageResponse)
async def delete_knowledge_base(
    kb_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """删除知识库（软删除）"""
    from app.repositories.kb_repository import KBRepository
    from app.services.vector_service import VectorService
    
    try:
        kb_repo = KBRepository(session)
        
        # 获取知识库
        kb = await kb_repo.get_kb(kb_id)
        
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        
        # 验证权限
        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")
        
        # 删除向量集合
        vector_service = VectorService()
        await vector_service.delete_collection(kb_id)
        
        # 软删除知识库
        success = await kb_repo.delete_kb(kb_id)
        
        if success:
            logger.info(f"删除知识库成功：{kb_id}")
            return MessageResponse(message="知识库已删除", success=True)
        else:
            raise HTTPException(status_code=500, detail="删除失败")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"删除知识库失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))
