import datetime
import os
from datetime import timedelta
from sqlalchemy import and_
from app.models import File
from app.models.database import db


class FileCleanupService:
    def __init__(self, retention_days=7):
        self.retention_days = retention_days  # 文件保留天数

    def find_orphaned_files(self):
        """查找孤儿文件（外键为空且超过保留时间的文件）"""
        cutoff_time = datetime.now(datetime.timezone.utc) - timedelta(
            days=self.retention_days
        )

        orphaned_files = File.query.filter(
            and_(
                File.message_id.is_(None),  # message_id为空
                File.session_id.is_(None),  # session_id也为空
                File.created_at < cutoff_time,  # 创建时间早于 cutoff_time
            )
        ).all()

        return orphaned_files

    def cleanup_orphaned_files(self, dry_run=False):
        """清理孤儿文件"""
        orphaned_files = self.find_orphaned_files()
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
                self._delete_disk_file(file)

                # 2. 删除数据库记录
                db.session.delete(file)

                results["deleted"] += 1

            except Exception as e:
                error_msg = f"删除文件 {file.id} 失败: {str(e)}"
                results["errors"].append(error_msg)
                # 记录日志但继续处理其他文件
                print(error_msg)

        if not dry_run:
            db.session.commit()

        return results

    def _delete_disk_file(self, file):
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
        """URL转文件路径"""
        from flask import current_app

        return os.path.join(current_app.root_path, url)

    def get_cleanup_stats(self):
        """获取清理统计信息"""
        cutoff_time = datetime.utcnow() - timedelta(days=self.retention_days)

        # 各类文件统计
        stats = {
            "total_orphaned": File.query.filter(
                and_(
                    File.message_id.is_(None),
                    File.session_id.is_(None),
                    File.created_at < cutoff_time,
                )
            ).count(),
            "orphaned_by_message": File.query.filter(
                and_(
                    File.message_id.is_(None),
                    File.session_id.is_not(None),  # 还有session关联
                    File.created_at < cutoff_time,
                )
            ).count(),
            "orphaned_by_session": File.query.filter(
                and_(
                    File.message_id.is_not(None),  # 还有message关联
                    File.session_id.is_(None),
                    File.created_at < cutoff_time,
                )
            ).count(),
            "total_files": File.query.count(),
        }

        stats["cleanup_percentage"] = (
            (stats["total_orphaned"] / stats["total_files"] * 100)
            if stats["total_files"] > 0
            else 0
        )

        return stats
