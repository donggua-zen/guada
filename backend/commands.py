# commands.py - Flask管理命令
import click
from flask.cli import with_appcontext
from app.services.file_cleanup_service import FileCleanupService


@click.group()
def cleanup():
    """文件清理命令"""
    pass


@cleanup.command()
@with_appcontext
@click.option("--dry-run", is_flag=True, help="模拟运行，不实际执行删除")
@click.option("--retention-days", default=7, help="文件保留天数")
def orphaned_files(dry_run, retention_days):
    """清理孤儿文件"""
    service = FileCleanupService(retention_days=retention_days)

    # 显示统计信息
    stats = service.get_cleanup_stats()
    click.echo(f"文件统计:")
    click.echo(f"  总数: {stats['total_files']}")
    click.echo(f"  待清理孤儿文件: {stats['total_orphaned']}")
    click.echo(f"  清理比例: {stats['cleanup_percentage']:.1f}%")

    # 执行清理
    results = service.cleanup_orphaned_files(dry_run=dry_run)

    if dry_run:
        click.echo(f"[DRY RUN] 将删除 {results['total']} 个文件")
    else:
        click.echo(f"已删除 {results['deleted']}/{results['total']} 个文件")
        if results["errors"]:
            click.echo("错误信息:")
            for error in results["errors"]:
                click.echo(f"  - {error}")


# 注册命令
def init_commands(app):
    app.cli.add_command(cleanup)
