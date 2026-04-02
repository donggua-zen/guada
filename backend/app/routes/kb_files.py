"""
知识库文件管理 API 路由

提供文件上传、处理、查询和删除接口
"""

import logging
import asyncio
import aiofiles
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Body
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.knowledge_base import (
    KBFileUploadResponse,
    KBFileResponse,
    KBFileListResponse,
    FileProcessingStatusResponse,
    MessageResponse,
)
from app.utils import upload_paths
from app.services.kb_file_service import KBFileService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/knowledge-bases/{kb_id}/files", tags=["Knowledge Base Files"]
)


@router.post("/upload", response_model=KBFileUploadResponse)
async def upload_file_to_kb(
    kb_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    上传文件到知识库

    - **file**: 要上传的文件（支持 txt, md, pdf, docx, code files 等）

    文件上传后会立即返回，后台异步处理：
    1. 文件解析
    2. 文本分块
    3. 向量化
    4. 存储到 ChromaDB 和数据库

    可通过 `/status` 接口查询处理进度
    """
    from app.repositories.kb_repository import KBRepository
    import uuid

    try:
        # 验证知识库存在且有权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 生成唯一文件名
        file_extension = Path(file.filename).suffix.lower()
        unique_filename = f"{uuid.uuid4().hex}{file_extension}"

        # 保存文件到临时目录
        file_path = upload_paths.build_knowledge_base_save_path(unique_filename)

        if not file_path.parent.exists():
            file_path.parent.mkdir(exist_ok=True, parents=True)

        # 异步保存文件
        async with aiofiles.open(file_path, "wb+") as out_file:
            content = await file.read()
            await out_file.write(content)

        file_size = len(content)

        # 检测文件类型
        file_type_map = {
            ".txt": "text",
            ".md": "text",
            ".markdown": "text",
            ".pdf": "pdf",
            ".docx": "word",
            ".py": "code",
            ".js": "code",
            ".ts": "code",
            ".java": "code",
            ".cpp": "code",
            ".c": "code",
        }
        file_type = file_type_map.get(file_extension, "text")

        # 计算文件哈希
        import hashlib

        content_hash = hashlib.md5(content).hexdigest()

        # ✅ 先创建文件记录到数据库（基础信息），包含文件路径
        from app.repositories.kb_file_repository import KBFileRepository

        file_repo = KBFileRepository(session)

        file_record = await file_repo.create_file(
            knowledge_base_id=kb_id,
            file_name=unique_filename,
            display_name=file.filename,
            file_size=file_size,
            file_type=file_type,
            file_extension=file_extension.lstrip("."),
            content_hash=content_hash,
        )

        # ✅ 新增：保存文件路径到数据库（用于服务重启后恢复）
        file_record.file_path = str(file_path.absolute())
        await session.commit()
        await session.refresh(file_record)  # 刷新获取最新数据

        logger.info(
            f"文件记录已创建：{file.filename}, KB={kb_id}, File ID={file_record.id}"
        )

        # ✅ 关键修复：使用 asyncio.create_task 启动真正的后台任务
        # 不再使用 BackgroundTasks（那是请求级别的，不会执行）
        asyncio.create_task(
            _process_file_in_background(
                file_id=file_record.id,  # ✅ 简化：只传文件 ID
            )
        )

        logger.info(
            f"文件上传成功：{file.filename}, KB={kb_id}, File ID={file_record.id}"
        )

        # 返回上传响应
        return file_record

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"上传文件失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


# ✅ 新增：后台文件处理函数（独立于请求）
async def _process_file_in_background(
    file_id: str,
):
    """
    后台异步处理文件（真正的后台任务，独立于请求）

    即使前端断开连接，该任务也会继续执行
    """
    try:
        async for session in get_db_session():
            kb_file_service = KBFileService(session)
            await kb_file_service.process_file(file_id=file_id)
            break
    except Exception as e:
        logger.exception(f"后台任务执行失败：file_id={file_id}, error={e}")


@router.get("", response_model=KBFileListResponse)
async def list_kb_files(
    kb_id: str,
    skip: int = Query(0, ge=0, description="跳过数量"),
    limit: int = Query(50, ge=1, le=100, description="返回数量限制"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """列出知识库中的所有文件"""
    from app.repositories.kb_repository import KBRepository
    from app.repositories.kb_file_repository import KBFileRepository

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 获取文件列表
        file_repo = KBFileRepository(session)
        files = await file_repo.list_files(kb_id, skip=skip, limit=limit)
        total = await file_repo.count_files(kb_id)

        return KBFileListResponse(
            items=files,
            total=total,
            skip=skip,
            limit=limit,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"获取文件列表失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}", response_model=KBFileResponse)
async def get_kb_file(
    kb_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """获取文件详情"""
    from app.repositories.kb_repository import KBRepository
    from app.repositories.kb_file_repository import KBFileRepository

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 获取文件
        file_repo = KBFileRepository(session)
        file_record = await file_repo.get_file(file_id)

        if not file_record:
            raise HTTPException(status_code=404, detail="文件不存在")

        return file_record

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"获取文件详情失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}/status", response_model=FileProcessingStatusResponse)
async def get_file_processing_status(
    kb_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    查询文件处理进度（HTTP 轮询）

    前端应每秒调用一次此接口，直到状态变为 completed 或 failed
    """
    from app.repositories.kb_repository import KBRepository
    from app.repositories.kb_file_repository import KBFileRepository
    from app.services.kb_file_service import KBFileService

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 获取文件处理状态
        file_repo = KBFileRepository(session)
        file_record = await file_repo.get_file(file_id)

        if not file_record:
            raise HTTPException(status_code=404, detail="文件不存在")

        return FileProcessingStatusResponse(
            id=file_record.id,
            file_name=file_record.display_name,
            processing_status=file_record.processing_status,
            progress_percentage=file_record.progress_percentage,
            current_step=file_record.current_step,
            error_message=file_record.error_message,
            total_chunks=file_record.total_chunks,
            uploaded_at=(
                file_record.uploaded_at.isoformat() if file_record.uploaded_at else None
            ),
            processed_at=(
                file_record.processed_at.isoformat()
                if file_record.processed_at
                else None
            ),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"查询文件状态失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


# ✅ 新增：批量查询文件处理状态接口
@router.post("/status/batch", response_model=List[FileProcessingStatusResponse])
async def batch_get_file_processing_status(
    kb_id: str,
    file_ids: List[str] = Body(..., embed=True, description="文件 ID 列表"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    批量查询文件处理状态（推荐用于多文件轮询场景）

    一次性返回多个文件的处理状态，减少 HTTP 请求次数

    - **file_ids**: 要查询的文件 ID 列表
    """
    from app.repositories.kb_repository import KBRepository
    from app.repositories.kb_file_repository import KBFileRepository

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 批量获取文件记录
        file_repo = KBFileRepository(session)
        file_records = await file_repo.get_files_by_ids(file_ids)

        # 转换为响应格式
        responses = [
            FileProcessingStatusResponse.model_validate(file_record)
            for file_record in file_records
        ]

        return responses

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"批量查询文件状态失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{file_id}", response_model=MessageResponse)
async def delete_kb_file(
    kb_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """删除文件及其所有分块"""
    from app.repositories.kb_repository import KBRepository
    from app.services.kb_file_service import KBFileService

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 删除文件
        kb_file_service = KBFileService(session)
        success = await kb_file_service.delete_file_and_chunks(file_id)

        if success:
            logger.info(f"删除文件成功：{file_id}")
            return MessageResponse(message="文件已删除", success=True)
        else:
            raise HTTPException(status_code=500, detail="删除失败")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"删除文件失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{file_id}/retry", response_model=MessageResponse)
async def retry_file_processing(
    kb_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """
    重新处理文件（用于失败或已完成的文件）
    
    会重新启动后台处理任务，包括：
    1. 文件解析
    2. 文本分块
    3. 向量化
    4. 存储到 ChromaDB 和数据库
    """
    from app.repositories.kb_repository import KBRepository
    from app.repositories.kb_file_repository import KBFileRepository
    from app.services.kb_file_service import KBFileService
    import asyncio

    try:
        # 验证知识库权限
        kb_repo = KBRepository(session)
        kb = await kb_repo.get_kb(kb_id)

        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        if kb.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该知识库")

        # 获取文件记录
        file_repo = KBFileRepository(session)
        file_record = await file_repo.get_file(file_id)

        if not file_record:
            raise HTTPException(status_code=404, detail="文件不存在")

        # 检查文件状态，只允许 failed 或 completed 状态的文件重新处理
        if file_record.processing_status not in ["failed", "completed"]:
            raise HTTPException(
                status_code=400,
                detail=f"当前状态不允许重新处理（当前状态：{file_record.processing_status}）"
            )

        # 重置文件状态为 pending
        await file_repo.update_processing_status(
            file_id=file_id,
            status="pending",
            progress=0,
            current_step="等待重新处理...",
            error_message=None,
        )
        await session.commit()

        # 启动后台处理任务
        asyncio.create_task(
            _process_file_in_background(
                file_id=file_id,
            )
        )

        logger.info(f"重新开始处理文件：{file_record.display_name}, KB={kb_id}")
        return MessageResponse(message="文件已开始重新处理", success=True)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"重新处理文件失败：{e}")
        raise HTTPException(status_code=500, detail=str(e))
