# config.py
import logging
import os
from pathlib import Path
import sys
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置设置"""

    # 基础路径配置
    BASE_DIR: Path = Path(os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

    # 日志和数据目录
    LOG_DIR: Path = Path(os.path.join(BASE_DIR, "logs"))
    DATA_DIR: Path = Path(os.path.join(BASE_DIR, "data"))
    STATIC_FILES_DIR: Path = Path(os.path.join(BASE_DIR, "static"))

    # 数据库配置
    DATABASE_URL: str = "sqlite+aiosqlite:///" + str(DATA_DIR / "app.db")
    TEST_DATABASE_URL: str = "sqlite+aiosqlite:///:memory:"

    # JWT配置
    JWT_SECRET_KEY: str = "your-secret-key-change-this"
    JWT_ACCESS_TOKEN_EXPIRES: int = 3600 * 24 * 7  # 7天

    # 应用配置
    APP_TITLE: str = "Chat API"
    APP_DESCRIPTION: str = "异步聊天API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    TESTING: bool = False

    # 时区配置
    TIMEZONE: str = "Asia/Shanghai"

    # CORS配置
    ALLOWED_ORIGINS: list = ["*"]

    # class Config:
    #     env_file = ".env"  # 从.env文件加载环境变量

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # 确保必要的目录存在
        self.LOG_DIR.mkdir(exist_ok=True)
        self.DATA_DIR.mkdir(exist_ok=True)
        self.STATIC_FILES_DIR.mkdir(exist_ok=True)
        


# 创建全局配置实例
settings = Settings()


def setup_logging():
    """配置日志系统"""
    # logging.basicConfig(
    #     level=logging.DEBUG if settings.DEBUG else logging.INFO,
    #     format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",  # "[in %(lineno)d]"
    #     handlers=[
    #         logging.StreamHandler(sys.stdout),  # 控制台输出
    #         logging.FileHandler(
    #             settings.LOG_DIR / "app.log", encoding="utf-8"
    #         ),  # 文件输出
    #     ],
    # )  
    # 1. 创建 formatter
    formatter = logging.Formatter(
        "%(levelname)s:\t  %(name)s: %(message)s - %(asctime)s"
    )

    # 2. 创建 handlers
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    file_handler = logging.FileHandler(settings.LOG_DIR / "app.log", encoding="utf-8")
    file_handler.setFormatter(formatter)
    # 3. 配置你自己的应用 logger（不是 root！）
    app_logger = logging.getLogger("app")  # ← 关键：命名空间隔离
    app_logger.setLevel(logging.DEBUG if settings.DEBUG else logging.INFO)
    app_logger.propagate = False  # ← 阻止传播到 root，避免重复
    app_logger.addHandler(console_handler)
    app_logger.addHandler(file_handler)



def get_database_url() -> str:
    """获取当前环境的数据库URL"""
    if settings.TESTING:
        return settings.TEST_DATABASE_URL
    return settings.DATABASE_URL


# 初始化日志
setup_logging()
