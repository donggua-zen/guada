"""测试工具命名空间格式"""
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.services.tools.tool_orchestrator import (
    ToolOrchestrator,
    ToolExecutionContext,
    ProviderConfig,
)
from app.services.tools.providers.memory_tool_provider import MemoryToolProvider


@pytest.fixture
async def async_session():
    """创建异步数据库会话"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    
    from app.database import ModelBase as Base
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        yield session
    
    await engine.dispose()


@pytest.fixture
def memory_provider(async_session):
    """创建 MemoryToolProvider"""
    return MemoryToolProvider(async_session)


@pytest.fixture
def orchestrator(memory_provider):
    """创建 ToolOrchestrator 并添加 provider"""
    orch = ToolOrchestrator()
    orch.add_provider(memory_provider)
    return orch


@pytest.mark.asyncio
async def test_tools_have_namespace_prefix(orchestrator):
    """测试 get_all_tools() 返回的工具是否包含命名空间前缀"""
    context = ToolExecutionContext(
        session_id="test_session",
        memory=ProviderConfig(enabled_tools=True),
    )
    
    # 获取所有工具（数组格式）
    tools_array = await orchestrator.get_all_tools(context)
    
    print(f"\n[TEST] 检查工具命名空间:")
    print(f"   - 工具数量：{len(tools_array)}")
    
    # ✅ 验证每个工具都包含命名空间前缀
    for i, tool_schema in enumerate(tools_array):
        function_name = tool_schema["function"]["name"]
        print(f"   - 工具 {i}: {function_name}")
        
        # ✅ 关键验证：工具名应该以命名空间前缀开头
        assert function_name.startswith("memory__"), \
            f"工具名 '{function_name}' 应该以 'memory__' 开头"
    
    # ✅ 验证至少有一个工具
    assert len(tools_array) > 0, "应该至少有一个工具"
    
    print(f"\n[TEST] 所有工具都包含正确的命名空间前缀！")


@pytest.mark.asyncio
async def test_provider_get_tools_namespaced(memory_provider):
    """测试 Provider 的 get_tools_namespaced() 方法是否正确添加命名空间"""
    # 直接调用 Provider 的方法
    tools_dict = await memory_provider.get_tools_namespaced(enabled_ids=True)
    
    print(f"\n[TEST] Provider.get_tools_namespaced():")
    print(f"   - 返回类型：{type(tools_dict)}")
    print(f"   - 工具数量：{len(tools_dict)}")
    
    # ✅ 验证返回的是字典
    assert isinstance(tools_dict, dict)
    
    # ✅ 验证所有键都包含命名空间前缀
    for tool_name, tool_schema in tools_dict.items():
        print(f"   - {tool_name}")
        assert tool_name.startswith("memory__"), \
            f"工具名 '{tool_name}' 应该以 'memory__' 开头"
    
    print(f"\n[TEST] Provider 正确添加了命名空间前缀！")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
