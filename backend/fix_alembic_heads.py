"""清理 alembic_version 表并重新设置正确的版本"""
import sqlite3

# 连接数据库
conn = sqlite3.connect('data/app.db')
cursor = conn.cursor()

# 清空 alembic_version 表
print("清空 alembic_version 表...")
cursor.execute("DELETE FROM alembic_version")

# 插入所有 heads（因为它们是独立的分支）
heads = [
    'add_character_id_to_session',  # d8dc8ea173ed
    'add_file_metadata',            # 9f86a5e9f00d
    'add_last_active_at_to_session',# add_last_active_at_to_session
    'auto_generated_memory',        # auto_generated_memory
]

print("\n标记所有 heads 为已执行:")
for head in heads:
    cursor.execute("INSERT INTO alembic_version (version_num) VALUES (?)", (head,))
    print(f"  ✓ {head}")

conn.commit()

# 验证
print("\n当前的 heads:")
cursor.execute("SELECT * FROM alembic_version")
versions = cursor.fetchall()
for v in versions:
    print(f"  - {v[0]}")

conn.close()
print("\n完成！现在可以运行 alembic upgrade heads")
