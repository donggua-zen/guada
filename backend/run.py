import logging
import os

from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles

load_dotenv()  # 默认会从当前目录加载 .env 文件

from app.config import settings
from app.database import close_db, init_db
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

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)

logger.debug("当前脚本路径:%s", current_script_path)
logger.debug("当前脚本目录:%s", current_directory)


# if __name__ == "__main__":
#     app.run(host="0.0.0.0", port=5000, debug=True)


# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
from app.database import init_db, db_manager
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
app.mount("/static", StaticFiles(directory=settings.STATIC_FILES_DIR), name="static")


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
