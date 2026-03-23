"""
测试获取当前时间工具
"""

import asyncio
import json
from app.services.domain.function_calling.utils import (
    get_current_time,
    get_tools_schema,
)


async def test_time_tool():
    """测试获取当前时间工具"""
    
    print("=" * 60)
    print("Testing get_current_time tool")
    print("=" * 60)
    
    # 测试 1: 调用工具
    print("\n[Test 1] Calling get_current_time...")
    result = await get_current_time()
    print(f"✓ Result: {result}")
    
    # 测试 2: 获取工具 Schema
    print("\n[Test 2] Getting tools schema...")
    tools_schema = get_tools_schema()
    print(f"✓ Tools count: {len(tools_schema)}")
    print(f"\nTool Schema:")
    print(json.dumps(tools_schema[0], indent=2, ensure_ascii=False))
    
    # 测试 3: 不同格式的时间
    print("\n[Test 3] Testing different time formats...")
    formats = [
        "YYYY-MM-DD",
        "HH:mm:ss",
        "YYYY/MM/DD HH:mm",
        "DD-MM-YYYY",
    ]
    
    for fmt in formats:
        result = await get_current_time(fmt)
        print(f"  Format '{fmt}': {result['current_time']}")
    
    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_time_tool())