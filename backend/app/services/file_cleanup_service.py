from datetime import datetime, timezone, timedelta
import logging
import os
from app.models.file import File
from app.repositories.file_repository import FileRepository
from app.utils import convert_webpath_to_filepath

logger = logging.getLogger(__name__)


class FileCleanupService:
    def __init__(self, file_repo: FileRepository, retention_days=7):
        self.file_repo = file_repo
        self.retention_days = retention_days

    async def find_orphaned_files(self):
        """查找孤儿文件（外键为空且超过保留时间的文件）"""
        # 修正：使用正确的datetime导入
        cutoff_time = datetime.now(timezone.utc) - timedelta(days=self.retention_days)

        orphaned_files = await self.file_repo.find_orphaned_files(cutoff_time)
        return orphaned_files

    async def cleanup_orphaned_files(self, dry_run=False):
        """清理孤儿文件"""
        orphaned_files = await self.find_orphaned_files()
        results = {
            "total": len(orphaned_files),
            "deleted": 0,
            "errors": [],
            "dry_run": dry_run,
        }

        if dry_run:
            # print(f"[DRY RUN] 将清理 {len(orphaned_files)} 个孤儿文件")
            return results

        for file in orphaned_files:
            try:
                # 删除磁盘文件
                await self._delete_disk_file(file)

                # 删除数据库记录
                await self.file_repo.delete_file(file.id)

                results["deleted"] += 1

            except Exception as e:
                error_msg = f"删除文件 {file.id} 失败: {str(e)}"
                results["errors"].append(error_msg)
                # 记录日志但继续处理其他文件
                logger.error(error_msg)

        return results

    async def _delete_disk_file(self, file: File):
        """删除磁盘文件"""
        file_path = self._url_to_file_path(file.url)
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        else:
            logger.warning(f"文件 {file_path} 不存在")

        preview_path = self._url_to_file_path(file.preview_url)
        if os.path.exists(preview_path):
            os.remove(preview_path)

    def _url_to_file_path(self, url):
        try:
            return convert_webpath_to_filepath(url)
        except Exception as e:
            logger.error(f"[ERROR] 获取文件路径失败: {str(e)}")
            return None

    async def get_cleanup_stats(self):
        """获取清理统计信息"""
        cutoff_time = datetime.now(timezone.utc) - timedelta(days=self.retention_days)

        stats = {
            "total_orphaned": await self.file_repo.count_orphaned_files(cutoff_time),
            "orphaned_by_message": await self.file_repo.count_files_with_session_no_message(
                cutoff_time
            ),
            "orphaned_by_session": await self.file_repo.count_files_with_message_no_session(
                cutoff_time
            ),
            "total_files": await self.file_repo.count_all_files(),
        }

        stats["cleanup_percentage"] = (
            (stats["total_orphaned"] / stats["total_files"] * 100)
            if stats["total_files"] > 0
            else 0
        )

        return stats
