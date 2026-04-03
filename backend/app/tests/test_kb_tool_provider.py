"""
知识库工具提供者测试脚本

用于验证 KnowledgeBaseToolProvider 的功能是否正常
"""

import asyncio
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.database import ModelBase
from app.services.tools.providers.knowledge_base_tool_provider import (
    KnowledgeBaseToolProvider,
)
from app.services.tools.providers.tool_provider_base import ToolCallRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# 数据库配置（根据实际情况修改）
DATABASE_URL = "sqlite+aiosqlite:///./data/app.db"


async def test_knowledge_base_tool_provider():
    """测试知识库工具提供者"""

    # 创建测试数据库会话
    engine = create_async_engine(DATABASE_URL, echo=True)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # 初始化工具提供者
        provider = KnowledgeBaseToolProvider(session)

        logger.info("=" * 80)
        logger.info("测试 1: 获取工具列表")
        logger.info("=" * 80)

        tools = await provider._get_tools_internal(enabled_ids=True)
        logger.info(f"获取到 {len(tools)} 个工具:")
        for tool in tools:
            logger.info(f"  - {tool['function']['name']}: {tool['function']['description']}")

        logger.info("\n" + "=" * 80)
        logger.info("测试 2: 获取带命名空间的工具列表")
        logger.info("=" * 80)

        namespaced_tools = await provider.get_tools_namespaced(enabled_ids=True)
        logger.info(f"获取到 {len(namespaced_tools)} 个带命名空间的工具:")
        for tool in namespaced_tools:
            logger.info(f"  - {tool['function']['name']}")

        logger.info("\n" + "=" * 80)
        logger.info("测试 3: 测试工具调用（需要真实数据）")
        logger.info("=" * 80)

        # 注意：以下测试需要真实的数据库记录
        # 请根据实际情况修改参数

        # 测试搜索工具
        search_request = ToolCallRequest(
            id="test_search_001",
            name="search",
            arguments={
                "knowledge_base_id": "your_kb_id_here",
                "query": "测试查询",
                "top_k": 5,
            },
        )

        inject_params = {"user_id": "your_user_id_here"}

        try:
            search_response = await provider.execute_with_namespace(
                search_request, inject_params
            )
            logger.info(f"\n🔍 搜索结果:\n{search_response.content}")
        except Exception as e:
            logger.error(f"❌ 搜索失败：{e}")

        # 测试文件列表工具
        list_files_request = ToolCallRequest(
            id="test_list_files_001",
            name="list_files",
            arguments={
                "knowledge_base_id": "your_kb_id_here",
            },
        )

        try:
            list_files_response = await provider.execute_with_namespace(
                list_files_request, inject_params
            )
            logger.info(f"\n📚 文件列表:\n{list_files_response.content}")
        except Exception as e:
            logger.error(f"❌ 获取文件列表失败：{e}")

        # 测试分块详情工具
        get_chunks_request = ToolCallRequest(
            id="test_get_chunks_001",
            name="get_chunks",
            arguments={
                "knowledge_base_id": "your_kb_id_here",
                "file_id": "your_file_id_here",
                "chunk_index": 0,
                "limit": 5,
            },
        )

        try:
            get_chunks_response = await provider.execute_with_namespace(
                get_chunks_request, inject_params
            )
            logger.info(f"\n📖 分块详情:\n{get_chunks_response.content}")
        except Exception as e:
            logger.error(f"❌ 获取分块详情失败：{e}")

        logger.info("\n" + "=" * 80)
        logger.info("测试 4: 获取提示词注入")
        logger.info("=" * 80)

        prompt = await provider.get_prompt(inject_params)
        logger.info(f"提示词长度：{len(prompt)} 字符")
        logger.info(f"\n📝 提示词内容:\n{prompt[:500]}...")  # 只显示前 500 字符

    logger.info("\n" + "=" * 80)
    logger.info("所有测试完成！")
    logger.info("=" * 80)


if __name__ == "__main__":
    asyncio.run(test_knowledge_base_tool_provider())
