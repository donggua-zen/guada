"""测试通用工具转换方法"""
import asyncio
import json
from pydantic import BaseModel, Field
from typing import Literal

from app.services.tools.providers.memory_tool_provider import convert_to_openai_tool


class WeatherInput(BaseModel):
    """天气输入参数"""
    location: str = Field(..., description="城市和国家，如：Beijing, China")
    unit: Literal["celsius", "fahrenheit"] = Field(
        default="celsius",
        description="温度单位"
    )


async def test_convert_model():
    """测试 Pydantic 模型转换"""
    print("=== 测试 Pydantic 模型转换 ===\n")
    
    # 方式 1: Pydantic 模型
    tool = convert_to_openai_tool(WeatherInput, description="获取指定城市的当前天气")
    
    print(json.dumps(tool, indent=2, ensure_ascii=False))
    print()
    
    # 验证格式
    assert tool["type"] == "function"
    assert "function" in tool
    assert tool["function"]["name"] == "weather_input"  # ✅ 自动转换为下划线命名
    assert tool["function"]["description"] == "获取指定城市的当前天气"
    assert "parameters" in tool["function"]
    
    print("✅ Pydantic 模型转换测试通过！\n")


if __name__ == "__main__":
    asyncio.run(test_convert_model())
