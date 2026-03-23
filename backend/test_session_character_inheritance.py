"""
测试会话继承角色功能的脚本
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent))

from app.database import AsyncSessionLocal, ModelBase, engine
from app.models.character import Character
from app.models.session import Session
from app.repositories.character_repository import CharacterRepository
from app.services.session_service import SessionService
from app.repositories.session_repository import SessionRepository
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


async def test_session_inheritance():
    """测试会话继承角色配置功能"""
    
    print("=" * 60)
    print("测试会话继承角色配置功能")
    print("=" * 60)
    
    async with AsyncSessionLocal() as session:
        # 1. 创建测试角色
        print("\n1. 创建测试角色...")
        character_data = {
            "user_id": "test_user_001",
            "title": "测试角色 - 智能助手",
            "description": "这是一个测试角色",
            "avatar_url": "/static/avatars/test.png",
            "is_public": False,
            "model_id": None,
            "settings": {
                "assistant_name": "小智",
                "assistant_identity": "AI 助手",
                "system_prompt": "你是一个有帮助的 AI 助手",
                "memory_type": "sliding_window",
                "max_memory_length": 10,
                "model_temperature": 0.7,
                "model_top_p": 0.9,
            }
        }
        
        character = Character(**character_data)
        session.add(character)
        await session.flush()
        await session.refresh(character)
        print(f"✓ 角色创建成功，ID: {character.id}")
        print(f"  标题：{character.title}")
        print(f"  设置：{character.settings}")
        
        # 2. 使用角色创建会话 (不覆盖任何配置)
        print("\n2. 创建会话 (完全继承角色配置)...")
        session_service = SessionService(
            session_repo=SessionRepository(session),
            character_repo=CharacterRepository(session)
        )
        
        user_mock = type('User', (), {'id': 'test_user_001'})()
        
        # 情况 1: 只传递 character_id，其他都不传
        session_data_1 = {
            "character_id": character.id
        }
        
        created_session = await session_service.create_session(user_mock, session_data_1)
        print(f"✓ 会话创建成功，ID: {created_session.id}")
        print(f"  标题：{created_session.title} (应该与角色相同)")
        print(f"  头像：{created_session.avatar_url} (应该与角色相同)")
        print(f"  设置：{created_session.settings} (应该与角色相同)")
        
        # 验证继承
        assert created_session.title == character.title, "标题应该继承角色"
        assert created_session.avatar_url == character.avatar_url, "头像应该继承角色"
        assert created_session.settings == character.settings, "设置应该继承角色"
        print("✓ 完全继承验证通过")
        
        # 3. 创建会话并覆盖部分配置
        print("\n3. 创建会话 (覆盖模型和部分设置)...")
        session_data_2 = {
            "character_id": character.id,
            "title": "自定义标题",
            "model_id": "custom_model_123",
            "settings": {
                "model_temperature": 0.9,  # 覆盖温度
                "web_search_enabled": True,  # 新增 web 搜索
            }
        }
        
        created_session_2 = await session_service.create_session(user_mock, session_data_2)
        print(f"✓ 会话创建成功，ID: {created_session_2.id}")
        print(f"  标题：{created_session_2.title} (应该被覆盖)")
        print(f"  模型 ID: {created_session_2.model_id} (应该被覆盖)")
        print(f"  设置：{created_session_2.settings}")
        
        # 验证部分覆盖
        assert created_session_2.title == "自定义标题", "标题应该被覆盖"
        assert created_session_2.model_id == "custom_model_123", "模型 ID 应该被覆盖"
        assert created_session_2.settings["assistant_name"] == "小智", "未覆盖的设置应该保留"
        assert created_session_2.settings["model_temperature"] == 0.9, "温度应该被覆盖"
        assert created_session_2.settings["web_search_enabled"] == True, "应该新增 web 搜索"
        print("✓ 部分覆盖验证通过")
        
        # 4. 查询会话并验证 character_id 关联
        print("\n4. 验证会话与角色的关联...")
        stmt = select(Session).filter(Session.id == created_session.id)
        result = await session.execute(stmt)
        fetched_session = result.scalar_one_or_none()
        
        assert fetched_session.character_id == character.id, "会话应该绑定到角色"
        print(f"✓ 会话正确绑定到角色：{fetched_session.character_id}")
        
        # 清理测试数据
        print("\n5. 清理测试数据...")
        await session.delete(created_session)
        await session.delete(created_session_2)
        await session.delete(character)
        await session.commit()
        print("✓ 测试数据已清理")
        
        print("\n" + "=" * 60)
        print("所有测试通过！✓")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_session_inheritance())
