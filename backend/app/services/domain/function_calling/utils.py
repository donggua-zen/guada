import inspect
import json
from typing import Any, Dict, List, get_type_hints
from datetime import datetime


def function_schema(func) -> dict:
    """
    自动从 Python 函数生成 OpenAI function calling 所需的 schema。
    要求函数使用类型注解和文档字符串。
    """
    sig = inspect.signature(func)
    type_hints = get_type_hints(func)

    # 提取函数描述（docstring）
    description = (func.__doc__ or "").strip().split("\n")[0]  # 只取第一行

    # 构建 parameters JSON Schema
    properties = {}
    required = []

    for name, param in sig.parameters.items():
        # 获取类型
        py_type = type_hints.get(name, str)  # 默认为 string

        # 映射 Python 类型到 JSON Schema 类型
        if py_type in (int,):
            json_type = "integer"
        elif py_type in (float,):
            json_type = "number"
        elif py_type is bool:
            json_type = "boolean"
        elif py_type in (str, Any):
            json_type = "string"
        else:
            # 对于复杂类型（如 list, dict），默认用 object 或 array
            # 更复杂的场景建议用 Pydantic
            json_type = "string"  # 保守处理

        properties[name] = {"type": json_type}

        # 判断是否必需（无默认值）
        if param.default == inspect.Parameter.empty:
            required.append(name)

    parameters = {"type": "object", "properties": properties, "required": required}

    return {
        "type": "function",
        "function": {
            "name": func.__name__,
            "description": description,
            "parameters": parameters,
        },
    }


# 定义工具函数
async def get_current_time(format: str = "YYYY-MM-DD HH:mm:ss") -> Dict[str, Any]:
    """
    获取当前系统时间

    Args:
        format: 时间格式，支持 YYYY-MM-DD、HH:mm:ss 等格式

    Returns:
        包含当前时间的字典
    """
    now = datetime.now()
    
    # 自定义格式化
    time_str = format.replace("YYYY", str(now.year)) \
                     .replace("MM", f"{now.month:02d}") \
                     .replace("DD", f"{now.day:02d}") \
                     .replace("HH", f"{now.hour:02d}") \
                     .replace("mm", f"{now.minute:02d}") \
                     .replace("ss", f"{now.second:02d}")
    
    return {
        "current_time": time_str,
        "timezone": "local",
        "timestamp": int(now.timestamp())
    }


# 工具映射
TOOLS_MAP = {
    "get_current_time": get_current_time,
}


def get_tools_schema():
    """定义工具的 JSON Schema"""
    return [
        function_schema(get_current_time),
    ]


async def handle_tool_calls(
    tool_calls: List[dict],
) -> List[Dict[str, Any]]:
    """
    处理工具调用

    Args:
        tool_calls: 工具调用列表

    Returns:
        工具执行结果列表
    """
    tool_results = []

    for tool_call in tool_calls:
        func_name = tool_call["name"]

        # 解析参数
        try:
            arguments = json.loads(tool_call["arguments"])
            # 检查是否有对应的工具函数
            if func_name in TOOLS_MAP:
                # 调用工具函数
                result = await TOOLS_MAP[func_name](**arguments)

                # 添加到结果列表
                tool_results.append(
                    {
                        "tool_call_id": tool_call["id"],
                        "role": "tool",
                        "name": func_name,
                        "content": str(result),
                    }
                )
            else:
                # 未知工具
                tool_results.append(
                    {
                        "tool_call_id": tool_call["id"],
                        "role": "tool",
                        "name": func_name,
                        "content": f"Unknown tool: {func_name}",
                    }
                )
        except Exception as e:
            tool_results.append(
                {
                    "tool_call_id": tool_call["id"],
                    "role": "tool",
                    "name": func_name,
                    "content": f"{e}",
                }
            )

    return tool_results
