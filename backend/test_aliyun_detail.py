"""详细测试阿里云百炼 MCP API"""

import asyncio
import httpx
import json


async def test_aliyun():
    base_url = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp"
    headers = {
        "Authorization": "Bearer sk-b4ed412869c342b5b50a0f3177af5d5c",
        "Content-Type": "application/json"
    }
    
    print(f"Testing: {base_url}\n")
    
    async with httpx.AsyncClient() as client:
        # 测试根路径
        print("1. Testing root path...")
        response = await client.get(base_url, headers=headers, timeout=30.0)
        print(f"   Status: {response.status_code}")
        print(f"   Content-Type: {response.headers.get('content-type')}")
        
        # 尝试解析 JSON
        try:
            data = response.json()
            print(f"   ✓ Valid JSON!")
            print(f"   Data type: {type(data).__name__}")
            
            if isinstance(data, dict):
                print(f"   Keys: {list(data.keys())}")
                if 'tools' in data:
                    print(f"   ✓ Found 'tools' field!")
                    tools = data['tools']
                    print(f"   Tools count: {len(tools)}")
                    if tools:
                        print(f"   First tool: {json.dumps(tools[0], indent=2, ensure_ascii=False)}")
            elif isinstance(data, list):
                print(f"   Response is a list with {len(data)} items")
                
        except json.JSONDecodeError as e:
            print(f"   ✗ Not valid JSON: {e}")
            print(f"   Response text (first 500 chars):\n{response.text[:500]}")
        
        print("\n" + "="*60 + "\n")
        
        # 根据官方文档，可能需要 POST 请求或者不同的端点
        # 让我们试试一些常见的 MCP 相关路径
        test_paths = [
            "/tools/list",
            "/tool/list",
            "/api/tool/list",
            "/v1/tools/list",
        ]
        
        for path in test_paths:
            url = f"{base_url.rstrip('/')}{path}"
            print(f"Testing: {url}")
            try:
                resp = await client.get(url, headers=headers, timeout=10.0)
                print(f"  Status: {resp.status_code}")
                if resp.status_code == 200:
                    print(f"  ✓ Success! Content-Type: {resp.headers.get('content-type')}")
            except Exception as e:
                print(f"  ✗ Error: {e}")


if __name__ == "__main__":
    asyncio.run(test_aliyun())