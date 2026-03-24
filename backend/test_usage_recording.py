"""
测试 Usage 记录功能

该脚本用于验证 tokens 消耗数据是否正确保存到 MessageContent 的 meta_data 字段中。

使用方法：
1. 确保后端服务正在运行
2. 需要有有效的 session_id 和 message_id
3. 运行此脚本：python test_usage_recording.py

验证步骤：
1. 检查日志输出，确认有 "Tokens saved: ..." 信息
2. 查询数据库，验证 meta_data 包含 usage 字段
"""

import asyncio
import sys
import os
from datetime import datetime, timezone

# 设置路径
current_script_path = os.path.abspath(__file__)
current_directory = os.path.dirname(current_script_path)
sys.path.append(current_directory)
os.chdir(current_directory)

from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_manager
from app.models.message_content import MessageContent
from sqlalchemy import select


async def verify_usage_in_db(message_content_id: str):
    """验证数据库中是否保存了 usage 信息"""
    print(f"\n=== 验证数据库记录 ===")
    print(f"MessageContent ID: {message_content_id}")
    
    db_manager = get_db_manager()
    async with db_manager.async_session_factory() as session:
        stmt = select(MessageContent).filter(MessageContent.id == message_content_id)
        result = await session.execute(stmt)
        message_content = result.scalar_one_or_none()
        
        if message_content is None:
            print(f"❌ 未找到 MessageContent 记录")
            return False
        
        print(f"✅ 找到 MessageContent 记录")
        print(f"   Content: {message_content.content[:50] if message_content.content else 'None'}...")
        print(f"   MetaData: {message_content.meta_data}")
        
        # 检查 usage 字段
        if message_content.meta_data and "usage" in message_content.meta_data:
            usage = message_content.meta_data["usage"]
            print(f"\n✅ SUCCESS! Usage 信息已保存:")
            print(f"   - Prompt Tokens: {usage.get('prompt_tokens', 'N/A')}")
            print(f"   - Completion Tokens: {usage.get('completion_tokens', 'N/A')}")
            print(f"   - Total Tokens: {usage.get('total_tokens', 'N/A')}")
            return True
        else:
            print(f"\n❌ WARNING: MetaData 中没有 usage 字段")
            print(f"   MetaData keys: {list(message_content.meta_data.keys()) if message_content.meta_data else 'None'}")
            return False


async def test_recent_message():
    """测试最近一条消息的 usage 记录"""
    print("=== 检查最近的消息记录 ===\n")
    
    db_manager = get_db_manager()
    async with db_manager.async_session_factory() as session:
        # 获取最近创建的 5 条 MessageContent
        stmt = (
            select(MessageContent)
            .order_by(MessageContent.created_at.desc())
            .limit(5)
        )
        result = await session.execute(stmt)
        recent_contents = result.scalars().all()
        
        if not recent_contents:
            print("❌ 没有找到任何 MessageContent 记录")
            return
        
        print(f"找到 {len(recent_contents)} 条最近的 MessageContent:\n")
        
        for i, content in enumerate(recent_contents, 1):
            print(f"{i}. ID: {content.id}")
            print(f"   Created: {content.created_at}")
            print(f"   Model: {content.meta_data.get('model_name', 'N/A') if content.meta_data else 'N/A'}")
            
            if content.meta_data and "usage" in content.meta_data:
                usage = content.meta_data["usage"]
                print(f"   ✅ Has Usage: prompt={usage.get('prompt_tokens')}, completion={usage.get('completion_tokens')}, total={usage.get('total_tokens')}")
            else:
                print(f"   ❌ No Usage info")
            
            if content.meta_data and "thinking_duration_ms" in content.meta_data:
                print(f"   ⏱ Thinking Duration: {content.meta_data['thinking_duration_ms']}ms")
            
            print()


async def main():
    print("=" * 60)
    print("Usage 记录功能测试")
    print("=" * 60)
    
    # 测试 1: 检查最近的消息
    await test_recent_message()
    
    # 测试 2: 如果有特定 ID，可以详细验证
    if len(sys.argv) > 1:
        message_content_id = sys.argv[1]
        success = await verify_usage_in_db(message_content_id)
        if success:
            print("\n✅ 测试通过!")
        else:
            print("\n⚠️  测试完成，但未找到 usage 信息（可能是历史消息）")
    else:
        print("\n💡 提示：可以传入 MessageContent ID 进行详细验证")
        print(f"   用法：python {sys.argv[0]} <message_content_id>")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
    except Exception as e:
        print(f"\n❌ 测试失败：{e}")
        import traceback
        traceback.print_exc()
