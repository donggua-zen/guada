# config.py
import logging
import os
from pathlib import Path
import sqlite3
import sys
from sqlalchemy import event
from sqlalchemy.engine import Engine

basedir = os.path.abspath(os.path.dirname(__file__))


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


# 创建日志目录
LOG_DIR = Path(os.path.join(basedir, "logs"))
LOG_DIR.mkdir(exist_ok=True)

DATA_DIR = Path(os.path.join(basedir, "data"))
DATA_DIR.mkdir(exist_ok=True)

print(f"{DATA_DIR}")

def setup_logging():
    """配置日志系统"""
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s" "[in %(lineno)d]",
        handlers=[
            logging.StreamHandler(sys.stdout),  # 控制台输出
            logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8"),  # 文件输出
        ],
    )


class Config:
    """基础配置"""

    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-secret-key"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "connect_args": {
            "check_same_thread": False,
            "timeout": 30,  # SQLite 超时设置
            # "foreign_keys": 1,  # 启用外键
        },
        # "poolclass": StaticPool,  # 单线程应用使用静态连接池
        "pool_pre_ping": True,  # 连接前检查
    }

    JWT_SECRET_KEY = "your-secret-key-change-this"
    JWT_ACCESS_TOKEN_EXPIRES = 3600 * 24 * 7  # 7天

    # 其他通用配置
    DEBUG = False
    TESTING = False
    # SQLite 特定的性能优化
    SQLITE_JOURNAL_MODE = "WAL"  # 写前日志模式，提高并发
    SQLITE_SYNCHRONOUS = "NORMAL"  # 同步模式平衡性能和安全
    # 设置应用时区
    TIMEZONE = "Asia/Shanghai"


class DevelopmentConfig(Config):
    """开发环境配置"""

    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.environ.get("DEV_DATABASE_URL") or "sqlite:///" + str(
        DATA_DIR / "app.db"
    )

    # 开发环境特定配置
    SQLALCHEMY_ECHO = True  # 输出SQL语句


class TestingConfig(Config):
    """测试环境配置"""

    TESTING = True
    SQLALCHEMY_DATABASE_URI = (
        os.environ.get("TEST_DATABASE_URL") or "sqlite:///:memory:"
    )  # 内存数据库，测试后自动清理

    # 测试环境特定配置
    WTF_CSRF_ENABLED = False  # 测试时禁用CSRF


class ProductionConfig(Config):
    """生产环境配置"""

    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL") or "sqlite:///" + str(
        DATA_DIR / "app.db"
    )

    # 生产环境特定配置
    if os.environ.get("SECRET_KEY"):
        SECRET_KEY = os.environ.get("SECRET_KEY")


setup_logging()

# 配置映射
app_config = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
}
