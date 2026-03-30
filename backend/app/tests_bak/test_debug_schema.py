"""调试工具 schema 格式"""
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.services.tools.providers.memory_tool_provider import MemoryToolProvider


@pytest.fixture
async def async_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    from app.database import ModelBase as Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_schema_function_name(async_session):
    """测试 schema 中 function.name 是否包含命名空间"""
    provider = MemoryToolProvider(async_session)
    
    # 获取带命名空间的工具
    tools_dict = await provider.get_tools_namespaced(enabled_ids=True)
    
    print(f"\n[DEBUG] 检查工具 schema:")
    for dict_key, schema in tools_dict.items():
        function_name = schema["function"]["name"]
        print(f"   字典键名：{dict_key}")
        print(f"   function.name: {function_name}")
        print(f"   是否一致：{dict_key == function_name}")
        print()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
