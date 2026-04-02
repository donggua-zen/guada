"""
知识库后台任务处理

使用 FastAPI BackgroundTasks 实现异步文件处理
确保后台任务持久化，不依赖前端连接
"""

import logging
from pathlib import Path
from typing import Optional
from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.services.kb_file_service import KBFileService

logger = logging.getLogger(__name__)


class KBBackgroundTasks:
    """知识库后台任务管理器"""

    async def process_file_task(
        file_id: str,
    ):
        """
        文件处理任务（实际执行函数）
    
        该函数会在后台异步执行，即使前端断开连接也会继续运行
        """
        logger.info(f"后台任务开始处理文件：ID={file_id}")
    
        try:
            # 创建新的数据库会话（后台任务独立于请求会话）
            async for session in get_db_session_context():
                # 创建文件服务实例
                kb_file_service = KBFileService(session)
    
                # 处理文件
                result_file_id = await kb_file_service.process_file(file_id=file_id)
    
                logger.info(f"后台任务完成：文件 ID={result_file_id}")
                break

        except Exception as e:
            logger.exception(f"后台任务执行失败：{e}")
            # 注意：错误已经在 KBFileService.process_file 中处理并更新到数据库
