from fastapi import FastAPI, HTTPException
from fastapi.exceptions import FastAPIError, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.database import close_db, init_db
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
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化数据库
    database_url = settings.DATABASE_URL
    await init_db(database_url)
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
    logger.info("路由注册完成")

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
