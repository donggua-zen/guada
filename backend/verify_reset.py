"""验证数据库重置结果"""
import asyncio
from app.database import get_db_manager, init_db
from app.models.model_provider import ModelProvider
from app.models.model import Model
from app.models.user import User
from app.models.character import Character


async def verify():
    # 初始化数据库
    await init_db()
    db = get_db_manager()
    async with db.async_session_factory() as session:
        from sqlalchemy import select
        
        # 检查用户
        result = await session.execute(select(User))
        users = result.scalars().all()
        print("=" * 60)
        print("用户列表:")
        for user in users:
            print(f"  - ID: {user.id}")
            print(f"    邮箱：{user.email}")
            print(f"    昵称：{user.nickname}")
            print(f"    角色：{user.role}")
        
        # 检查模型提供商
        result = await session.execute(select(ModelProvider))
        providers = result.scalars().all()
        print("\n" + "=" * 60)
        print("模型提供商:")
        for p in providers:
            print(f"  - ID: {p.id}")
            print(f"    名称：{p.name}")
            print(f"    提供商：{p.provider}")
            print(f"    API URL: {p.api_url}")
            print(f"    API Key: {p.api_key[:10]}...{p.api_key[-5:]}")
        
        # 检查模型
        result = await session.execute(select(Model))
        models = result.scalars().all()
        print("\n" + "=" * 60)
        print("模型列表:")
        for m in models:
            print(f"  - ID: {m.id}")
            print(f"    名称：{m.name}")
            print(f"    模型名：{m.model_name}")
            print(f"    类型：{m.model_type}")
            print(f"    提供商 ID: {m.provider_id}")
        
        # 检查角色
        result = await session.execute(select(Character))
        characters = result.scalars().all()
        print("\n" + "=" * 60)
        print("角色列表:")
        for c in characters:
            print(f"  - ID: {c.id}")
            print(f"    标题：{c.title}")
            print(f"    模型 ID: {c.model_id}")


if __name__ == "__main__":
    asyncio.run(verify())
