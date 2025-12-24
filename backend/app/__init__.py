from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
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
    return app


app = create_app()
