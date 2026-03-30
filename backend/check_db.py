"""检查数据库表结构"""
import asyncio
from app.database import get_db_manager
from sqlalchemy import inspect

async def check():
    db = await get_db_manager().__anext__()
    
    # 检查 session 表
    cols = await db.run_sync(lambda ctx: inspect(ctx.connection).get_columns('session'))
    print("Session 表的列:")
    for col in cols:
        print(f"  - {col['name']}: {col['type']}")
    
    # 检查 memory 表是否存在
    try:
        cols = await db.run_sync(lambda ctx: inspect(ctx.connection).get_columns('memory'))
        print("\nMemory 表的列:")
        for col in cols:
            print(f"  - {col['name']}: {col['type']}")
    except Exception as e:
        print(f"\nMemory 表不存在：{e}")
    
    await db.close()

if __name__ == "__main__":
    asyncio.run(check())
