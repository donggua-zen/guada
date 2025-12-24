from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, and_, or_
from app.models.file import File as FileModel


class FileRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化FileRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def add_file(
        self,
        file_name: str,
        display_name: str,
        file_ext: str,
        file_type: str,
        file_size: int,
        file_content: str,
        session_id: str,
        message_id: str,
        content_hash: str,
        url: str = None,
        preview_url: str = None,
    ):
        """
        添加文件到数据库

        :param file_name: 文件名
        :param display_name: 文件显示名称
        :param file_extension: 文件扩展名
        :param file_type: 文件类型(text, image, video, audio, file)
        :param file_size: 文件大小
        :param file_content: 文件内容
        :param session_id: 会话ID
        :param message_id: 消息ID
        :return: 文件信息
        """
        filemodel = FileModel(
            content=file_content,
            file_name=file_name,
            file_extension=file_ext,
            display_name=display_name,
            file_type=file_type,
            file_size=file_size,
            session_id=session_id,
            message_id=message_id,
            content_hash=content_hash,
            url=url,
            preview_url=preview_url,
        )
        self.session.add(filemodel)
        await self.session.flush()
        return await self.get_file(filemodel.id)

    async def delete_file(self, file_id: int):
        """
        直接通过ID删除文件记录（不加载到会话中）
        :param file_id: 文件ID
        :return: 被删除的行数
        """
        stmt = delete(FileModel).where(FileModel.id == file_id)
        result = await self.session.execute(stmt)
        return result.rowcount

    async def update_files(self, file_ids: list[str], data: dict):
        stmt = update(FileModel).where(FileModel.id.in_(file_ids)).values(**data)
        result = await self.session.execute(stmt)
        return result.rowcount

    async def delete_not_related_files(self, session_id: str):
        """
        批量删除指定会话中未关联消息的文件（直接删除，不加载实体）
        :param session_id: 会话ID
        :return: 被删除的文件数量
        """
        stmt = delete(FileModel).where(
            FileModel.session_id == session_id,
            FileModel.message_id.is_(None)
        )
        result = await self.session.execute(stmt)
        return result.rowcount

    async def get_file(self, file_id: int):
        """获取单个文件"""
        stmt = select(FileModel).where(FileModel.id == file_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def find_orphaned_files(self, cutoff_time):
        """查找孤儿文件（外键为空且超过保留时间的文件）"""
        stmt = select(FileModel).where(
            and_(
                FileModel.message_id.is_(None),  # message_id为空
                FileModel.session_id.is_(None),  # session_id也为空
                FileModel.created_at < cutoff_time,  # 创建时间早于 cutoff_time
            )
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def count_orphaned_files(self, cutoff_time):
        """统计孤儿文件数量"""
        from sqlalchemy import func
        stmt = select(func.count(FileModel.id)).where(
            and_(
                FileModel.message_id.is_(None),
                FileModel.session_id.is_(None),
                FileModel.created_at < cutoff_time,
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar()

    async def count_files_with_session_no_message(self, cutoff_time):
        """统计有session关联但没有message关联的文件数量"""
        from sqlalchemy import func
        stmt = select(func.count(FileModel.id)).where(
            and_(
                FileModel.message_id.is_(None),
                FileModel.session_id.is_not(None),  # 还有session关联
                FileModel.created_at < cutoff_time,
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar()

    async def count_files_with_message_no_session(self, cutoff_time):
        """统计有message关联但没有session关联的文件数量"""
        from sqlalchemy import func
        stmt = select(func.count(FileModel.id)).where(
            and_(
                FileModel.message_id.is_not(None),  # 还有message关联
                FileModel.session_id.is_(None),
                FileModel.created_at < cutoff_time,
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar()

    async def count_all_files(self):
        """统计所有文件数量"""
        from sqlalchemy import func
        stmt = select(func.count(FileModel.id))
        result = await self.session.execute(stmt)
        return result.scalar()