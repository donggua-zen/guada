"""
验证工具族架构改进方案

测试两个关键改进：
1. 命名空间自动化
2. 参数自动注入
"""

import sys
import asyncio
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))


async def test_improvement_1_namespace_automation():
    """测试改进 1：命名空间自动化"""
    print("\n" + "="*60)
    print("🧪 测试改进 1：命名空间自动化")
    print("="*60)
    
    # 导入 Provider
    from app.services.tools.providers.memory_tool_provider import MemoryToolProvider
    from app.services.tools.providers.mcp_tool_provider import MCPToolProvider
    from app.services.tools.providers.local_tool_provider import LocalToolProvider
    
    # 测试 MemoryToolProvider
    memory_provider = MemoryToolProvider(None)  # type: ignore
    print(f"\n✅ MemoryToolProvider.namespace = '{memory_provider.namespace}'")
    assert memory_provider.namespace == "memory", "MemoryToolProvider namespace should be 'memory'"
    
    # 测试 MCPToolProvider
    mcp_provider = MCPToolProvider(None)  # type: ignore
    print(f"✅ MCPToolProvider.namespace = '{mcp_provider.namespace}'")
    assert mcp_provider.namespace == "mcp", "MCPToolProvider namespace should be 'mcp'"
    
    # 测试 LocalToolProvider（应该没有命名空间）
    local_provider = LocalToolProvider()
    print(f"✅ LocalToolProvider.namespace = '{local_provider.namespace}'")
    assert local_provider.namespace is None, "LocalToolProvider should have no namespace"
    
    # 测试 get_tools_namespaced()
    print("\n📋 测试 get_tools_namespaced():")
    memory_tools = await memory_provider.get_tools_namespaced()
    print(f"   Memory tools with namespace: {list(memory_tools.keys())}")
    assert all(name.startswith("memory__") for name in memory_tools.keys()), \
        "All memory tools should have 'memory__' prefix"
    
    mcp_tools = await mcp_provider.get_tools_namespaced()
    print(f"   MCP tools with namespace: {list(mcp_tools.keys())[:3]}...")  # 只显示前 3 个
    assert all(name.startswith("mcp__") for name in mcp_tools.keys()), \
        "All MCP tools should have 'mcp__' prefix"
    
    local_tools = await local_provider.get_tools_namespaced()
    print(f"   Local tools (no namespace): {list(local_tools.keys())}")
    assert not any("__" in name for name in local_tools.keys()), \
        "Local tools should have no namespace prefix"
    
    print("\n✅ 改进 1 测试通过！")
    return True


async def test_improvement_2_parameter_injection():
    """测试改进 2：参数自动注入"""
    print("\n" + "="*60)
    print("🧪 测试改进 2：参数自动注入")
    print("="*60)
    
    from app.services.tools.tool_injector import ToolParameterInjector
    
    injector = ToolParameterInjector()
    
    # 测试 1：检测记忆工具需要 session_id
    print("\n📋 测试参数签名检测:")
    params_needed = injector._detect_system_params("memory__add_memory")
    print(f"   memory__add_memory needs: {params_needed}")
    assert "session_id" in params_needed, "add_memory should need session_id"
    
    # 测试 2：注入参数
    print("\n📋 测试参数注入:")
    original_args = {"content": "Test memory", "importance": 5}
    context = {"session_id": "test_session_123"}
    
    injected_args = injector.inject_params(
        tool_name="memory__add_memory",
        arguments=original_args,
        context=context
    )
    
    print(f"   Original args: {original_args}")
    print(f"   Injected args: {injected_args}")
    assert "session_id" in injected_args, "session_id should be injected"
    assert injected_args["session_id"] == "test_session_123", \
        "Injected session_id should match context"
    assert injected_args["content"] == "Test memory", \
        "Original arguments should be preserved"
    
    # 测试 3：缓存机制
    print("\n📋 测试缓存机制:")
    cache_size_before = len(injector._injection_cache)
    injector.inject_params("memory__add_memory", {}, {})  # 第二次调用
    cache_size_after = len(injector._injection_cache)
    print(f"   Cache size before: {cache_size_before}, after: {cache_size_after}")
    assert cache_size_before == cache_size_after, "Cache should prevent re-detection"
    
    # 测试 4：不需要注入的工具
    print("\n📋 测试非记忆工具（不应注入）:")
    non_memory_args = {"query": "test"}
    result_args = injector.inject_params(
        tool_name="some_other_tool",
        arguments=non_memory_args,
        context=context
    )
    print(f"   Result args: {result_args}")
    assert result_args == non_memory_args, \
        "Non-memory tools should not have injected parameters"
    
    print("\n✅ 改进 2 测试通过！")
    return True


async def main():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 开始验证工具族架构改进方案")
    print("="*60)
    
    try:
        # 测试改进 1
        success1 = await test_improvement_1_namespace_automation()
        
        # 测试改进 2
        success2 = await test_improvement_2_parameter_injection()
        
        # 总结
        print("\n" + "="*60)
        print("✅ 所有测试通过！")
        print("="*60)
        print("\n📊 改进成果:")
        print("  1. ✅ 命名空间自动化 - 减少重复代码，统一命名规范")
        print("  2. ✅ 参数自动注入 - LLM 无需提供 session_id，框架自动注入")
        print("\n🎉 改进方案实施完成！")
        
    except AssertionError as e:
        print(f"\n❌ 测试失败：{e}")
        raise
    except Exception as e:
        print(f"\n❌ 测试异常：{e}")
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    asyncio.run(main())
