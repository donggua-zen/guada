# app/tests/conftest.py
"""
全局测试配置和共享 fixtures

提供：
1. 数据库会话管理（内存 SQLite）
2. Mock 用户和认证
3. FastAPI 测试客户端
4. 工厂类（用户、角色、会话、工具）
"""
import asyncio
from typing import AsyncGenerator, Optional, Dict, Any
from datetime import datetime, timezone
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
    """自定义事件循环（用于 pytest-asyncio）"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def test_engine():
    """
    内存 SQLite 引擎，启用外键约束
    
    使用静态连接池确保所有测试共享同一个数据库实例
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    # 创建所有表
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.run_sync(ModelBase.metadata.create_all)
    
    yield engine
    await engine.dispose()


@pytest.fixture()
async def test_db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """
    每个测试使用独立的事务，自动回滚
    
    确保测试之间的隔离性，避免数据污染
    """
    connection = await test_engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(bind=connection, expire_on_commit=False)
    
    yield session
    
    # 清理：回滚事务，关闭连接
    await session.close()
    await transaction.rollback()
    await connection.close()


@pytest.fixture()
async def app(test_db_session) -> AsyncGenerator:
    """
    使用真实 create_app，并 override 依赖
    
    提供：
    - Mock 数据库会话
    - Mock 当前用户
    """
    app_instance = create_app()

    # Override 数据库会话依赖
    async def override_get_db_session():
        yield test_db_session

    # 创建 Mock 用户
    mock_user = User(
        id="test-user-ulid-000000000000",
        email="test@example.com",
        nickname="tester",
        role="primary",
        password_hash=hash_password("test-password"),
    )

    test_db_session.add(mock_user)
    await test_db_session.commit()

    # Override 当前用户依赖
    async def override_get_current_user():
        return mock_user

    app_instance.dependency_overrides[get_db_session] = override_get_db_session
    app_instance.dependency_overrides[get_current_user] = override_get_current_user

    yield app_instance

    app_instance.dependency_overrides.clear()


@pytest.fixture()
async def client(app) -> AsyncGenerator[httpx.AsyncClient, None]:
    """
    Async HTTP client for testing FastAPI app
    
    用于发送 HTTP 请求到测试服务器
    """
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ———————— 工厂类 Fixtures ————————


@pytest.fixture
def user_factory(test_db_session):
    """
    用户工厂：创建测试用户
    
    用法:
        user = await user_factory.create(
            email="custom@example.com",
            nickname="Custom User"
        )
    """
    class UserFactory:
        async def create(
            self,
            email: str = "user@example.com",
            nickname: str = "Test User",
            role: str = "primary",
            user_id: Optional[str] = None
        ) -> User:
            user = User(
                id=user_id or f"user-{email.split('@')[0]}",
                email=email,
                nickname=nickname,
                role=role,
                password_hash=hash_password("password"),
            )
            test_db_session.add(user)
            await test_db_session.commit()
            await test_db_session.refresh(user)
            return user
    
    return UserFactory()


@pytest.fixture
def character_factory(test_db_session):
    """
    角色工厂：创建测试角色
    
    用法:
        character = await character_factory.create(
            title="My Character",
            model_id=model.id
        )
    """
    from app.models.character import Character
    
    class CharacterFactory:
        async def create(
            self,
            title: str = "Test Character",
            description: str = "A test character",
            model_id: str = "default-model-id",
            is_public: bool = False,
            settings: Optional[Dict[str, Any]] = None,
            character_id: Optional[str] = None
        ) -> Character:
            character = Character(
                id=character_id or f"char-{title.lower().replace(' ', '-')}",
                title=title,
                description=description,
                model_id=model_id,
                is_public=is_public,
                settings=settings or {},
            )
            test_db_session.add(character)
            await test_db_session.commit()
            await test_db_session.refresh(character)
            return character
    
    return CharacterFactory()


@pytest.fixture
def session_factory(test_db_session):
    """
    会话工厂：创建测试会话
    
    用法:
        session = await session_factory.create(
            title="My Session",
            model_id=model.id,
            character_id=character.id
        )
    """
    from app.models.session import Session
    
    class SessionFactory:
        async def create(
            self,
            title: str = "Test Session",
            user_id: str = "test-user-ulid-000000000000",
            model_id: str = "default-model-id",
            character_id: Optional[str] = None,
            settings: Optional[Dict[str, Any]] = None,
            session_id: Optional[str] = None
        ) -> Session:
            session = Session(
                id=session_id or f"sess-{title.lower().replace(' ', '-')}",
                title=title,
                user_id=user_id,
                model_id=model_id,
                character_id=character_id,
                settings=settings or {},
            )
            test_db_session.add(session)
            await test_db_session.commit()
            await test_db_session.refresh(session)
            return session
    
    return SessionFactory()


@pytest.fixture
def tool_provider_factory():
    """
    工具提供者工厂：创建测试工具提供者
    
    用法:
        provider = tool_provider_factory.create_local()
        provider.register(name="test_tool", func=lambda: "ok", schema={})
    """
    from app.services.tools.providers.local_tool_provider import LocalToolProvider
    
    class ToolProviderFactory:
        def create_local(self) -> LocalToolProvider:
            """创建本地工具提供者"""
            return LocalToolProvider()
        
        def register_simple_tool(
            self,
            provider: LocalToolProvider,
            name: str,
            func,
            schema: Optional[Dict[str, Any]] = None
        ):
            """快速注册简单工具"""
            provider.register(
                name=name,
                func=func,
                schema=schema or {"type": "object", "properties": {}}
            )
            return provider
    
    return ToolProviderFactory()


# ———————— Mock 工具 ————————


@pytest.fixture
def mock_llm_response():
    """
    Mock LLM 响应
    
    用法:
        mock_llm_response.set_text("Hello!")
        mock_llm_response.set_tool_call("get_time", {})
    """
    class MockLLMResponse:
        def __init__(self):
            self.response_type = "text"
            self.content = "Default response"
            self.tool_calls = []
        
        def set_text(self, content: str):
            """设置文本响应"""
            self.response_type = "text"
            self.content = content
            return self
        
        def set_tool_call(self, name: str, arguments: Dict[str, Any], tool_id: str = "call-1"):
            """设置工具调用响应"""
            self.response_type = "tool_call"
            self.tool_calls = [{
                "id": tool_id,
                "name": name,
                "arguments": arguments
            }]
            return self
        
        def to_dict(self) -> Dict[str, Any]:
            """转换为字典格式"""
            if self.response_type == "text":
                return {"content": self.content}
            else:
                return {"tool_calls": self.tool_calls}
    
    return MockLLMResponse()
