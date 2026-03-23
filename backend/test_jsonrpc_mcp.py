"""
测试阿里云百炼是否支持 JSON-RPC 协议的 MCP
"""

import asyncio
import json
import httpx


async def test_jsonrpc_mcp():
    """使用 JSON-RPC 2.0 协议测试阿里云 MCP"""
    
    base_url = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp"
    headers = {
        "Authorization": "Bearer sk-b4ed412869c342b5b50a0f3177af5d5c",
        "Content-Type": "application/json"
    }
    
    print(f"Testing Aliyun MCP with JSON-RPC 2.0 protocol...")
    print(f"URL: {base_url}\n")
    print("=" * 60)
    
    # 测试 1: 获取工具列表 (JSON-RPC 格式)
    print("\n1. Testing tools/list (JSON-RPC)...")
    request_data = {
        "jsonrpc": "2.0",
        "method": "tools/list",
        "id": 1
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(base_url, headers=headers, json=request_data, timeout=30.0)
            print(f"   Status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                print(f"   ✓ Success! Response type: {type(result).__name__}")
                
                if isinstance(result, dict):
                    print(f"   Response keys: {list(result.keys())}")
                    
                    # 检查 JSON-RPC 响应格式
                    if 'jsonrpc' in result and 'id' in result:
                        print(f"   ✓ Valid JSON-RPC response!")
                        if 'result' in result:
                            tools_result = result['result']
                            print(f"   Result keys: {list(tools_result.keys())}")
                            
                            if 'tools' in tools_result:
                                tools = tools_result['tools']
                                print(f"   ✓ Found tools! Count: {len(tools)}")
                                if tools:
                                    print(f"   First tool:")
                                    print(f"   {json.dumps(tools[0], indent=2, ensure_ascii=False)}")
                            else:
                                print(f"   No tools field in result")
                        elif 'error' in result:
                            print(f"   ✗ Error: {result['error']}")
                    else:
                        print(f"   Not a standard JSON-RPC response")
                        print(f"   Full response: {json.dumps(result, indent=2, ensure_ascii=False)[:500]}")
                else:
                    print(f"   Unexpected response type")
            else:
                print(f"   ✗ HTTP Error: {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                
        except httpx.TimeoutException:
            print(f"   ✗ Timeout")
        except Exception as e:
            print(f"   ✗ Error: {e}")
    
    # 测试 2: 调用工具 (JSON-RPC 格式)
    print("\n\n2. Testing tools/call (JSON-RPC)...")
    call_request = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "web_search",
            "arguments": {
                "query": "Python 教程"
            }
        },
        "id": 2
    }
    
    try:
        response = await client.post(base_url, headers=headers, json=call_request, timeout=30.0)
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"   ✓ Request successful!")
            print(f"   Response: {json.dumps(result, indent=2, ensure_ascii=False)[:500]}")
        else:
            print(f"   ✗ HTTP Error: {response.status_code}")
            
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    print("\n" + "=" * 60)
    print("Testing completed!")


if __name__ == "__main__":
    asyncio.run(test_jsonrpc_mcp())