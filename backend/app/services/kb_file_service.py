"""
知识库文件服务

负责知识库文件的完整处理流程：
1. 文件上传和保存
2. 文件解析（多种格式支持）
3. 文本分块
4. 向量化处理
5. 存储到 ChromaDB
6. 进度追踪和状态管理

关键特性：
- 使用 asyncio.Semaphore 控制并发（文件依次处理）
- 后台任务持久化（不依赖前端连接）
- 详细的进度更新和错误处理
"""

import asyncio
import hashlib
import logging
import aiofiles
from pathlib import Path
from typing import Optional, Dict, List
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.model_repository import ModelRepository
from app.services.file_parser_service import FileParserService
from app.services.chunking_service import ChunkingService
from app.services.vector_service import VectorService
from app.repositories.kb_repository import KBRepository
from app.repositories.kb_file_repository import KBFileRepository
from app.repositories.kb_chunk_repository import KBChunkRepository
from app.models.knowledge_base import KnowledgeBase
from app.utils import upload_paths

logger = logging.getLogger(__name__)


class KBFileService:
    """知识库文件服务"""

    # 类级别的信号量，控制同时只有一个文件在处理
    _processing_semaphore: Optional[asyncio.Semaphore] = None

    def __init__(self, session: AsyncSession):
        """
        初始化文件服务

        Args:
            session: 数据库会话
        """

        # 这里不使用依赖注入，是因为可能需要独立的数据库session
        self.session = session
        self.kb_repo = KBRepository(session)
        self.file_repo = KBFileRepository(session)
        self.chunk_repo = KBChunkRepository(session)
        self.parser_service = FileParserService()
        self.chunking_service: Optional[ChunkingService] = None
        self.vector_service = VectorService()
        self.model_repo = ModelRepository(session)

        # 初始化信号量（确保全局唯一）
        if KBFileService._processing_semaphore is None:
            KBFileService._processing_semaphore = asyncio.Semaphore(1)
            logger.info("初始化文件处理信号量（并发数=1）")

    async def process_file(
        self,
        file_id: str,
    ) -> Optional[str]:
        """
        处理知识库文件（主入口）

        Args:
            file_id: 文件 ID

        Returns:
            Optional[str]: 文件 ID，处理失败返回 None

        Raises:
            RuntimeError: 处理失败
        """
        # 获取信号量
        semaphore = KBFileService._processing_semaphore

        async with semaphore:
            try:
                # 1. 查询文件记录
                file_record = await self.file_repo.get_file(file_id)
                if not file_record:
                    logger.error(f"❌ 文件记录不存在：{file_id}")
                    return None

                knowledge_base_id = file_record.knowledge_base_id
                file_name = file_record.file_name
                display_name = file_record.display_name
                file_size = file_record.file_size
                file_type = file_record.file_type
                file_extension = file_record.file_extension
                file_path = upload_paths.build_knowledge_base_save_path(file_name)
                content = file_record.content

                logger.info(
                    f"开始处理文件：{display_name} (KB: {knowledge_base_id}, ID: {file_id})"
                )

                # 1. 获取知识库配置
                kb = await self.kb_repo.get_kb(knowledge_base_id)
                if not kb:
                    raise RuntimeError(f"知识库不存在：{knowledge_base_id}")

                if not file_record:
                    # ⚠️ 文件记录不存在，可能是上传过程出现问题
                    logger.warning(
                        f"⚠️ 文件记录不存在，跳过处理："
                        f"KB={knowledge_base_id}, file={file_name}, hash={content_hash[:16]}..."
                    )
                    return None

                logger.info(f"检测到文件记录：{file_id}")

                # 如果文件之前处理失败，重置状态为 pending
                # if existing_file.processing_status == "failed":
                #     await self.file_repo.update_processing_status(
                #         file_id=file_id,
                #         status="pending",
                #         progress=0,
                #         current_step="等待重新处理...",
                #     )

                # 3. 更新状态为处理中
                await self.file_repo.update_processing_status(
                    file_id=file_id,
                    status="processing",
                    progress=10,
                    current_step="正在解析文件...",
                )

                # 提交会话
                await self.file_repo.session.commit()

                # 4. 解析文件内容
                if not content:
                    content = await self.parser_service.parse_file_from_path(file_path)

                await self.file_repo.update_processing_status(
                    file_id=file_id,
                    status="processing",
                    progress=30,
                    current_step="文件解析完成，正在分块...",
                )

                await self.file_repo.session.commit()

                # 5. 初始化分块服务
                self.chunking_service = ChunkingService(
                    max_chunk_size=kb.chunk_max_size,
                    overlap_size=kb.chunk_overlap_size,
                    min_chunk_size=kb.chunk_min_size,
                )

                # 6. 文本分块
                chunks = await self.chunking_service.chunk_text(
                    text=content,
                    metadata={
                        "file_id": file_id,
                        "knowledge_base_id": knowledge_base_id,
                        "file_name": display_name,
                    },
                )

                total_chunks = len(chunks)
                logger.info(f"文本分块完成：共{total_chunks}个分块")

                await self.file_repo.update_processing_status(
                    file_id=file_id,
                    status="processing",
                    progress=50,
                    current_step=f"分块完成（{total_chunks}个），正在向量化...",
                )

                await self.file_repo.session.commit()

                # 6.5 清理旧数据（重新处理场景）
                # 在向量化和存储之前，先删除该文件已存在的旧分块记录和向量数据
                try:
                    logger.info(f"🔄 检测到文件 {file_id}，开始清理旧数据...")
                    
                    # 1. 从 ChromaDB 删除旧向量（使用 metadata 条件删除）
                    try:
                        await self.vector_service.delete_vectors_by_where(
                            knowledge_base_id=knowledge_base_id,
                            where_filter={"file_id": file_id}
                        )
                        logger.info(f"✅ 从向量库删除文件 {file_id} 的旧向量")
                    except Exception as e:
                        # 向量删除失败不影响后续流程，但记录详细日志
                        logger.warning(f"⚠️ 向量库删除失败，但不影响后续处理：{e}")

                    # 2. 从数据库删除旧分块记录
                    deleted_count = await self.chunk_repo.delete_chunks_by_file(file_id)
                    if deleted_count > 0:
                        logger.info(f"✅ 删除 {deleted_count} 个旧分块记录")
                    else:
                        logger.debug(f"ℹ️ 文件 {file_id} 没有旧分块记录")
                        
                except Exception as e:
                    # 清理旧数据失败不影响后续流程，继续执行向量化和存储
                    logger.warning(f"⚠️ 清理旧数据失败，但继续执行后续流程：{e}")

                # 7. 批量向量化
                all_embeddings: List[List[float]] = []

                model = await self.model_repo.get_model(kb.embedding_model_id)

                if not model:
                    raise RuntimeError(f"向量模型不存在：{kb.embedding_model_id}")

                base_url = model.provider.api_url
                api_key = model.provider.api_key
                model_name = model.model_name
                logger.info(f"使用向量模型：provider={base_url}, model={model_name}")

                for idx, chunk in enumerate(chunks):
                    try:
                        embedding = await self.vector_service.get_embedding(
                            text=chunk["content"],
                            base_url=base_url,
                            api_key=api_key,
                            model_name=model_name,
                        )
                        all_embeddings.append(embedding)

                        # 每处理 10 个分块更新一次进度
                        if (idx + 1) % 10 == 0 or idx == total_chunks - 1:
                            progress = 50 + int((idx + 1) / total_chunks * 40)
                            await self.file_repo.update_processing_status(
                                file_id=file_id,
                                status="processing",
                                progress=progress,
                                current_step=f"正在向量化 ({idx + 1}/{total_chunks})...",
                            )
                            await self.file_repo.session.commit()

                    except Exception as e:
                        logger.error(f"第{idx}个分块向量化失败：{e}")
                        raise RuntimeError(f"分块 {idx} 向量化失败：{str(e)}")

                # 8. 保存到 ChromaDB
                await self.vector_service.add_chunks_to_collection(
                    knowledge_base_id=knowledge_base_id,
                    chunks=chunks,
                    embeddings=all_embeddings,
                )

                await self.file_repo.update_processing_status(
                    file_id=file_id,
                    status="processing",
                    progress=95,
                    current_step="正在保存分块到数据库...",
                )
                await self.file_repo.session.commit()

                # 9. 保存到数据库
                for idx, chunk in enumerate(chunks):
                    await self.chunk_repo.create_chunk(
                        file_id=file_id,
                        knowledge_base_id=knowledge_base_id,
                        content=chunk["content"],
                        chunk_index=chunk["chunk_index"],
                        vector_id=f"chunk_{idx}_{file_id}",
                        embedding_dimensions=len(all_embeddings[idx]),
                        token_count=self.chunking_service.estimate_token_count(
                            chunk["content"]
                        ),
                        metadata=chunk.get("metadata"),
                    )

                # 10. 标记为完成
                await self.file_repo.update_processing_status(
                    file_id=file_id,
                    status="completed",
                    progress=100,
                    current_step="处理完成",
                    total_chunks=total_chunks,
                    total_tokens=sum(
                        self.chunking_service.estimate_token_count(c["content"])
                        for c in chunks
                    ),
                )
                await self.file_repo.session.commit()

                logger.info(f"文件处理完成：{display_name}, 分块数={total_chunks}")
                return file_id

            except Exception as e:
                logger.exception(f"文件处理失败：{display_name}, error={e}")

                # 更新状态为失败
                if file_id:
                    await self.file_repo.update_processing_status(
                        file_id=file_id,
                        status="failed",
                        progress=0,
                        current_step="处理失败",
                        error_message=str(e),
                    )
                    logger.error(f"文件处理失败：{display_name}, error={e}")

    async def _calculate_file_hash(self, file_path: str) -> str:
        """计算文件 SHA256 哈希值"""
        sha256_hash = hashlib.sha256()

        async with aiofiles.open(file_path, "rb") as f:
            while chunk := await f.read(8192):
                sha256_hash.update(chunk)

        return sha256_hash.hexdigest()

    async def get_file_processing_status(self, file_id: str) -> Optional[Dict]:
        """
        获取文件处理状态

        Args:
            file_id: 文件 ID

        Returns:
            Optional[Dict]: 处理状态信息，包括 status, progress, current_step, error_message 等
        """
        file_record = await self.file_repo.get_file(file_id)

        if not file_record:
            return None

        return {
            "id": file_record.id,
            "file_name": file_record.display_name,
            "processing_status": file_record.processing_status,
            "progress_percentage": file_record.progress_percentage,
            "current_step": file_record.current_step,
            "error_message": file_record.error_message,
            "total_chunks": file_record.total_chunks,
            "uploaded_at": (
                file_record.uploaded_at.isoformat() if file_record.uploaded_at else None
            ),
            "processed_at": (
                file_record.processed_at.isoformat()
                if file_record.processed_at
                else None
            ),
        }

    async def delete_file_and_chunks(self, file_id: str) -> bool:
        """
        删除文件及其所有分块（包括向量库中的向量）

        Args:
            file_id: 文件 ID

        Returns:
            bool: 是否成功删除
        """
        try:
            file_record = await self.file_repo.get_file(file_id)

            if not file_record:
                return False

            kb_id = file_record.knowledge_base_id

            # 1. 从 ChromaDB 删除向量（使用 metadata 条件删除，无需先查询 vector_id）
            try:
                # ✅ 优化：直接使用 where 条件删除，减少一次数据库查询
                # ChromaDB 支持通过 metadata 过滤删除：collection.delete(where={"file_id": file_id})
                await self.vector_service.delete_vectors_by_where(
                    knowledge_base_id=kb_id,
                    where_filter={"file_id": file_id}
                )
                logger.info(f"✅ 从向量库删除文件 {file_id} 的所有向量")
            except Exception as e:
                # 向量删除失败不影响后续数据库清理，但记录详细日志
                logger.error(f"⚠️ 向量库删除失败，但不影响数据库清理：{e}")

            # 2. 从数据库删除分块（级联删除）
            deleted_count = await self.chunk_repo.delete_chunks_by_file(file_id)
            logger.info(f"✅ 删除 {deleted_count} 个分块")

            # 3. 删除文件记录
            success = await self.file_repo.delete_file(file_id)

            return success

        except Exception as e:
            logger.error(f"删除文件失败：{e}")
            return False
