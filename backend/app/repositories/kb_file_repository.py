"""
知识库文件仓库 - 负责知识库文件的数据库操作
"""

from typing import List, Optional
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.kb_file import KBFile


class KBFileRepository:
    """知识库文件仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_file(
        self,
        knowledge_base_id: str,
        file_name: str,
        display_name: str,
        file_size: int,
        file_type: str,
        file_extension: str,
        content_hash: str,
        content: Optional[str] = None,
    ) -> KBFile:
        """创建文件记录

        Args:
            knowledge_base_id: 知识库 ID
            file_name: 原始文件名
            display_name: 显示名称
            file_size: 文件大小（字节）
            file_type: 文件类型
            file_extension: 文件扩展名
            content_hash: 文件内容哈希
            content: 文件内容

        Returns:
            KBFile: 创建的文件对象
        """
        kb_file = KBFile(
            knowledge_base_id=knowledge_base_id,
            file_name=file_name,
            display_name=display_name,
            file_size=file_size,
            file_type=file_type,
            file_extension=file_extension,
            content_hash=content_hash,
            content=content,
        )
        self.session.add(kb_file)
        await self.session.flush()
        return kb_file

    async def get_file(self, file_id: str) -> Optional[KBFile]:
        """获取文件

        Args:
            file_id: 文件 ID

        Returns:
            Optional[KBFile]: 文件对象，不存在返回 None
        """
        stmt = select(KBFile).where(KBFile.id == file_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_files(
        self,
        knowledge_base_id: str,
        skip: int = 0,
        limit: int = 50,
    ) -> List[KBFile]:
        """列出知识库中的文件

        Args:
            knowledge_base_id: 知识库 ID
            skip: 跳过数量
            limit: 返回数量限制

        Returns:
            List[KBFile]: 文件列表
        """
        stmt = select(KBFile).where(
            KBFile.knowledge_base_id == knowledge_base_id
        ).order_by(KBFile.uploaded_at.desc()).offset(skip).limit(limit)
        
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def update_processing_status(
        self,
        file_id: str,
        status: str,
        progress: int,
        current_step: Optional[str] = None,
        error_message: Optional[str] = None,
        total_chunks: Optional[int] = None,
        total_tokens: Optional[int] = None,
    ):
        """更新文件处理状态

        Args:
            file_id: 文件 ID
            status: 处理状态
            progress: 进度百分比
            current_step: 当前步骤描述
            error_message: 错误信息
            total_chunks: 总分块数
            total_tokens: 总 token 数
        """
        data = {
            "processing_status": status,
            "progress_percentage": progress,
        }
        
        if current_step is not None:
            data["current_step"] = current_step
        if error_message is not None:
            data["error_message"] = error_message
        if total_chunks is not None:
            data["total_chunks"] = total_chunks
        if total_tokens is not None:
            data["total_tokens"] = total_tokens
        
        # 如果状态为 completed，设置 processed_at
        if status == "completed":
            from sqlalchemy import func
            data["processed_at"] = func.now()
        
        stmt = update(KBFile).where(KBFile.id == file_id).values(**data)
        await self.session.execute(stmt)

    async def delete_file(self, file_id: str) -> bool:
        """删除文件

        Args:
            file_id: 文件 ID

        Returns:
            bool: 是否成功删除
        """
        stmt = update(KBFile).where(KBFile.id == file_id).values(
            processing_status="deleted"
        )
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def count_files(self, knowledge_base_id: str) -> int:
        """统计文件数量

        Args:
            knowledge_base_id: 知识库 ID

        Returns:
            int: 文件数量
        """
        from sqlalchemy import func
        stmt = select(func.count(KBFile.id)).where(
            KBFile.knowledge_base_id == knowledge_base_id
        )
        result = await self.session.execute(stmt)
        return result.scalar() or 0
    
    # ✅ 新增：根据状态查询文件（用于服务重启后恢复）
    async def get_files_by_status(self, statuses: List[str]) -> List[KBFile]:
        """根据处理状态查询文件
        
        Args:
            statuses: 状态列表，如 ["pending", "processing"]
        
        Returns:
            List[KBFile]: 文件列表
        """
        stmt = select(KBFile).where(KBFile.processing_status.in_(statuses))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
    
    # ✅ 新增：根据内容哈希查询文件（用于去重检测）
    async def get_file_by_hash(
        self,
        knowledge_base_id: str,
        content_hash: str,
    ) -> Optional[KBFile]:
        """根据内容哈希查询文件（用于去重检测）
        
        Args:
            knowledge_base_id: 知识库 ID
            content_hash: 文件内容哈希
        
        Returns:
            Optional[KBFile]: 文件对象，不存在返回 None
        """
        stmt = select(KBFile).where(
            KBFile.knowledge_base_id == knowledge_base_id,
            KBFile.content_hash == content_hash,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
