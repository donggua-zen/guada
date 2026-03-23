"""
MCP JSON-RPC 集成测试

测试完整的 MCP 工具获取和调用流程
"""

import asyncio
import json
from app.services.mcp.mcp_client import MCPClient


async def test_aliyun_mcp_full():
    """测试阿里云百炼 MCP 的完整流程"""
    
    base_url = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp"
    headers = {
        "Authorization": "Bearer sk-b4ed412869c342b5b50a0f3177af5d5c",
        "Content-Type": "application/json"
    }
    
    print("=" * 70)
    print("MCP JSON-RPC Integration Test")
    print("=" * 70)
    
    # 步骤 1: 获取工具列表
    print("\n[Step 1] Fetching tools list...")
    client = MCPClient(base_url, headers)
    tools = await client.list_tools()
    
    if not tools:
        print("✗ No tools found!")
        return
    
    print(f"✓ Found {len(tools)} tool(s):")
    for i, tool in enumerate(tools, 1):
        print(f"\n  Tool {i}:")
        print(f"    Name: {tool.get('name')}")
        print(f"    Description: {tool.get('description', 'N/A')[:100]}")
        
        input_schema = tool.get('inputSchema', {})
        properties = input_schema.get('properties', {})
        required = input_schema.get('required', [])
        
        print(f"    Parameters:")
        for param_name, param_info in properties.items():
            param_type = param_info.get('type', 'unknown')
            param_desc = param_info.get('description', 'N/A')
            default = param_info.get('default', None)
            is_required = "required" if param_name in required else "optional"
            
            print(f"      - {param_name} ({param_type}, {is_required})")
            print(f"        {param_desc}")
            if default is not None:
                print(f"        Default: {default}")
    
    # 步骤 2: 调用工具
    print("\n\n[Step 2] Calling tool...")
    first_tool = tools[0]
    tool_name = first_tool.get('name')
    
    # 准备参数
    arguments = {
        "query": "Python 编程语言教程",
        "count": 3
    }
    
    print(f"Calling: {tool_name}")
    print(f"Arguments: {json.dumps(arguments, ensure_ascii=False)}")
    
    result = await client.call_tool(tool_name, arguments)
    
    if result.get("error"):
        print(f"✗ Tool call failed: {result.get('message')}")
    else:
        print(f"✓ Tool call successful!")
        print(f"\nResult:")
        
        tool_result = result.get("result", {})
        if isinstance(tool_result, dict):
            # 格式化输出字典内容
            print(json.dumps(tool_result, indent=2, ensure_ascii=False)[:1000])
        else:
            print(tool_result)
    
    print("\n" + "=" * 70)
    print("Test completed!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(test_aliyun_mcp_full())