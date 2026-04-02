"""验证模型配置详情"""
import asyncio
from app.database import init_db, get_db_manager
from app.models.model import Model


async def verify_model():
    await init_db()
    db = get_db_manager()
    async with db.async_session_factory() as session:
        from sqlalchemy import select
        
        result = await session.execute(select(Model))
        models = result.scalars().all()
        
        print("=" * 80)
        print("模型配置详情")
        print("=" * 80)
        
        for m in models:
            print(f"\n模型 ID: {m.id}")
            print(f"名称：{m.name}")
            print(f"模型名：{m.model_name}")
            print(f"类型：{m.model_type}")
            print(f"最大 tokens (上下文长度): {m.max_tokens}")
            print(f"最大输出 tokens: {m.max_output_tokens}")
            print(f"Features: {m.features}")
            print(f"提供商 ID: {m.provider_id}")
            print("-" * 80)


if __name__ == "__main__":
    asyncio.run(verify_model())
