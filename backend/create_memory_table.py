"""
手动创建记忆表（用于开发环境）

直接在数据库中创建 memories 表，无需 alembic
"""

import sys
import asyncio
from pathlib import Path
from dotenv import load_dotenv
import os

# 添加项目路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

load_dotenv()

from sqlalchemy.ext.asyncio import create_async_engine
from app.database import ModelBase
from app.models.memory import Memory


async def create_memory_table():
    """创建记忆表"""
    # 从环境变量获取数据库 URL
    database_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/app.db")
    
    print(f"🔧 Connecting to database: {database_url}")
    
    # 创建引擎
    engine = create_async_engine(database_url, echo=True)
    
    try:
        # 创建所有表（包括 Memory）
        async with engine.begin() as conn:
            print("🚀 Creating memories table...")
            await conn.run_sync(ModelBase.metadata.create_all)
        
        print("✅ Memories table created successfully!")
        
        # 验证表是否存在
        async with engine.connect() as conn:
            result = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
                if 'sqlite' in database_url
                else "SELECT table_name FROM information_schema.tables WHERE table_name = 'memories'"
            )
            row = result.fetchone()
            
            if row:
                print("✓ Verified: memories table exists")
            else:
                print("❌ Warning: memories table not found!")
    
    except Exception as e:
        print(f"❌ Error creating table: {e}")
        import traceback
        traceback.print_exc()
        raise
    
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(create_memory_table())
