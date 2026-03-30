"""手动标记迁移为已执行"""
import sqlite3

# 连接数据库
conn = sqlite3.connect('data/app.db')
cursor = conn.cursor()

# 查看已执行的迁移
print("已执行的迁移:")
cursor.execute("SELECT * FROM alembic_version")
versions = cursor.fetchall()
for v in versions:
    print(f"  - {v}")

# 插入新的迁移版本（如果不存在）
new_versions = [
    ('auto_generated_memory',),
    ('add_last_active_at_to_session',),
]

for version in new_versions:
    try:
        cursor.execute("INSERT INTO alembic_version (version_num) VALUES (?)", version)
        print(f"✓ 标记迁移为已执行：{version[0]}")
    except sqlite3.IntegrityError:
        print(f"⚠ 迁移已存在：{version[0]}")

conn.commit()

# 再次查看
print("\n更新后的迁移列表:")
cursor.execute("SELECT * FROM alembic_version ORDER BY version_num DESC")
versions = cursor.fetchall()
for i, v in enumerate(versions):
    print(f"  {i+1}. {v[0]}")

conn.close()
print("\n完成！")
