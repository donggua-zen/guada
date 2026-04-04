"""
数据库重置脚本

用于安全地删除所有表、重建表结构并导入默认测试数据

使用方法:
    python reset_database.py           # 交互式，需要确认
    python reset_database.py --force   # 强制模式，无需确认
"""

import asyncio
import sys
import os
from pathlib import Path
from datetime import datetime, timezone
import argparse
import logging

# 添加项目根目录到路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            backend_dir / "logs" / "reset_database.log", encoding="utf-8", mode="w"
        ),
    ],
)
logger = logging.getLogger("reset_database")

# 解决 Windows 控制台 Unicode 编码问题
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        # Python 3.6 及以下不支持 reconfigure
        import codecs

        sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")

logger.info("开始加载重置脚本...")

logger.info("正在导入数据库模块...")
from app.database import init_db, get_db_manager, close_db, ModelBase

logger.info("正在导入配置...")
from app.config import settings

logger.info("正在导入安全模块...")
from app.security import hash_password
import ulid

# 导入所有模型（确保表元数据已注册）
logger.info("正在导入用户模型...")
from app.models.user import User

logger.info("正在导入模型提供商...")
from app.models.model_provider import ModelProvider

logger.info("正在导入模型...")
from app.models.model import Model

logger.info("正在导入角色...")
from app.models.character import Character

logger.info("正在导入会话...")
from app.models.session import Session

logger.info("正在导入全局设置...")
from app.models.globa_setting import GlobalSetting

logger.info("正在导入记忆...")
from app.models.memory import Memory

logger.info("正在导入消息...")
from app.models.message import Message

logger.info("正在导入消息内容...")
from app.models.message_content import MessageContent

logger.info("正在导入文件...")
from app.models.file import File

logger.info("正在导入知识库文件...")
from app.models.kb_file import KBFile

logger.info("正在导入知识库块...")
from app.models.kb_chunk import KBChunk

logger.info("正在导入摘要...")
from app.models.summary import Summary

logger.info("正在导入 MCP 服务器...")
from app.models.mcp_server import MCPServer

logger.info("正在导入用户设置...")
from app.models.user_setting import UserSetting

logger.info("所有模型导入完成")


async def create_default_user(session):
    """创建默认管理员用户"""
    logger.info("正在创建默认管理员用户...")

    user = User(
        id=str(ulid.new()),
        role="primary",
        nickname="管理员",
        phone="13800138000",
        email="admin@dingd.cn",
        password_hash=hash_password("123456"),
    )

    session.add(user)
    await session.commit()
    await session.refresh(user)

    logger.info("OK: 已创建管理员用户：%s / %s", user.email, "123456")
    return user


async def create_model_provider(session, user_id: str):
    """创建默认模型提供商"""
    logger.info("正在创建模型提供商...")

    provider = ModelProvider(
        id=str(ulid.new()),
        user_id=user_id,
        name="硅基流动",
        provider="siliconflow",
        api_url="https://api.siliconflow.cn/v1/",
        api_key="ccdjtlfjhfrkyhcsiijmwahhxaqnfplyaesoqigjvbizbmsy",
    )

    session.add(provider)
    await session.commit()
    await session.refresh(provider)

    logger.info("OK: 已创建模型提供商：%s", provider.name)
    return provider


async def create_models(session, provider: ModelProvider):
    """创建默认模型列表"""
    logger.info("正在创建默认模型...")

    models_data = [
        {
            "model_name": "deepseek-ai/DeepSeek-V3.2",
            "name": "DeepSeek V3.2",
            "model_type": "text",
            "max_tokens": 128000,
            "max_output_tokens": 4096,
            "features": ["thinking", "tools"],
        },
        {
            "model_name": "Qwen/Qwen3-Embedding-8B",
            "name": "Qwen3 Embedding 8B",
            "model_type": "embedding",
            "max_tokens": 32000,
            "max_output_tokens": None,
            "features": ["embedding"],
        },
    ]

    created_models = []
    for model_data in models_data:
        model = Model(
            id=str(ulid.new()),
            name=model_data["name"],
            provider_id=provider.id,
            model_name=model_data["model_name"],
            model_type=model_data["model_type"],
            max_tokens=model_data["max_tokens"],
            max_output_tokens=model_data["max_output_tokens"],
            features=model_data["features"],
        )
        session.add(model)
        created_models.append(model)

    await session.commit()

    for model in created_models:
        await session.refresh(model)
        logger.info("OK: 已创建模型：%s (%s)", model.name, model.model_name)

    return created_models


async def create_character(session, user_id: str, model_id: str):
    """创建示例角色"""
    logger.info("正在创建示例角色...")

    character = Character(
        id="character_assistant_001",
        user_id=user_id,
        title="智能助手",
        description="一个友好、专业的 AI 助手，可以帮助你解答各种问题。",
        avatar_url="/static/avatars/default.png",
        is_public=True,
        model_id=model_id,
        settings={
            "system_prompt": "你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。",
            "temperature": 0.7,
            "max_tokens": 2048,
        },
    )

    session.add(character)
    await session.commit()
    await session.refresh(character)

    logger.info("OK: 已创建示例角色：%s", character.title)
    return character


async def create_global_settings(session):
    """创建全局设置"""
    logger.info("正在创建全局设置...")

    from sqlalchemy import select

    # 查找第一个文本模型作为默认聊天模型
    result = await session.execute(
        select(Model).where(Model.model_type == "text").limit(1)
    )
    chat_model = result.scalar_one_or_none()

    settings_data = [
        {
            "key": "default_chat_model",
            "value": chat_model.id if chat_model else "",
            "value_type": "str",
            "description": "默认聊天模型 ID",
            "category": "model",
        },
        {
            "key": "max_upload_size_mb",
            "value": "10",
            "value_type": "int",
            "description": "最大上传文件大小（MB）",
            "category": "system",
        },
        {
            "key": "allowed_file_types",
            "value": '["txt", "pdf", "docx", "md", "json"]',
            "value_type": "json",
            "description": "允许上传的文件类型",
            "category": "system",
        },
    ]

    for setting_data in settings_data:
        setting = GlobalSetting(**setting_data)
        session.add(setting)

    await session.commit()
    logger.info("OK: 已创建全局设置")


async def import_default_data(session):
    """导入所有默认测试数据"""
    logger.info("=" * 60)
    logger.info("步骤 2: 导入默认测试数据")
    logger.info("=" * 60)

    try:
        from sqlalchemy import select

        # 1. 创建管理员用户
        admin_user = await create_default_user(session)

        # 2. 创建模型提供商
        provider = await create_model_provider(session, admin_user.id)

        # 3. 创建模型
        models = await create_models(session, provider)

        # 找到第一个文本模型（用于聊天）
        chat_model = next((m for m in models if m.model_type == "text"), None)

        if not chat_model:
            raise ValueError("未找到文本模型")

        # 4. 创建示例角色
        await create_character(session, admin_user.id, chat_model.id)

        # 5. 创建全局设置
        await create_global_settings(session)

        logger.info("OK: 所有默认数据导入完成")

    except Exception as e:
        await session.rollback()
        logger.error(f"ERROR: 导入默认数据失败：{e}")
        raise


async def reset_database(force: bool = False):
    """
    重置整个数据库

    Args:
        force: 如果为 True，则跳过确认提示
    """
    logger.info("=" * 60)
    logger.info("数据库重置工具")
    logger.info("=" * 60)
    logger.info(f"数据库 URL: {settings.DATABASE_URL}")
    logger.info(f"时间：{datetime.now(timezone.utc).isoformat()}")
    logger.info("=" * 60)

    # 警告提示
    if not force:
        print("\n 警告：此操作将执行以下动作：")
        print("   1. 删除数据库中所有现有表（不可恢复！）")
        print("   2. 重新创建所有数据库表")
        print("   3. 导入默认测试数据")
        print("\n📌 确保你已经备份了重要数据！\n")

        response = input("是否继续？请输入 'yes' 确认：")
        if response.lower() != "yes":
            logger.info("用户取消操作")
            return

        print("\n开始执行...\n")

    try:
        # 初始化数据库
        logger.info("正在初始化数据库连接...")
        await init_db()
        logger.info("✓ 数据库连接成功")

        # 获取数据库管理器
        db_manager = get_db_manager()

        # 步骤 1: 删除数据库文件（如果存在）并重新创建
        logger.info("=" * 60)
        logger.info("步骤 1: 删除数据库文件并重新创建表")
        logger.info("=" * 60)

        # 如果是 SQLite，先删除数据库文件
        if settings.DATABASE_URL.startswith("sqlite"):
            # 从 DATABASE_URL 提取数据库文件路径
            # 格式：sqlite+aiosqlite:///path/to/db.db 或 sqlite+aiosqlite:///:memory:
            db_url = settings.DATABASE_URL.replace("sqlite+aiosqlite://", "")

            # 处理相对路径和绝对路径
            if db_url.startswith("/"):
                db_file = Path(db_url.lstrip("/"))
            elif db_url == ":memory:":
                db_file = None
            else:
                # 相对路径，相对于 backend 目录
                db_file = backend_dir / db_url

            if db_file and db_file.exists():
                db_file.unlink()
                logger.info("OK: 已删除数据库文件：%s", db_file)

            # 删除 -wal 和 -shm 文件（SQLite WAL 模式产生的）
            if db_file:
                for ext in ["-wal", "-shm"]:
                    wal_file = Path(str(db_file) + ext)
                    if wal_file.exists():
                        wal_file.unlink()
                        logger.info("OK: 已删除：%s", wal_file)

        # 创建所有表
        async with db_manager.engine.begin() as conn:
            await conn.run_sync(ModelBase.metadata.create_all)
        logger.info("OK: 数据库表创建成功")

        # 步骤 2: 导入默认数据
        async with db_manager.async_session_factory() as session:
            try:
                await import_default_data(session)
            except Exception as e:
                await session.rollback()
                raise

        logger.info("=" * 60)
        logger.info("数据库重置完成！")
        logger.info("=" * 60)
        logger.info("\n默认登录信息:")
        logger.info("  邮箱：admin@example.com")
        logger.info("  密码：admin123")
        logger.info("\n请查看日志文件获取详细信息：logs/reset_database.log")
        logger.info("=" * 60)

    except Exception as e:
        logger.error("=" * 60)
        logger.error(f"❌ 重置失败：{e}")
        logger.error("=" * 60)
        logger.exception("详细错误信息:")
        raise
    finally:
        # 关闭数据库连接
        await close_db()
        logger.info("数据库连接已关闭")


def main():
    """主函数"""
    logger.info("正在启动主函数...")
    parser = argparse.ArgumentParser(
        description="重置数据库（清空数据 + 重建表 + 导入默认数据）"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制模式，跳过确认提示",
    )

    args = parser.parse_args()
    logger.info(f"命令行参数：{args}")

    # 确保日志目录存在
    (backend_dir / "logs").mkdir(exist_ok=True)

    # 运行异步函数
    logger.info("正在调用 asyncio.run(reset_database)...")
    asyncio.run(reset_database(force=args.force))
    logger.info("asyncio.run 执行完成")


if __name__ == "__main__":
    logger.info("脚本开始执行，__name__ == '__main__'")
    main()
