import datetime
import os
from datetime import datetime, timedelta
from sqlalchemy import and_
from app.repositories.file_repository import FileRepository
from app.models import File


class FileCleanupService:
    def __init__(self, file_repo: FileRepository, retention_days=7):
        self.file_repo = file_repo
        self.retention_days = retention_days  # 文件保留天数

    async def find_orphaned_files(self):
        """查找孤儿文件（外键为空且超过保留时间的文件）"""
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - timedelta(
            days=self.retention_days
        )

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
            print(f"[DRY RUN] 将清理 {len(orphaned_files)} 个孤儿文件")
            return results

        for file in orphaned_files:
            try:
                # 1. 删除磁盘文件
                await self._delete_disk_file(file)

                # 2. 删除数据库记录
                await self.file_repo.delete_file(file.id)

                results["deleted"] += 1

            except Exception as e:
                error_msg = f"删除文件 {file.id} 失败: {str(e)}"
                results["errors"].append(error_msg)
                # 记录日志但继续处理其他文件
                print(error_msg)

        return results

    async def _delete_disk_file(self, file):
        """删除磁盘文件"""
        if file.url and file.url.startswith("static/"):
            file_path = self._url_to_file_path(file.url)
            if os.path.exists(file_path):
                os.remove(file_path)

        if file.preview_url and file.preview_url.startswith("static/"):
            preview_path = self._url_to_file_path(file.preview_url)
            if os.path.exists(preview_path):
                os.remove(preview_path)

    def _url_to_file_path(self, url):
        """URL转文件路径，并进行路径规范化以提高安全性"""
        # 假设使用FastAPI，这里需要调整
        from config import STATIC_FILES_DIR

        full_path = os.path.join(str(STATIC_FILES_DIR), url)
        return os.path.normpath(full_path)

    async def get_cleanup_stats(self):
        """获取清理统计信息"""
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - timedelta(
            days=self.retention_days
        )

        # 各类文件统计
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
