"""测试函数参数自动解析和构建"""
import asyncio
import json
from pydantic import BaseModel, Field
from typing import Literal

from app.utils.openai_tool_converter import (
    convert_to_openai_tool,
    build_func_arguments
)


class WeatherInput(BaseModel):
    """天气输入参数"""
    location: str = Field(..., description="城市和国家，如：Beijing, China")
    unit: Literal["celsius", "fahrenheit"] = Field(
        default="celsius",
        description="温度单位"
    )


def get_weather(input: WeatherInput, session_id: str) -> str:
    """获取指定城市的当前天气
    
    Args:
        input: 天气输入参数
        session_id: 会话 ID（自动注入）
    
    Returns:
        天气信息字符串
    """
    return f"{input.location}: 25°{input.unit}"


async def test_function_conversion():
    """测试函数转换和参数构建"""
    print("=== 测试函数参数自动解析 ===\n")
    
    # Step 1: 转换为 OpenAI 格式
    tool = convert_to_openai_tool(get_weather, description="获取天气信息")
    
    print("生成的 OpenAI 工具定义:")
    print(json.dumps(tool, indent=2, ensure_ascii=False))
    print()
    
    # 验证 Schema
    assert tool["type"] == "function"
    assert tool["function"]["name"] == "get_weather"
    assert "parameters" in tool["function"]
    
    # 验证参数不包含 session_id（这是注入参数）
    params = tool["function"]["parameters"]
    assert "session_id" not in params["properties"], "session_id 不应出现在 parameters 中"
    assert "location" in params["properties"], "location 应该在 parameters 中"
    assert "unit" in params["properties"], "unit 应该在 parameters 中"
    
    print("✅ Schema 验证通过！")
    print(f"   - location: {params['properties']['location']}")
    print(f"   - unit: {params['properties']['unit']}")
    print(f"   - required: {params['required']}")
    print()
    
    # Step 2: 模拟 OpenAI 返回的参数
    openai_arguments = {
        "location": "Beijing, China",
        "unit": "celsius"
    }
    
    print(f"OpenAI 返回的参数：{openai_arguments}\n")
    
    # Step 3: 自动构建函数调用参数
    inject_context = {"session_id": "test_session_123"}
    args, kwargs = build_func_arguments(get_weather, openai_arguments, inject_context)
    
    print("自动构建的函数参数:")
    print(f"  args: {args}")
    print(f"  kwargs: {kwargs}")
    print()
    
    # 验证参数构建
    assert len(args) == 1, "应该有 1 个位置参数（WeatherInput 实例）"
    assert isinstance(args[0], WeatherInput), "第一个参数应该是 WeatherInput 实例"
    assert args[0].location == "Beijing, China", "location 应该正确设置"
    assert args[0].unit == "celsius", "unit 应该正确设置"
    assert kwargs.get("session_id") == "test_session_123", "session_id 应该从 context 注入"
    
    print("✅ 参数构建验证通过！")
    print()
    
    # Step 4: 实际调用函数
    result = get_weather(*args, **kwargs)
    print(f"函数执行结果：{result}")
    print()
    
    assert result == "Beijing, China: 25°celsius", "函数执行结果应该正确"
    print("✅ 所有测试通过！🎉\n")


if __name__ == "__main__":
    asyncio.run(test_function_conversion())
