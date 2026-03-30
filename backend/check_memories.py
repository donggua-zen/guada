"""检查 memories 表结构"""
import sqlite3

conn = sqlite3.connect('data/app.db')
cursor = conn.cursor()

# 检查 memories 表
cursor.execute("PRAGMA table_info(memories)")
cols = cursor.fetchall()

print("Memories 表的列:")
for col in cols:
    print(f"  - {col[1]}: {col[2]} (nullable: {not col[3]})")

conn.close()
