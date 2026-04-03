from logging.config import fileConfig
import re

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from app.config import settings
from app.database import ModelBase

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.


# === 关键：将异步 URL 转为同步 URL ===
def make_sync_url(async_url: str) -> str:
    """
    将异步数据库 URL 转换为同步版本：
    - sqlite+aiosqlite:// → sqlite://
    - postgresql+asyncpg:// → postgresql://
    - mysql+aiomysql:// → mysql://
    """
    sync_url = re.sub(r"^sqlite\+aiosqlite", "sqlite", async_url)
    sync_url = re.sub(r"^postgresql\+asyncpg", "postgresql", sync_url)
    sync_url = re.sub(r"^mysql\+aiomysql", "mysql", sync_url)
    # 可继续添加其他 async driver...
    return sync_url


config = context.config
# 关键：转义所有 % 为 %%
escaped_sync_url = settings.DATABASE_URL.replace("%", "%%")
config.set_main_option("sqlalchemy.url", make_sync_url(escaped_sync_url))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = ModelBase.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
