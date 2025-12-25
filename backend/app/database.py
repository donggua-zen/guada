import contextlib
import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from app.utils import to_utc8_isoformat

logger = logging.getLogger(__name__)


class ModelBase(DeclarativeBase):
    """异步模型基类"""

    __abstract__ = True

    def to_dict(self, exclude=None):
        """将模型转换为字典（同步方法，注意：不能在异步上下文中访问关系）"""
        if exclude is None:
            exclude = []

        result = {}
        for column in self.__table__.columns:
            if column.name not in exclude:
                if column.name in ["created_at", "updated_at"]:
                    value = getattr(self, column.name)
                    if value is None:
                        continue
                    result[column.name] = to_utc8_isoformat(value)
                else:
                    result[column.name] = getattr(self, column.name)
        return result

    async def to_dict_async(self, exclude=None, include=None):
        """异步版本的to_dict，支持关系加载"""
        if exclude is None:
            exclude = []
        if include is None:
            include = []

        result = self.to_dict(exclude=exclude)

        # 异步处理包含的关系字段
        for rel_name in include:
            if hasattr(self, rel_name) and rel_name not in exclude:
                rel_value = getattr(self, rel_name)

                if rel_value is None:
                    result[rel_name] = None
                elif isinstance(rel_value, list):
                    # 处理一对多关系
                    result[rel_name] = []
                    for item in rel_value:
                        if hasattr(item, "to_dict_async"):
                            result[rel_name].append(await item.to_dict_async())
                        else:
                            result[rel_name].append(str(item))
                elif hasattr(rel_value, "to_dict_async"):
                    # 处理多对一关系
                    result[rel_name] = await rel_value.to_dict_async()
                else:
                    result[rel_name] = str(rel_value)
        return result

    def update(self, data: dict, exclude=[], exclude_none=False):
        """从字典更新，可选排除 None 值"""
        for key, value in data.items():
            if exclude_none and value is None:
                continue
            if key not in exclude:
                if hasattr(self, key):
                    setattr(self, key, value)
        return self


class DatabaseManager:
    """异步数据库管理器"""

    def __init__(self, database_url: str):

        if database_url.startswith("sqlite"):
            self.engine = create_async_engine(
                database_url,
                echo=False,
                pool_pre_ping=True,
                connect_args={
                    "check_same_thread": False,
                    "timeout": 30,
                },
                # poolclass=AsyncAdaptedQueuePool,
            )

            # 关键：注册连接事件，启用外键
            @event.listens_for(self.engine.sync_engine, "connect")
            def set_sqlite_pragma(dbapi_connection, connection_record):
                dbapi_connection.execute("PRAGMA foreign_keys=ON")

        else:
            self.engine = create_async_engine(
                database_url,
                echo=False,
                pool_pre_ping=True,
                pool_recycle=3600,
                # 注意：asyncmy / aiomysql 不支持 init_command
            )
        self.async_session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """获取数据库会话"""
        async with self.async_session_factory() as session:
            try:
                yield session
            except Exception as e:
                await session.rollback()
                raise e
            finally:
                await session.close()

    async def create_tables(self):
        """创建所有表"""
        async with self.engine.begin() as conn:
            await conn.run_sync(ModelBase.metadata.create_all)
        logger.debug("数据库表创建成功")

    async def health_check(self):
        """数据库健康检查"""
        try:
            async with self.engine.begin() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception as e:
            logger.error(f"数据库健康检查失败: {e}")
            return False

    async def close(self):
        """关闭引擎"""
        if self.engine:
            await self.engine.dispose()
            self.engine = None
            logger.info("数据库引擎已关闭")


# 全局数据库管理器实例
db_manager = None


async def init_db(database_url: str = None):
    """初始化数据库，如果未提供URL则使用配置中的默认值"""
    # from app.config import settings
    from app.config import settings

    global db_manager
    if database_url is None:
        database_url = settings.DATABASE_URL
    db_manager = DatabaseManager(database_url)
    # await db_manager.create_tables()
    return db_manager


async def close_db():
    """关闭数据库"""
    if db_manager is not None:
        await db_manager.close()
    else:
        logger.warning("No database manager instance found.")


def get_db_manager() -> DatabaseManager:
    """获取数据库管理器实例"""
    global db_manager
    if db_manager is None:
        raise RuntimeError("数据库未初始化，请先调用 init_db")
    return db_manager


@contextlib.asynccontextmanager
async def transaction(session: AsyncSession):
    try:
        async with session.begin():
            yield
    except Exception as e:
        await session.rollback()
        raise


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """获取数据库会话的依赖项"""
    if db_manager is None:
        raise RuntimeError("数据库未初始化，请先调用 init_db")

    async for session in db_manager.get_session():
        async with session.begin():
            yield session
