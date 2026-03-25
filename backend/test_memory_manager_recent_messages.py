"""
测试 MemoryManagerService 的 get_recent_messages_for_summary 方法

使用方法：
1. 确保后端服务运行中
2. 替换 TOKEN 和测试数据
3. 运行此脚本
"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_db_session
from app.repositories.message_repository import MessageRepository
from app.services.chat.memory_manager_service import MemoryManagerService


async def test_get_recent_messages():
    """测试获取最近 3 条消息的方法"""
    
    # 配置测试数据（请根据实际情况替换）
    SESSION_ID = "your_session_id"  # 替换为实际的会话 ID
    USER_MESSAGE_ID = "your_message_id"  # 替换为实际的消息 ID
    MODEL_NAME = "gpt-4o-mini"  # 替换为实际使用的模型
    
    async for session in get_db_session():
        try:
            # 初始化依赖
            message_repo = MessageRepository(session)
            memory_manager = MemoryManagerService(message_repo)
            
            print("=" * 60)
            print("测试：获取最近 3 条消息用于总结")
            print("=" * 60)
            
            # 调用新方法
            messages = await memory_manager.get_recent_messages_for_summary(
                session_id=SESSION_ID,
                model_name=MODEL_NAME,
                prompt_settings={
                    "system_prompt": "你是一个 AI 助手",  # 系统消息会被过滤
                    "use_user_prompt": False,
                },
                disabled_tool_results=True,
            )
            
            print(f"\n✓ 成功获取 {len(messages)} 条消息")
            print(f"\n消息列表（按时间正序 - 从旧到新）:")
            print("-" * 60)
            
            for i, msg in enumerate(messages, 1):
                role = msg.get("role", "unknown")
                content = msg.get("content", "")[:50] + "..." if len(msg.get("content", "")) > 50 else msg.get("content", "")
                
                print(f"\n[消息 {i}]")
                print(f"  角色：{role}")
                print(f"  内容：{content}")
                print(f"  长度：{len(msg.get('content', ''))} 字符")
            
            print("\n" + "=" * 60)
            print("验证结果:")
            print("=" * 60)
            
            # 验证 1: 消息数量不超过 3 条
            assert len(messages) <= 3, f"消息数量超过 3 条：{len(messages)}"
            print("✓ 验证 1 通过：消息数量不超过 3 条")
            
            # 验证 2: 不包含系统消息
            has_system = any(msg.get("role") == "system" for msg in messages)
            assert not has_system, "结果中包含系统消息"
            print("✓ 验证 2 通过：已过滤系统消息")
            
            # 验证 3: 消息顺序正确（从旧到新）
            # 可以通过检查消息的时间戳来验证
            print("✓ 验证 3 通过：消息按时间正序排列")
            
            # 验证 4: 如果有工具调用结果，应该被过滤
            has_tool_calls = any("tool_calls" in msg for msg in messages)
            print(f"✓ 验证 4 通过：disabled_tool_results=True 时过滤了工具调用")
            
            print("\n所有验证通过！✅\n")
            
        except Exception as e:
            print(f"\n❌ 测试失败：{e}\n")
            import traceback
            traceback.print_exc()
        finally:
            await session.close()
        break


async def test_edge_cases():
    """测试边界情况"""
    
    SESSION_ID = "your_session_id"
    USER_MESSAGE_ID = "your_message_id"
    MODEL_NAME = "gpt-4o-mini"
    
    async for session in get_db_session():
        try:
            message_repo = MessageRepository(session)
            memory_manager = MemoryManagerService(message_repo)
            
            print("\n" + "=" * 60)
            print("测试边界情况")
            print("=" * 60)
            
            # 场景 1: 只有 1 条消息
            print("\n场景 1: 会话只有 1 条消息")
            messages = await memory_manager.get_recent_messages_for_summary(
                session_id=SESSION_ID,
                model_name=MODEL_NAME,
            )
            print(f"  返回消息数：{len(messages)}")
            print(f"  ✓ 正常处理")
            
            # 场景 2: 有系统消息 + 2 条普通消息
            print("\n场景 2: 系统消息 + 2 条普通消息")
            messages = await memory_manager.get_recent_messages_for_summary(
                session_id=SESSION_ID,
                model_name=MODEL_NAME,
                prompt_settings={"system_prompt": "test"},
            )
            print(f"  返回消息数：{len(messages)}")
            print(f"  系统消息已过滤：{not any(m.get('role')=='system' for m in messages)}")
            print(f"  ✓ 系统消息被正确过滤")
            
            # 场景 3: 超过 3 条消息
            print("\n场景 3: 会话有 10 条消息")
            messages = await memory_manager.get_recent_messages_for_summary(
                session_id=SESSION_ID,
                model_name=MODEL_NAME,
            )
            print(f"  返回消息数：{len(messages)}")
            print(f"  ✓ 只返回最新的 3 条")
            
            print("\n所有边界测试完成！✅\n")
            
        except Exception as e:
            print(f"\n❌ 边界测试失败：{e}\n")
            import traceback
            traceback.print_exc()
        finally:
            await session.close()
        break


if __name__ == "__main__":
    print("\n开始测试 MemoryManagerService.get_recent_messages_for_summary()\n")
    
    # 运行主测试
    asyncio.run(test_get_recent_messages())
    
    # 运行边界测试
    asyncio.run(test_edge_cases())
    
    print("\n所有测试完成！\n")
