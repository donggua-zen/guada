"""测试工具格式转换"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.services.tools.tool_orchestrator import (
    ToolOrchestrator,
    ToolExecutionContext,
    ProviderConfig,
)
from app.services.tools.providers.memory_tool_provider import MemoryToolProvider


# ========== Fixtures ==========

@pytest.fixture
async def async_session():
    """创建异步数据库会话（使用内存 SQLite）"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    
    # 创建所有表
    from app.database import ModelBase as Base
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        yield session
    
    await engine.dispose()


@pytest.fixture
def mock_memory_provider(async_session):
    """模拟 MemoryToolProvider"""
    provider = MemoryToolProvider(async_session)
    return provider


@pytest.fixture
def orchestrator(mock_memory_provider):
    """创建 ToolOrchestrator 实例"""
    orch = ToolOrchestrator()
    orch.add_provider(mock_memory_provider)
    return orch


# ========== 测试工具格式 ==========

@pytest.mark.asyncio
async def test_get_all_tools_return_format(orchestrator):
    """测试 get_all_tools() 返回的格式是否符合 OpenAI API 要求"""
    context = ToolExecutionContext(
        session_id="test_session",
        memory=ProviderConfig(enabled_tools=True),
    )
    
    # 获取工具（直接返回数组）
    all_tools_array = await orchestrator.get_all_tools(context)
    
    # ✅ 验证返回类型
    assert isinstance(all_tools_array, list), "get_all_tools() 应该返回数组"
    
    # ✅ 验证数组中的每个工具 schema
    for i, tool_schema in enumerate(all_tools_array):
        assert isinstance(tool_schema, dict), f"tools[{i}] 应该是对象"
        
        # ✅ 验证 OpenAI Function Calling 格式
        assert "type" in tool_schema, f"tools[{i}] 缺少 type 字段"
        assert tool_schema["type"] == "function", f"tools[{i}] 的 type 应该是 'function'"
        
        assert "function" in tool_schema, f"tools[{i}] 缺少 function 字段"
        function = tool_schema["function"]
        
        assert "name" in function, f"tools[{i}] 缺少 function.name"
        assert "description" in function, f"tools[{i}] 缺少 function.description"
        assert "parameters" in function, f"tools[{i}] 缺少 function.parameters"
    
    print(f"\n[TEST] get_all_tools() 返回格式正确:")
    print(f"   - 返回类型：list")
    print(f"   - 工具数量：{len(all_tools_array)}")
    if all_tools_array:
        print(f"   - 示例工具：{all_tools_array[0]}")


@pytest.mark.asyncio
async def test_tools_format_for_openai_api(orchestrator):
    """测试工具格式是否符合 OpenAI API 的要求（已经是数组，无需转换）"""
    context = ToolExecutionContext(
        session_id="test_session",
        memory=ProviderConfig(enabled_tools=True),
    )
    
    # 获取工具（直接返回数组）
    tools_array = await orchestrator.get_all_tools(context)
    
    # ✅ 验证已经是数组格式（无需转换）
    assert isinstance(tools_array, list), "tools 应该是数组"
    assert len(tools_array) > 0, "tools 数组不应该为空"
    
    # ✅ 验证每个元素的格式
    for i, tool in enumerate(tools_array):
        assert isinstance(tool, dict), f"tools[{i}] 应该是对象"
        assert "type" in tool, f"tools[{i}] 缺少 type 字段"
        assert tool["type"] == "function", f"tools[{i}] 的 type 应该是 'function'"
        assert "function" in tool, f"tools[{i}] 缺少 function 字段"
        
        function = tool["function"]
        assert "name" in function, f"tools[{i}] 缺少 function.name"
        assert "description" in function, f"tools[{i}] 缺少 function.description"
        assert "parameters" in function, f"tools[{i}] 缺少 function.parameters"
    
    print(f"\n[TEST] 转换后的 tools 数组格式正确:")
    print(f"   - 数组长度：{len(tools_array)}")
    print(f"   - 第一个元素：{tools_array[0]}")


@pytest.mark.asyncio
async def test_tools_format_direct_call(orchestrator, mock_memory_provider):
    """测试直接调用 Provider 的工具格式"""
    # 直接从 Provider 获取工具
    tools = await mock_memory_provider.get_tools_namespaced(enabled_ids=True)
    
    # ✅ 验证格式
    assert isinstance(tools, dict)
    
    for tool_name, tool_schema in tools.items():
        # ✅ 验证外层结构
        assert tool_schema == {
            "type": "function",
            "function": tool_schema["function"]
        }
        
        # ✅ 验证 function 内部结构
        function = tool_schema["function"]
        assert isinstance(function, dict)
        assert "name" in function
        assert "description" in function
        assert "parameters" in function
        
        # ✅ 验证 parameters 结构
        params = function["parameters"]
        assert params["type"] == "object"
        assert "properties" in params
    
    print(f"\n[TEST] Provider 直接返回的工具格式正确:")
    print(f"   - 工具数量：{len(tools)}")
    if tools:
        sample = list(tools.values())[0]
        print(f"   - 示例：{sample}")


@pytest.mark.asyncio
async def test_empty_tools_format(orchestrator):
    """测试空工具列表的格式"""
    # 不启用任何工具
    context = ToolExecutionContext(
        session_id="test_session",
        memory=ProviderConfig(enabled_tools=False),  # 禁用所有工具
    )
    
    tools_array = await orchestrator.get_all_tools(context)
    
    # ✅ 验证空数组
    assert isinstance(tools_array, list)
    assert len(tools_array) == 0
    
    print(f"\n[TEST] 空工具列表格式正确")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
