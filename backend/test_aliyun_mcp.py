"""
测试阿里云百炼 MCP API

用于探索实际的 API 端点和响应格式
"""

import asyncio
import json
import httpx


async def test_aliyun_mcp():
    """测试阿里云百炼 MCP 服务器的各种可能端点"""
    
    base_url = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp"
    headers = {
        "Authorization": "Bearer sk-b4ed412869c342b5b50a0f3177af5d5c",
        "Content-Type": "application/json"
    }
    
    # 可能的端点列表
    endpoints = [
        "",
        "/tools",
        "/api/tools",
        "/v1/tools",
        "/mcp/tools",
        "/schema",
        "/.well-known/mcp",
        "/health",
        "/info",
    ]
    
    print(f"Testing Aliyun MCP Server: {base_url}\n")
    print("=" * 60)
    
    async with httpx.AsyncClient() as client:
        for endpoint in endpoints:
            url = f"{base_url.rstrip('/')}{endpoint}" if endpoint else base_url
            print(f"\nTesting: {url}")
            
            try:
                response = await client.get(url, headers=headers, timeout=30.0)
                print(f"  Status: {response.status_code}")
                
                if response.status_code == 200:
                    try:
                        data = response.json()
                        print(f"  Response type: {type(data).__name__}")
                        
                        if isinstance(data, dict):
                            print(f"  Keys: {list(data.keys())[:10]}")  # 显示前 10 个键
                            
                            # 检查是否有 tools 字段
                            if 'tools' in data:
                                tools = data['tools']
                                print(f"  ✓ Found tools! Count: {len(tools)}")
                                if tools and isinstance(tools, list):
                                    print(f"  First tool: {tools[0] if len(tools) > 0 else 'N/A'}")
                        elif isinstance(data, list):
                            print(f"  Response is a list with {len(data)} items")
                            if data:
                                print(f"  First item: {data[0]}")
                                
                    except json.JSONDecodeError:
                        # 不是 JSON，打印文本
                        text = response.text
                        print(f"  Response (text): {text[:500]}")
                    except Exception as e:
                        print(f"  Error parsing response: {e}")
                        print(f"  Response (truncated): {str(response.text)[:200]}")
                else:
                    print(f"  Error: {response.status_code} - {response.reason_phrase}")
                    
            except httpx.TimeoutException:
                print(f"  ✗ Timeout")
            except httpx.RequestError as e:
                print(f"  ✗ Request error: {e}")
            except Exception as e:
                print(f"  ✗ Error: {e}")
    
    print("\n" + "=" * 60)
    print("Testing completed!")


if __name__ == "__main__":
    asyncio.run(test_aliyun_mcp())