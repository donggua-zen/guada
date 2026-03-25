"""
测试新增的默认模型设置 API

运行此脚本前请确保：
1. 后端服务已启动
2. 已登录并获取有效的 token
"""

import requests
import json

# 配置
BASE_URL = "http://localhost:8000/api/v1"
TOKEN = "your_token_here"  # 替换为实际的 token

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

def test_get_settings():
    """测试获取设置接口"""
    print("=" * 50)
    print("测试 GET /settings")
    print("=" * 50)
    
    try:
        response = requests.get(f"{BASE_URL}/settings", headers=headers)
        response.raise_for_status()
        
        settings = response.json()
        print("✓ 获取设置成功")
        print(f"\n返回的设置数据:")
        print(json.dumps(settings, indent=2, ensure_ascii=False))
        
        # 验证新增的字段是否存在
        new_fields = [
            "default_title_summary_model_id",
            "default_title_summary_prompt",
            "default_translation_model_id",
            "default_translation_prompt",
            "default_history_compression_model_id",
            "default_history_compression_prompt"
        ]
        
        print(f"\n验证新增字段:")
        for field in new_fields:
            if field in settings:
                print(f"  ✓ {field}: {settings[field]}")
            else:
                print(f"  ✗ {field}: 不存在")
        
        return True
        
    except Exception as e:
        print(f"✗ 获取设置失败：{e}")
        return False

def test_update_settings():
    """测试更新设置接口"""
    print("\n" + "=" * 50)
    print("测试 PUT /settings")
    print("=" * 50)
    
    test_data = {
        "default_title_summary_model_id": "test_model_123",
        "default_title_summary_prompt": "你是一个专业的标题生成助手，请根据对话内容生成简洁准确的标题。",
        "default_translation_model_id": "test_model_456",
        "default_translation_prompt": "你是一个专业的翻译助手，请将用户输入的内容翻译成目标语言，保持原文的意思和风格。",
        "default_history_compression_model_id": "test_model_789",
        "default_history_compression_prompt": "请压缩以下对话历史，保留关键信息，去除冗余内容。"
    }
    
    try:
        response = requests.put(
            f"{BASE_URL}/settings", 
            headers=headers, 
            json=test_data
        )
        response.raise_for_status()
        
        result = response.json()
        print("✓ 更新设置成功")
        print(f"\n返回的更新结果:")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        # 验证更新的字段
        print(f"\n验证更新的字段:")
        for key, value in test_data.items():
            if key in result and result[key] == value:
                print(f"  ✓ {key}: {value}")
            else:
                print(f"  ✗ {key}: 更新失败或不一致")
        
        return True
        
    except Exception as e:
        print(f"✗ 更新设置失败：{e}")
        return False

if __name__ == "__main__":
    print("\n开始测试默认模型设置 API...\n")
    
    # 测试获取设置
    get_success = test_get_settings()
    
    # 测试更新设置（仅在获取成功后执行）
    if get_success:
        update_success = test_update_settings()
        
        if update_success:
            print("\n" + "=" * 50)
            print("✓ 所有测试通过！")
            print("=" * 50)
        else:
            print("\n" + "=" * 50)
            print("✗ 部分测试失败")
            print("=" * 50)
    else:
        print("\n" + "=" * 50)
        print("✗ 获取设置失败，无法继续测试")
        print("=" * 50)
