"""
轻量级验证 - 不依赖 FastAPI 等外部库

只验证核心逻辑，不需要完整环境
"""

import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent / "app" / "services" / "tools"))


def test_namespace_automation():
    """测试命名空间自动化（纯 Python，无需依赖）"""
    print("\n" + "="*60)
    print("🧪 测试命名空间自动化")
    print("="*60)
    
    # 直接导入基类
    from providers.tool_provider_base import IToolProvider
    from abc import ABC, abstractmethod
    from typing import Any, Dict
    
    # 创建测试 Provider（类名必须以 ToolProvider 结尾）
    class MemoryToolProvider(IToolProvider):
        async def get_tools(self):
            return {"add_memory": {}, "search_memories": {}}
        
        async def execute(self, request):
            pass
        
        async def is_available(self, tool_name):
            return True
    
    class MCPToolProvider(IToolProvider):
        async def get_tools(self):
            return {"tool1": {}, "tool2": {}}
        
        async def execute(self, request):
            pass
        
        async def is_available(self, tool_name):
            return True
    
    class LocalToolProvider(IToolProvider):
        async def get_tools(self):
            return {"get_current_time": {}}
        
        async def execute(self, request):
            pass
        
        async def is_available(self, tool_name):
            return True
    
    # 实例化
    memory_provider = MemoryToolProvider()
    mcp_provider = MCPToolProvider()
    local_provider = LocalToolProvider()
    
    # 测试自动推导
    print(f"\n✅ TestMemoryProvider.namespace = '{memory_provider.namespace}'")
    assert memory_provider.namespace == "memory", "Should auto-derive 'memory'"
    
    print(f"✅ TestMCPProvider.namespace = '{mcp_provider.namespace}'")
    assert mcp_provider.namespace == "mcp", "Should auto-derive 'mcp'"
    
    print(f"✅ TestLocalProvider.namespace = '{local_provider.namespace}'")
    # LocalToolProvider 会被推导为 "local"，这是合理的
    assert local_provider.namespace == "local", "LocalToolProvider should derive 'local'"
    
    # 测试 get_tools_namespaced()
    import asyncio
    
    async def check_namespaced():
        memory_tools = await memory_provider.get_tools_namespaced()
        print(f"\n📋 Memory tools with namespace: {list(memory_tools.keys())}")
        assert all(name.startswith("memory__") for name in memory_tools.keys()), \
            "All memory tools should have 'memory__' prefix"
        
        mcp_tools = await mcp_provider.get_tools_namespaced()
        print(f"📋 MCP tools with namespace: {list(mcp_tools.keys())}")
        assert all(name.startswith("mcp__") for name in mcp_tools.keys()), \
            "All MCP tools should have 'mcp__' prefix"
        
        local_tools = await local_provider.get_tools_namespaced()
        print(f"📋 Local tools (with namespace): {list(local_tools.keys())}")
        # LocalToolProvider 也会被添加 'local__' 前缀，这是合理的
        assert all(name.startswith("local__") for name in local_tools.keys()), \
            "All local tools should have 'local__' prefix"
    
    asyncio.run(check_namespaced())
    
    print("\n✅ 命名空间自动化测试通过！")
    return True


def test_parameter_injection():
    """测试参数注入（简化版，无需数据库）"""
    print("\n" + "="*60)
    print("🧪 测试参数自动注入")
    print("="*60)
    
    from tool_injector import ToolParameterInjector
    
    injector = ToolParameterInjector()
    
    # 测试缓存机制
    print("\n📋 测试缓存机制:")
    cache_before = len(injector._injection_cache)
    
    # 第一次调用（会检测）
    result1 = injector.inject_params(
        tool_name="test_tool",
        arguments={"a": 1},
        context={"session_id": "test"}
    )
    cache_after_1 = len(injector._injection_cache)
    
    # 第二次调用（应该命中缓存）
    result2 = injector.inject_params(
        tool_name="test_tool",
        arguments={"b": 2},
        context={"session_id": "test"}
    )
    cache_after_2 = len(injector._injection_cache)
    
    print(f"   Cache size: before={cache_before}, after 1st={cache_after_1}, after 2nd={cache_after_2}")
    assert cache_after_1 == cache_after_2, "Second call should hit cache"
    
    # 测试向后兼容性
    print("\n📋 测试向后兼容（不需要注入的工具）:")
    original = {"query": "test", "limit": 10}
    result = injector.inject_params(
        tool_name="unknown_tool",
        arguments=original,
        context={"session_id": "test"}
    )
    print(f"   Original: {original}")
    print(f"   Result: {result}")
    assert result == original, "Unknown tools should preserve original arguments"
    
    print("\n✅ 参数注入测试通过！")
    return True


def main():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 开始验证工具族架构改进方案（轻量级）")
    print("="*60)
    
    try:
        # 测试改进 1
        test_namespace_automation()
        
        # 测试改进 2
        test_parameter_injection()
        
        # 总结
        print("\n" + "="*60)
        print("✅ 所有测试通过！")
        print("="*60)
        print("\n📊 改进成果:")
        print("  1. ✅ 命名空间自动化 - 从类名自动推导，减少重复代码")
        print("  2. ✅ 参数自动注入 - 支持缓存，向后兼容")
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
    main()
