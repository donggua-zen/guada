#!/usr/bin/env python3
"""
文件管理命令行工具
使用 Typer 构建的命令行界面，用于管理文件、清理孤儿文件等
"""

import asyncio
import typer
from pathlib import Path
import sys

from app.utils import convert_webpath_to_filepath

# 添加当前目录到 Python 路径，以便导入 app 模块
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

from app.database import init_db, close_db
from app.repositories.file_repository import FileRepository
from app.services.file_cleanup_service import FileCleanupService
from app.config import settings

# 创建 Typer 应用
app = typer.Typer(
    name="文件管理命令行工具",
    help="用于管理文件、清理孤儿文件等操作",
    add_completion=False,
)


class DatabaseManager:
    """数据库管理器包装类"""

    def __init__(self):
        self._db_manager = None
        self._session = None

    async def initialize(self):
        """初始化数据库连接"""
        if self._db_manager is None:
            self._db_manager = await init_db(settings.DATABASE_URL)

    async def get_session(self):
        """获取数据库会话"""
        """ ** 记得commit() ** """

        if self._db_manager is None:
            await self.initialize()

        if self._session is None:
            self._session = self._db_manager.async_session_factory()

        return self._session

    async def close(self):
        """关闭连接"""
        if self._session:
            await self._session.close()
            self._session = None
        await close_db()

    async def health_check(self):
        """健康检查"""
        if self._db_manager is None:
            await self.initialize()
        return await self._db_manager.health_check()


# 创建全局数据库管理器实例
db_manager = DatabaseManager()


async def run_async_command(async_func):
    """运行异步命令的包装器"""
    try:
        await db_manager.initialize()
        result = await async_func()
        return result
    except Exception as e:
        typer.echo(f"❌ 命令执行错误: {str(e)}", err=True)
        raise
    finally:
        await db_manager.close()


@app.command()
def cleanup_orphaned(
    retention_days: int = typer.Option(
        7, "--retention-days", "-d", help="保留天数，早于此天数的文件将被清理"
    ),
    dry_run: bool = typer.Option(
        True, "--dry-run/--force", help="干跑模式（只显示将要清理的文件，不实际删除）"
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出模式"),
):
    """
    清理孤儿文件（没有关联会话或消息的文件）
    """

    async def _cleanup():
        session = await db_manager.get_session()
        file_repo = FileRepository(session)
        cleanup_service = FileCleanupService(file_repo, retention_days)

        # 获取统计信息
        if verbose:
            stats = await cleanup_service.get_cleanup_stats()
            typer.echo("📊 清理统计信息:")
            typer.echo(f"   总文件数: {stats['total_files']}")
            typer.echo(f"   孤儿文件数: {stats['total_orphaned']}")
            typer.echo(f"   有会话无消息: {stats['orphaned_by_message']}")
            typer.echo(f"   有消息无会话: {stats['orphaned_by_session']}")
            typer.echo(f"   清理比例: {stats['cleanup_percentage']:.2f}%")
            typer.echo("-" * 50)

        # 查找孤儿文件
        orphaned_files = await cleanup_service.find_orphaned_files()

        if not orphaned_files:
            typer.echo("✅ 没有找到需要清理的孤儿文件")
            return

        if dry_run:
            typer.echo(f"🔍 [干跑模式] 找到 {len(orphaned_files)} 个孤儿文件:")
            for file in orphaned_files:
                typer.echo(f"   📄 {file.file_name} (创建于: {file.created_at})")
                typer.echo(f"      文件大小: {file.file_size} 字节")
                typer.echo(f"      文件路径: {convert_webpath_to_filepath(file.url)}")
            typer.echo(f"💡 使用 --force 参数实际执行清理")
        else:
            typer.echo(f"🗑️ 开始清理 {len(orphaned_files)} 个孤儿文件...")
            result = await cleanup_service.cleanup_orphaned_files(dry_run=False)
            typer.echo("✅ 清理完成:")
            typer.echo(f"   总共处理: {result['total']} 个文件")
            typer.echo(f"   成功删除: {result['deleted']} 个文件")
            typer.echo(f"   错误数量: {len(result['errors'])}")

            if result["errors"] and verbose:
                typer.echo("❌ 错误详情:")
                for error in result["errors"]:
                    typer.echo(f"   {error}")

    asyncio.run(run_async_command(_cleanup))


@app.command()
def stats():
    """
    显示文件统计信息
    """

    async def _stats():
        session = await db_manager.get_session()
        file_repo = FileRepository(session)
        cleanup_service = FileCleanupService(file_repo)

        stats = await cleanup_service.get_cleanup_stats()

        typer.echo("📊 文件存储统计信息")
        typer.echo("=" * 50)
        typer.echo(
            f"📁 总文件数: {typer.style(str(stats['total_files']), fg=typer.colors.BLUE)}"
        )
        typer.echo(
            f"👻 孤儿文件数: {typer.style(str(stats['total_orphaned']), fg=typer.colors.YELLOW)}"
        )
        typer.echo(
            f"📊 清理比例: {typer.style(f'{stats["cleanup_percentage"]:.2f}%', fg=typer.colors.CYAN)}"
        )
        typer.echo("-" * 30)
        typer.echo("📋 详细分类:")
        typer.echo(f"   💬 有会话但无消息: {stats['orphaned_by_message']}")
        typer.echo(f"   💭 有消息但无会话: {stats['orphaned_by_session']}")

        # 根据清理比例给出建议
        if stats["total_orphaned"] > 0:
            cleanup_pct = stats["cleanup_percentage"]
            if cleanup_pct > 10:
                typer.echo(
                    f"💡 建议: {typer.style('立即清理', fg=typer.colors.RED)} (孤儿文件比例较高)"
                )
            elif cleanup_pct > 5:
                typer.echo(
                    f"💡 建议: {typer.style('建议清理', fg=typer.colors.YELLOW)}"
                )
            else:
                typer.echo(f"💡 建议: {typer.style('状态良好', fg=typer.colors.GREEN)}")

    asyncio.run(run_async_command(_stats))


@app.command()
def list_orphaned(
    retention_days: int = typer.Option(7, "--retention-days", "-d", help="保留天数"),
    limit: int = typer.Option(50, "--limit", "-l", help="显示数量限制"),
):
    """
    列出所有孤儿文件
    """

    async def _list_orphaned():
        session = await db_manager.get_session()
        file_repo = FileRepository(session)
        cleanup_service = FileCleanupService(file_repo, retention_days)

        orphaned_files = await cleanup_service.find_orphaned_files()

        if not orphaned_files:
            typer.echo("✅ 没有找到孤儿文件")
            return

        typer.echo(f"📋 找到 {len(orphaned_files)} 个孤儿文件:")
        typer.echo("=" * 80)

        for i, file in enumerate(orphaned_files[:limit], 1):
            typer.echo(f"{i:2d}. 📄 {file.file_name}")
            typer.echo(f"     显示名称: {file.display_name}")
            typer.echo(f"     文件类型: {file.file_type}")
            typer.echo(f"     文件大小: {file.file_size} 字节")
            typer.echo(f"     创建时间: {file.created_at}")
            if file.url:
                typer.echo(f"     文件URL: {file.url}")
            typer.echo("-" * 40)

        if len(orphaned_files) > limit:
            typer.echo(f"... 还有 {len(orphaned_files) - limit} 个文件未显示")

    asyncio.run(run_async_command(_list_orphaned))


@app.command()
def health_check():
    """
    检查数据库和文件系统健康状态
    """

    async def _health_check():
        # 检查数据库连接
        is_db_healthy = await db_manager.health_check()
        if is_db_healthy:
            typer.echo("✅ 数据库连接正常")
        else:
            typer.echo("❌ 数据库连接异常")
            return

        # 检查文件仓库
        session = await db_manager.get_session()
        file_repo = FileRepository(session)
        total_files = await file_repo.count_all_files()
        typer.echo(f"✅ 文件仓库正常，总文件数: {total_files}")

        # 检查静态文件目录
        static_dir = Path(settings.STATIC_FILES_DIR)
        if static_dir.exists():
            typer.echo(f"✅ 静态文件目录存在: {static_dir}")
        else:
            typer.echo(f"⚠️ 静态文件目录不存在: {static_dir}")

    asyncio.run(run_async_command(_health_check))


@app.command()
def version():
    """
    显示应用版本信息
    """
    typer.echo(f"📦 应用名称: {settings.APP_TITLE}")
    typer.echo(f"📄 版本: {settings.APP_VERSION}")
    typer.echo(f"📋 描述: {settings.APP_DESCRIPTION}")
    typer.echo(f"🏠 静态文件目录: {settings.STATIC_FILES_DIR}")


@app.callback()
def callback():
    """
    文件管理系统命令行工具
    """
    pass


if __name__ == "__main__":
    app()
