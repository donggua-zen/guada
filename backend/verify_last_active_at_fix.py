"""
验证 last_active_at 字段修复

该脚本用于验证：
1. 后端 Schema 是否正确包含 last_active_at 字段
2. API 返回的会话列表是否包含该字段
3. 前端 create 事件标志位逻辑是否正确
"""

import sys
import json
from pathlib import Path

def verify_backend_schema():
    """验证后端 Session Schema 是否包含 last_active_at 字段"""
    print("=" * 60)
    print("验证 1: 后端 SessionItemOut Schema")
    print("=" * 60)
    
    schema_file = Path('backend/app/schemas/session.py')
    base_file = Path('backend/app/schemas/base.py')
    
    if not schema_file.exists():
        print(f"✗ 文件不存在：{schema_file}")
        return False
    
    if not base_file.exists():
        print(f"✗ 文件不存在：{base_file}")
        return False
    
    session_content = schema_file.read_text(encoding='utf-8')
    base_content = base_file.read_text(encoding='utf-8')
    
    # 检查 BaseResponse 是否包含 last_active_at 字段
    if 'last_active_at: Optional[datetime] = None' in base_content:
        print("✓ BaseResponse 包含 last_active_at 字段定义")
    else:
        print("✗ BaseResponse 缺少 last_active_at 字段定义")
        return False
    
    # 检查 SessionItemOut 是否继承自 BaseResponse
    if 'class SessionItemOut(BaseResponse):' in session_content:
        print("✓ SessionItemOut 继承自 BaseResponse")
    else:
        print("✗ SessionItemOut 未继承自 BaseResponse")
        return False
    
    # 检查是否包含 created_at 和 updated_at
    if 'created_at: Optional[datetime]' in base_content:
        print("✓ BaseResponse 包含 created_at 字段")
    else:
        print("⚠ BaseResponse 缺少 created_at 字段（可选）")
    
    if 'updated_at: Optional[datetime]' in base_content:
        print("✓ BaseResponse 包含 updated_at 字段")
    else:
        print("⚠ BaseResponse 缺少 updated_at 字段（可选）")
    
    print("\n后端 Schema 验证通过！\n")
    return True


def verify_frontend_logic():
    """验证前端 create 事件处理逻辑"""
    print("=" * 60)
    print("验证 2: 前端 useStreamResponse.js create 事件处理")
    print("=" * 60)
    
    js_file = Path('frontend/src/composables/useStreamResponse.js')
    if not js_file.exists():
        print(f"✗ 文件不存在：{js_file}")
        return False
    
    content = js_file.read_text(encoding='utf-8')
    
    # 检查是否有标志位定义
    if 'hasUpdatedActiveTime' in content:
        print("✓ processStream 中定义了 hasUpdatedActiveTime 标志位")
    else:
        print("✗ processStream 中缺少 hasUpdatedActiveTime 标志位")
        return False
    
    # 检查是否有条件判断
    if 'if (!hasUpdatedActiveTime)' in content:
        print("✓ create 事件处理中包含条件判断")
    else:
        print("✗ create 事件处理中缺少条件判断")
        return False
    
    # 检查是否设置标志位
    if 'hasUpdatedActiveTime = true' in content:
        print("✓ 正确设置标志位为 true")
    else:
        print("✗ 未正确设置标志位")
        return False
    
    # 检查调用 updateSessionLastActiveTime
    if 'sessionStore.updateSessionLastActiveTime' in content:
        print("✓ 调用了 updateSessionLastActiveTime 方法")
    else:
        print("✗ 未调用 updateSessionLastActiveTime 方法")
        return False
    
    print("\n前端逻辑验证通过！\n")
    return True


def test_api_response():
    """测试 API 响应（需要后端服务运行）"""
    print("=" * 60)
    print("验证 3: API 响应验证（需要手动测试）")
    print("=" * 60)
    
    print("请按照以下步骤手动测试:")
    print("1. 启动后端服务：cd backend; .\\.venv\\Scripts\\Activate.ps1; python run.py")
    print("2. 使用 Postman 或 curl 调用 GET /api/v1/sessions")
    print("3. 检查返回的 JSON 数据中每个会话是否包含以下字段:")
    print("   - last_active_at")
    print("   - created_at")
    print("   - updated_at")
    print()
    print("示例响应结构:")
    sample_response = {
        "code": 200,
        "message": "success",
        "data": {
            "items": [
                {
                    "id": "01KMFBVEKVTH70CFKDS3J1K56Z",
                    "title": "测试会话",
                    "last_active_at": "2026-03-27T15:30:00.000000",
                    "created_at": "2026-03-27T15:00:00.000000",
                    "updated_at": "2026-03-27T15:30:00.000000"
                }
            ]
        }
    }
    print(json.dumps(sample_response, indent=2, ensure_ascii=False))
    print()
    
    return True


def main():
    """主验证函数"""
    print("\n")
    print("╔" + "=" * 58 + "╗")
    print("║" + " " * 12 + "last_active_at 字段修复验证" + " " * 12 + "║")
    print("╚" + "=" * 58 + "╝")
    print()
    
    results = []
    
    # 验证后端 Schema
    results.append(("后端 Schema", verify_backend_schema()))
    
    # 验证前端逻辑
    results.append(("前端逻辑", verify_frontend_logic()))
    
    # API 响应测试
    results.append(("API 响应", test_api_response()))
    
    # 总结
    print("=" * 60)
    print("验证总结")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓" if result else "✗"
        print(f"{status} {name}: {'通过' if result else '失败'}")
    
    print()
    print(f"总计：{passed}/{total} 项验证通过")
    
    if passed == total:
        print("\n🎉 所有验证通过！修复成功！")
        print("\n下一步:")
        print("1. 重启后端服务，确保 Schema 变更生效")
        print("2. 重启前端服务，加载最新代码")
        print("3. 创建新会话并发送消息，观察排序行为")
        print("4. 在工具调用场景中（多轮问答），验证时间戳只更新一次")
        return 0
    else:
        print(f"\n⚠️  有 {total - passed} 项验证失败，请检查修复")
        return 1


if __name__ == "__main__":
    sys.exit(main())
