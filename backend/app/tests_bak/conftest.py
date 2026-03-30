# app/tests/conftest.py
import asyncio
from typing import AsyncGenerator

import pytest
import httpx
from httpx import ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.pool import StaticPool
from sqlalchemy import text

from app.database import ModelBase
from app.dependencies import get_current_user, get_db_session
from app.models.user import User
from app import create_app
from app.security import hash_password


# ———————— 通用 Fixtures ————————


@pytest.fixture(scope="session")
def event_loop():
    """自定义事件循环（可选，有时需要）"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def test_engine():
    """内存 SQLite 引擎，启用外键"""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.run_sync(ModelBase.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture()
async def test_db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """每个测试使用独立事务（自动回滚）"""
    connection = await test_engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(bind=connection, expire_on_commit=False)
    yield session
    await session.close()
    await transaction.rollback()
    await connection.close()


@pytest.fixture()
async def app(test_db_session):
    """使用真实 create_app，并 override 依赖"""
    app_instance = create_app()

    async def override_get_db_session():
        yield test_db_session

    mock_user = User(
        id="test-user-ulid-000000000000",
        email="test@example.com",
        nickname="tester",
        role="primary",
        password_hash=hash_password("test-password"),
    )

    test_db_session.add(mock_user)
    await test_db_session.commit()

    async def override_get_current_user():
        return mock_user

    app_instance.dependency_overrides[get_db_session] = override_get_db_session
    app_instance.dependency_overrides[get_current_user] = override_get_current_user

    yield app_instance

    app_instance.dependency_overrides.clear()


@pytest.fixture()
async def client(app) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Async HTTP client for testing FastAPI app"""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
