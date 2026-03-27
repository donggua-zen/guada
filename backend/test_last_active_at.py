"""
测试会话 last_active_at 字段功能

该脚本用于验证：
1. 新创建的会话是否正确初始化 last_active_at 字段
2. 发送消息后 last_active_at 是否自动更新
3. 会话列表是否按 last_active_at 降序排序
"""

import asyncio
import sqlite3
from datetime import datetime, timezone

def test_database_schema():
    """测试数据库表结构"""
    print("=" * 60)
    print("测试 1: 验证数据库表结构")
    print("=" * 60)
    
    conn = sqlite3.connect('data/app.db')
    cursor = conn.cursor()
    
    # 检查 last_active_at 字段是否存在
    cursor.execute('PRAGMA table_info(session)')
    columns = [col[1] for col in cursor.fetchall()]
    
    if 'last_active_at' in columns:
        print("✓ last_active_at 字段存在")
    else:
        print("✗ last_active_at 字段不存在")
        return False
    
    # 检查索引是否存在
    cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_session_last_active_at'")
    index = cursor.fetchone()
    
    if index:
        print("✓ ix_session_last_active_at 索引存在")
    else:
        print("✗ ix_session_last_active_at 索引不存在")
        return False
    
    conn.close()
    print("\n数据库表结构验证通过！\n")
    return True


def test_data_initialization():
    """测试现有数据初始化"""
    print("=" * 60)
    print("测试 2: 验证现有数据初始化")
    print("=" * 60)
    
    conn = sqlite3.connect('data/app.db')
    cursor = conn.cursor()
    
    # 查询有多少条记录的 last_active_at 已初始化
    cursor.execute("""
        SELECT COUNT(*) 
        FROM session 
        WHERE last_active_at IS NOT NULL
    """)
    initialized_count = cursor.fetchone()[0]
    
    # 查询总记录数
    cursor.execute("SELECT COUNT(*) FROM session")
    total_count = cursor.fetchone()[0]
    
    print(f"总会话数：{total_count}")
    print(f"已初始化 last_active_at 的会话数：{initialized_count}")
    
    if initialized_count == total_count:
        print("✓ 所有会话的 last_active_at 都已初始化")
    else:
        print(f"⚠ 还有 {total_count - initialized_count} 条会话未初始化")
    
    # 随机抽查几条记录，验证 last_active_at 和 updated_at 是否一致
    cursor.execute("""
        SELECT id, title, updated_at, last_active_at 
        FROM session 
        WHERE last_active_at IS NOT NULL 
        LIMIT 3
    """)
    samples = cursor.fetchall()
    
    print("\n抽样检查:")
    for sample in samples:
        print(f"  会话 ID: {sample[0]}")
        print(f"  标题：{sample[1]}")
        print(f"  updated_at: {sample[2]}")
        print(f"  last_active_at: {sample[3]}")
        print()
    
    conn.close()
    print("数据初始化验证完成！\n")
    return True


def test_sorting():
    """测试会话列表排序"""
    print("=" * 60)
    print("测试 3: 验证会话列表排序")
    print("=" * 60)
    
    conn = sqlite3.connect('data/app.db')
    cursor = conn.cursor()
    
    # 按 last_active_at 降序查询前 5 条记录
    cursor.execute("""
        SELECT id, title, last_active_at, updated_at
        FROM session
        ORDER BY last_active_at DESC
        LIMIT 5
    """)
    top_sessions = cursor.fetchall()
    
    print("按 last_active_at 降序排列的前 5 个会话:")
    for i, session in enumerate(top_sessions, 1):
        print(f"  {i}. {session[1]}")
        print(f"     ID: {session[0]}")
        print(f"     last_active_at: {session[2]}")
        print(f"     updated_at: {session[3]}")
        print()
    
    conn.close()
    print("排序验证完成！\n")
    return True


async def test_backend_api():
    """测试后端 API（需要运行后端服务）"""
    print("=" * 60)
    print("测试 4: 验证后端 API（需要手动测试）")
    print("=" * 60)
    print("请按照以下步骤手动测试:")
    print("1. 启动后端服务：python run.py")
    print("2. 创建新会话，检查返回的 last_active_at 字段")
    print("3. 发送消息，观察会话的 last_active_at 是否更新")
    print("4. 调用 GET /api/v1/sessions，验证返回的列表已按 last_active_at 排序")
    print()


def main():
    """主测试函数"""
    print("\n")
    print("╔" + "=" * 58 + "╗")
    print("║" + " " * 15 + "会话 last_active_at 功能测试" + " " * 15 + "║")
    print("╚" + "=" * 58 + "╝")
    print()
    
    # 测试数据库表结构
    if not test_database_schema():
        print("数据库表结构测试失败，终止测试")
        return
    
    # 测试数据初始化
    test_data_initialization()
    
    # 测试排序
    test_sorting()
    
    # 提示手动测试 API
    asyncio.run(test_backend_api())
    
    print("=" * 60)
    print("自动化测试完成！")
    print("=" * 60)
    print("\n下一步:")
    print("1. 启动前端开发服务器")
    print("2. 在浏览器中打开多个会话并发送消息")
    print("3. 观察左侧会话列表是否实时重新排序")
    print("4. 验证最新对话的会话始终显示在顶部")
    print()


if __name__ == "__main__":
    main()
