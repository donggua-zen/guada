from fastapi import FastAPI, HTTPException
from fastapi.exceptions import FastAPIError, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import asyncio
from pathlib import Path

from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.database import close_db, init_db, get_db_session
from app.config import settings
from app.routes import (
    chat_router,
    characters_router,
    messages_router,
    sessions_router,
    users_router,
    settings_router,
    files_router,
    models_router,
    mcp_servers_router,
    knowledge_bases_router,
    kb_files_router,
    kb_search_router,
)

logger = logging.getLogger(__name__)


# ✅ 完善：恢复未完成的文件处理任务
async def _resume_pending_file_tasks():
    """
    恢复所有 pending/processing 状态的文件处理任务

    核心设计：
    1. 使用独立的数据库会话（避免与应用其他部分冲突）
    2. 检查文件物理存在性
    3. 使用 asyncio.create_task 重新启动任务
    4. 保持信号量并发控制机制
    """
    try:
        logger.info("🔄 开始扫描未完成的知识库文件任务...")

        # ✅ 关键：创建独立的数据库会话用于恢复任务
        async for session in get_db_session():
            from app.repositories.kb_file_repository import KBFileRepository

            file_repo = KBFileRepository(session)

            # 查询所有未完成任务
            pending_files = await file_repo.get_files_by_status(
                statuses=["pending", "processing"]
            )

            logger.info(f"📋 发现 {len(pending_files)} 个未完成任务")

            if not pending_files:
                logger.info("✅ 没有需要恢复的任务")
                return

            # 统计信息
            resumed_count = 0
            failed_count = 0

            for file_record in pending_files:
                try:
                    # 检查文件是否存在
                    if (
                        not file_record.file_path
                        or not Path(file_record.file_path).exists()
                    ):
                        logger.warning(
                            f"⚠️ 文件不存在，标记为失败：{file_record.display_name} (ID: {file_record.id})"
                        )

                        # 更新状态为 failed
                        await file_repo.update_processing_status(
                            file_id=file_record.id,
                            status="failed",
                            progress=0,
                            current_step="文件丢失",
                            error_message=f"文件物理路径不存在：{file_record.file_path}",
                        )
                        failed_count += 1
                        continue

                    # ✅ 关键：重新启动任务（使用 asyncio.create_task）
                    logger.info(
                        f"🔄 准备恢复任务：{file_record.display_name} (ID: {file_record.id}, 状态：{file_record.processing_status})"
                    )

                    # 注意：这里不等待任务执行，而是让它独立运行
                    asyncio.create_task(
                        _resume_single_file_task(
                            file_id=file_record.id,
                            display_name=file_record.display_name,
                        )
                    )

                    resumed_count += 1

                except Exception as e:
                    logger.exception(
                        f"❌ 恢复任务失败：{file_record.display_name}, error={e}"
                    )
                    failed_count += 1

            logger.info(
                f"✅ 任务恢复完成：成功 {resumed_count} 个，失败 {failed_count} 个"
            )

            break

    except Exception as e:
        logger.exception(f"🚨 扫描未完成任务时发生严重错误：{e}")


async def _resume_single_file_task(
    file_id: str,
    display_name: str,
):
    """
    恢复单个文件处理任务

    Args:
        file_id: 文件 ID
        display_name: 文件显示名称
    """
    try:
        logger.info(f"▶️ 开始恢复任务：{file_id} ({display_name})")

        # ✅ 关键：使用独立的数据库会话（避免与其他操作冲突）
        async for session in get_db_session():
            from app.services.kb_file_service import KBFileService

            # 创建服务实例（会自动获取信号量）
            kb_file_service = KBFileService(session)

            # 执行文件处理（会自动等待信号量）
            await kb_file_service.process_file(file_id=file_id)

            logger.info(f"✅ 任务恢复成功： (ID: {file_id}, 名称: {display_name})")

    except Exception as e:
        logger.exception(
            f"❌ 任务恢复失败：(ID: {file_id}, 名称: {display_name}), error={e}"
        )
        # 注意：错误已经在 KBFileService.process_file 中处理并持久化


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化数据库
    database_url = settings.DATABASE_URL
    await init_db(database_url)

    # ✅ 新增：恢复未完成的文件处理任务
    await _resume_pending_file_tasks()

    logger.info("应用启动完成")
    yield
    logger.info("应用关闭中")
    await close_db()
    # 关闭时清理资源

    logger.info("应用关闭")


def create_app():
    app = FastAPI(
        title=settings.APP_TITLE,
        description=settings.APP_DESCRIPTION,
        version=settings.APP_VERSION,
        lifespan=lifespan,
    )

    # 中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由
    app.include_router(chat_router, tags=["chat"])
    app.include_router(messages_router, tags=["messages"])
    app.include_router(sessions_router, tags=["sessions"])
    app.include_router(users_router, tags=["users"])
    app.include_router(characters_router, tags=["characters"])
    app.include_router(settings_router, tags=["settings"])
    app.include_router(files_router, tags=["files"])
    app.include_router(models_router, tags=["models"])
    app.include_router(mcp_servers_router, tags=["mcp_servers"])
    # 知识库相关路由
    app.include_router(knowledge_bases_router)
    app.include_router(kb_files_router)
    app.include_router(kb_search_router)
    logger.info(
        "路由注册完成 - %s",
        __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )

    app.mount(
        "/static", StaticFiles(directory=settings.STATIC_FILES_DIR), name="static"
    )

    # 全局异常处理器：捕获所有未处理的 Exception
    async def global_exception_handler(request, exc: Exception):
        # 让 HTTP 相关异常继续抛出，由默认处理器处理
        if isinstance(exc, (HTTPException, RequestValidationError, FastAPIError)):
            raise  # 或者 return 默认响应

        # 处理真正的“意外”异常
        # 记录日志（生产环境非常重要）
        logging.error(f"Unhandled exception: {exc}", exc_info=True)

        # 返回统一错误格式
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal Server Error", "error": str(exc)},
        )

    app.add_exception_handler(Exception, global_exception_handler)

    return app


app = create_app()
