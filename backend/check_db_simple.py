"""检查数据库表结构（直接连接）"""
import sqlite3

conn = sqlite3.connect('data/app.db')
cursor = conn.cursor()

# 获取所有表
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = cursor.fetchall()

print("数据库中的表:")
for table in tables:
    print(f"  - {table[0]}")

# 检查 memory 表
if ('memory',) in tables:
    print("\n✓ Memory 表已存在！")
    cursor.execute("PRAGMA table_info(memory)")
    cols = cursor.fetchall()
    print("\nMemory 表的列:")
    for col in cols:
        print(f"  - {col[1]}: {col[2]}")
else:
    print("\n✗ Memory 表不存在！")

# 检查 session 表的 last_active_at 列
cursor.execute("PRAGMA table_info(session)")
cols = cursor.fetchall()
session_cols = [col[1] for col in cols]
if 'last_active_at' in session_cols:
    print("\n✓ Session 表包含 last_active_at 列！")
else:
    print("\n✗ Session 表缺少 last_active_at 列！")

conn.close()
