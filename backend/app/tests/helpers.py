# app/tests/helpers.py
"""
测试辅助工具

提供通用的测试辅助函数，简化测试代码编写
"""
from typing import Dict, Any, List, Optional
import json


def assert_response_success(response, expected_status: int = 200):
    """
    断言 HTTP 响应成功
    
    Args:
        response: HTTP 响应对象
        expected_status: 期望的状态码（默认 200）
    """
    assert response.status_code == expected_status, (
        f"Expected status {expected_status}, got {response.status_code}. "
        f"Response: {response.text}"
    )


def assert_response_contains(response, key: str):
    """
    断言响应包含指定键
    
    Args:
        response: HTTP 响应对象
        key: 期望的键名
    """
    data = response.json()
    assert key in data, f"Response missing key '{key}'. Data: {data}"


def create_tool_call_dict(
    tool_id: str,
    name: str,
    arguments: Dict[str, Any]
) -> Dict[str, Any]:
    """
    创建工具调用字典（OpenAI 格式）
    
    Args:
        tool_id: 工具调用 ID
        name: 工具名称
        arguments: 工具参数
        
    Returns:
        Dict 格式的工具调用
    """
    return {
        "id": tool_id,
        "name": name,
        "arguments": json.dumps(arguments)
    }


def create_mock_message(
    content: str,
    role: str = "user",
    tool_calls: Optional[List[Dict]] = None,
    tool_call_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    创建 Mock 消息对象
    
    Args:
        content: 消息内容
        role: 角色（user/assistant/tool）
        tool_calls: 工具调用列表（assistant 角色使用）
        tool_call_id: 工具调用 ID（tool 角色使用）
        
    Returns:
        Dict 格式的 Mock 消息
    """
    message = {
        "role": role,
        "content": content
    }
    
    if tool_calls:
        message["tool_calls"] = tool_calls
    
    if tool_call_id:
        message["tool_call_id"] = tool_call_id
    
    return message


def extract_tool_calls_from_response(response) -> List[Dict[str, Any]]:
    """
    从响应中提取工具调用
    
    Args:
        response: HTTP 响应对象
        
    Returns:
        工具调用列表
    """
    data = response.json()
    return data.get("tool_calls", [])


def count_tool_calls_in_messages(messages: List[Dict]) -> int:
    """
    统计消息中的工具调用数量
    
    Args:
        messages: 消息列表
        
    Returns:
        工具调用总数
    """
    count = 0
    for message in messages:
        if isinstance(message, dict):
            count += len(message.get("tool_calls", []))
    return count


def filter_messages_by_role(messages: List[Dict], role: str) -> List[Dict]:
    """
    按角色过滤消息
    
    Args:
        messages: 消息列表
        role: 目标角色
        
    Returns:
        过滤后的消息列表
    """
    return [msg for msg in messages if msg.get("role") == role]


def has_tool_call_with_name(messages: List[Dict], tool_name: str) -> bool:
    """
    检查消息中是否包含指定名称的工具调用
    
    Args:
        messages: 消息列表
        tool_name: 工具名称
        
    Returns:
        True 如果找到该工具调用
    """
    for message in messages:
        tool_calls = message.get("tool_calls", [])
        for tc in tool_calls:
            if tc.get("name") == tool_name:
                return True
    return False


async def wait_for_async_generator(generator):
    """
    等待异步生成器完成并收集所有结果
    
    Args:
        generator: 异步生成器
        
    Returns:
        结果列表
    """
    results = []
    async for item in generator:
        results.append(item)
    return results


def create_test_file_metadata(
    filename: str = "test.txt",
    size: int = 1024,
    mime_type: str = "text/plain"
) -> Dict[str, Any]:
    """
    创建测试文件元数据
    
    Args:
        filename: 文件名
        size: 文件大小（字节）
        mime_type: MIME 类型
        
    Returns:
        文件元数据字典
    """
    return {
        "filename": filename,
        "size": size,
        "mime_type": mime_type,
        "url": f"/files/{filename}"
    }
