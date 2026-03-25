"""
测试自动会话标题生成功能

运行此脚本前请确保：
1. 后端服务已启动
2. 已登录并获取有效的 token
3. 已配置全局默认标题总结模型（在设置页面中）
"""

import requests
import json
import time

# 配置
BASE_URL = "http://localhost:8000/api/v1"
TOKEN = "your_token_here"  # 替换为实际的 token

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

def create_test_session():
    """创建测试会话"""
    print("=" * 50)
    print("步骤 1: 创建测试会话")
    print("=" * 50)
    
    # 首先需要创建一个角色（或使用现有角色 ID）
    # 这里假设已经有一个角色存在
    character_id = "your_character_id"  # 替换为实际的角色 ID
    
    session_data = {
        "character_id": character_id,
        "model_id": None  # 可选，如果不提供则使用角色的模型
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/sessions",
            headers=headers,
            json=session_data
        )
        response.raise_for_status()
        
        session = response.json()
        print(f"✓ 会话创建成功")
        print(f"  Session ID: {session['id']}")
        print(f"  初始标题：{session['title']}")
        
        return session['id']
        
    except Exception as e:
        print(f"✗ 创建会话失败：{e}")
        return None

def send_message(session_id, content):
    """发送消息"""
    print("\n" + "=" * 50)
    print(f"步骤 2: 发送用户消息")
    print("=" * 50)
    
    message_data = {
        "content": content,
        "files": []
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/sessions/{session_id}/messages",
            headers=headers,
            json=message_data
        )
        response.raise_for_status()
        
        message = response.json()
        print(f"✓ 消息发送成功")
        print(f"  Message ID: {message['id']}")
        print(f"  内容：{content}")
        
        return message['id']
        
    except Exception as e:
        print(f"✗ 发送消息失败：{e}")
        return None

def test_generate_title_api(session_id):
    """测试生成标题 API"""
    print("\n" + "=" * 50)
    print("步骤 3: 调用标题生成 API")
    print("=" * 50)
    
    try:
        response = requests.post(
            f"{BASE_URL}/sessions/{session_id}/generate-title",
            headers=headers
        )
        response.raise_for_status()
        
        result = response.json()
        print(f"✓ 标题生成完成")
        print(f"  结果：{json.dumps(result, ensure_ascii=False, indent=2)}")
        
        if result.get('skipped'):
            print(f"  ⚠️  标题生成被跳过，原因：{result.get('reason')}")
        else:
            print(f"  ✓ 新标题：{result.get('title')}")
            print(f"  旧标题：{result.get('old_title')}")
        
        return result
        
    except Exception as e:
        print(f"✗ 生成标题失败：{e}")
        return None

def get_session(session_id):
    """获取会话信息"""
    print("\n" + "=" * 50)
    print("步骤 4: 获取更新后的会话信息")
    print("=" * 50)
    
    try:
        response = requests.get(
            f"{BASE_URL}/sessions/{session_id}",
            headers=headers
        )
        response.raise_for_status()
        
        session = response.json()
        print(f"✓ 获取会话成功")
        print(f"  标题：{session.get('title')}")
        
        return session
        
    except Exception as e:
        print(f"✗ 获取会话失败：{e}")
        return None

def test_no_model_configured():
    """测试未配置模型时的行为"""
    print("\n" + "=" * 50)
    print("测试场景：会话未配置模型")
    print("=" * 50)
    
    # 创建一个没有 model_id 的会话
    character_id = "your_character_id"  # 替换为实际的角色 ID
    
    session_data = {
        "character_id": character_id,
        "model_id": None
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/sessions",
            headers=headers,
            json=session_data
        )
        response.raise_for_status()
        
        session = response.json()
        session_id = session['id']
        
        print(f"✓ 创建无模型配置的会话：{session_id}")
        
        # 尝试生成标题
        result = test_generate_title_api(session_id)
        
        if result and result.get('skipped'):
            print(f"✓ 正确跳过标题生成：{result.get('reason')}")
        else:
            print(f"⚠️  预期跳过但实际执行了")
            
    except Exception as e:
        print(f"✗ 测试失败：{e}")

if __name__ == "__main__":
    print("\n开始测试自动会话标题生成功能...\n")
    
    # 测试 1: 正常流程
    session_id = create_test_session()
    
    if session_id:
        # 发送一条测试消息
        message_id = send_message(
            session_id,
            "如何使用 Python 读取 CSV 文件？"
        )
        
        if message_id:
            # 等待一下，模拟助手回复完成
            print("\n等待助手回复完成...")
            time.sleep(2)
            
            # 调用标题生成 API
            result = test_generate_title_api(session_id)
            
            # 验证标题是否更新
            if result and not result.get('skipped'):
                session = get_session(session_id)
                if session and session.get('title') == result.get('title'):
                    print("\n" + "=" * 50)
                    print("✓ 测试通过！标题已成功更新")
                    print("=" * 50)
                else:
                    print("\n" + "=" * 50)
                    print("✗ 测试失败：标题未正确更新")
                    print("=" * 50)
    
    # 测试 2: 未配置模型的场景
    test_no_model_configured()
    
    print("\n所有测试完成！\n")
