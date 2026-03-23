"""
MCP Server API Test Script
用于测试 MCP 服务器的所有 API 接口
"""
import requests
import json

BASE_URL = "http://localhost:8800/api/v1/mcp-servers"

def print_separator(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def test_get_all_servers():
    """测试获取所有 MCP 服务器"""
    print_separator("TEST 1: 获取所有 MCP 服务器")
    try:
        response = requests.get(BASE_URL)
        print(f"状态码：{response.status_code}")
        print(f"响应数据：{json.dumps(response.json(), indent=2, ensure_ascii=False)}")
        return response.json() if response.status_code == 200 else None
    except Exception as e:
        print(f"请求失败：{e}")
        return None

def test_create_server():
    """测试创建 MCP 服务器"""
    print_separator("TEST 2: 创建 MCP 服务器")
    
    server_data = {
        "name": "测试 MCP 服务器",
        "url": "https://mcp.example.com/api",
        "description": "这是一个测试用的 MCP 服务器",
        "headers": {
            "Authorization": "Bearer test_token_123",
            "X-API-Key": "test_api_key",
            "Content-Type": "application/json"
        },
        "enabled": True
    }
    
    try:
        response = requests.post(BASE_URL, json=server_data)
        print(f"状态码：{response.status_code}")
        
        if response.status_code == 201:
            print("✓ 创建成功！")
            data = response.json()
            print(f"服务器 ID: {data.get('id')}")
            print(f"服务器名称：{data.get('name')}")
            print(f"服务地址：{data.get('url')}")
            return data
        else:
            print(f"✗ 创建失败：{response.text}")
            return None
    except Exception as e:
        print(f"请求失败：{e}")
        return None

def test_get_server_by_id(server_id):
    """测试根据 ID 获取 MCP 服务器"""
    print_separator(f"TEST 3: 获取服务器详情 (ID: {server_id})")
    
    try:
        response = requests.get(f"{BASE_URL}/{server_id}")
        print(f"状态码：{response.status_code}")
        
        if response.status_code == 200:
            print("✓ 获取成功！")
            data = response.json()
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return data
        else:
            print(f"✗ 获取失败：{response.text}")
            return None
    except Exception as e:
        print(f"请求失败：{e}")
        return None

def test_update_server(server_id):
    """测试更新 MCP 服务器"""
    print_separator(f"TEST 4: 更新服务器 (ID: {server_id})")
    
    update_data = {
        "name": "更新后的测试服务器",
        "description": "描述信息已更新",
        "enabled": False
    }
    
    try:
        response = requests.put(f"{BASE_URL}/{server_id}", json=update_data)
        print(f"状态码：{response.status_code}")
        
        if response.status_code == 200:
            print("✓ 更新成功！")
            data = response.json()
            print(f"新名称：{data.get('name')}")
            print(f"新描述：{data.get('description')}")
            print(f"启用状态：{'✓' if data.get('enabled') else '✗'}")
            return data
        else:
            print(f"✗ 更新失败：{response.text}")
            return None
    except Exception as e:
        print(f"请求失败：{e}")
        return None

def test_toggle_server_status(server_id):
    """测试切换 MCP 服务器状态"""
    print_separator(f"TEST 5: 切换服务器状态 (ID: {server_id})")
    
    try:
        # 切换到启用状态
        response = requests.patch(f"{BASE_URL}/{server_id}/toggle?enabled=true")
        print(f"状态码：{response.status_code}")
        
        if response.status_code == 200:
            print("✓ 切换成功！")
            data = response.json()
            print(f"当前状态：{'✓ 已启用' if data.get('enabled') else '✗ 已禁用'}")
            return data
        else:
            print(f"✗ 切换失败：{response.text}")
            return None
    except Exception as e:
        print(f"请求失败：{e}")
        return None

def test_delete_server(server_id):
    """测试删除 MCP 服务器"""
    print_separator(f"TEST 6: 删除服务器 (ID: {server_id})")
    
    try:
        response = requests.delete(f"{BASE_URL}/{server_id}")
        print(f"状态码：{response.status_code}")
        
        if response.status_code == 204:
            print("✓ 删除成功！")
            return True
        else:
            print(f"✗ 删除失败：{response.text}")
            return False
    except Exception as e:
        print(f"请求失败：{e}")
        return False

def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("  MCP Server API 完整测试流程")
    print("="*60)
    
    # TEST 1: 获取所有服务器（空列表）
    initial_servers = test_get_all_servers()
    
    # TEST 2: 创建新服务器
    created_server = test_create_server()
    
    if not created_server:
        print("\n✗ 创建失败，后续测试跳过")
        return
    
    server_id = created_server.get('id')
    
    # TEST 3: 获取服务器详情
    test_get_server_by_id(server_id)
    
    # TEST 4: 更新服务器
    test_update_server(server_id)
    
    # TEST 5: 切换服务器状态
    test_toggle_server_status(server_id)
    
    # TEST 6: 删除服务器
    delete_success = test_delete_server(server_id)
    
    if delete_success:
        # 验证删除后是否还能获取到
        print_separator("验证删除结果")
        final_servers = test_get_all_servers()
        if final_servers and len(final_servers.get('items', [])) == 0:
            print("✓ 确认服务器已被删除")
        else:
            print("⚠ 警告：删除后仍有数据")
    
    print("\n" + "="*60)
    print("  测试完成！")
    print("="*60 + "\n")

if __name__ == "__main__":
    try:
        run_all_tests()
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
    except Exception as e:
        print(f"\n测试过程中发生错误：{e}")