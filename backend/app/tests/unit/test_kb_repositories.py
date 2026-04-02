"""
知识库仓库单元测试

测试 KBRepository、KBFileRepository、KBChunkRepository 的所有方法
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.kb_repository import KBRepository
from app.repositories.kb_file_repository import KBFileRepository
from app.repositories.kb_chunk_repository import KBChunkRepository


class TestKBRepository:
    """测试 KBRepository"""

    @pytest.fixture(autouse=True)
    def setup(self, test_db_session):
        """每个测试使用独立的数据库会话"""
        self.session = test_db_session
        self.repo = KBRepository(test_db_session)

    @pytest.mark.asyncio
    async def test_create_kb(self):
        """测试创建知识库"""
        kb = await self.repo.create_kb(
            name="测试知识库",
            user_id="test_user_001",
            embedding_model_id="test_model_001",
            description="这是一个测试知识库",
            chunk_max_size=1000,
            chunk_overlap_size=100,
            chunk_min_size=50,
        )
        
        assert kb.name == "测试知识库"
        assert kb.user_id == "test_user_001"
        assert kb.embedding_model_id == "test_model_001"
        assert kb.is_active is True
        assert kb.chunk_max_size == 1000

    @pytest.mark.asyncio
    async def test_get_kb(self):
        """测试获取知识库"""
        # 先创建
        kb = await self.repo.create_kb(
            name="获取测试",
            user_id="test_user_002",
            embedding_model_id="test_model_002",
        )
        
        # 再获取
        retrieved = await self.repo.get_kb(kb.id)
        assert retrieved is not None
        assert retrieved.id == kb.id
        assert retrieved.name == "获取测试"

    @pytest.mark.asyncio
    async def test_get_kb_not_found(self):
        """测试获取不存在的知识库"""
        result = await self.repo.get_kb("non_existent_id")
        assert result is None

    @pytest.mark.asyncio
    async def test_list_kbs(self):
        """测试列出知识库列表"""
        user_id = "test_user_003"
        
        # 创建多个知识库
        for i in range(5):
            await self.repo.create_kb(
                name=f"知识库{i}",
                user_id=user_id,
                embedding_model_id="test_model_003",
            )
        
        # 测试分页
        kbs = await self.repo.list_kbs(user_id, skip=0, limit=3)
        assert len(kbs) == 3
        
        # 测试跳过
        kbs_page2 = await self.repo.list_kbs(user_id, skip=3, limit=3)
        assert len(kbs_page2) == 2

    @pytest.mark.asyncio
    async def test_update_kb(self):
        """测试更新知识库"""
        kb = await self.repo.create_kb(
            name="原名",
            user_id="test_user_004",
            embedding_model_id="test_model_004",
        )
        
        # 更新
        updated = await self.repo.update_kb(kb.id, {
            "name": "新名称",
            "description": "新增描述",
            "chunk_max_size": 1500,
        })
        
        assert updated.name == "新名称"
        assert updated.description == "新增描述"
        assert updated.chunk_max_size == 1500
        assert updated.embedding_model_id == "test_model_004"  # 未变

    @pytest.mark.asyncio
    async def test_delete_kb(self):
        """测试软删除知识库"""
        kb = await self.repo.create_kb(
            name="待删除",
            user_id="test_user_005",
            embedding_model_id="test_model_005",
        )
        
        # 删除
        success = await self.repo.delete_kb(kb.id)
        assert success is True
        
        # 验证已删除（查询不到）
        deleted_kb = await self.repo.get_kb(kb.id)
        assert deleted_kb is None

    @pytest.mark.asyncio
    async def test_count_kbs(self):
        """测试统计知识库数量"""
        user_id = "test_user_006"
        
        # 初始为 0
        count = await self.repo.count_kbs(user_id)
        assert count == 0
        
        # 创建 3 个
        for i in range(3):
            await self.repo.create_kb(
                name=f"计数测试{i}",
                user_id=user_id,
                embedding_model_id="test_model_006",
            )
        
        # 验证数量
        count = await self.repo.count_kbs(user_id)
        assert count == 3


class TestKBFileRepository:
    """测试 KBFileRepository"""

    @pytest.fixture(autouse=True)
    def setup(self, test_db_session):
        """每个测试使用独立的数据库会话"""
        self.session = test_db_session
        self.file_repo = KBFileRepository(test_db_session)
        self.kb_repo = KBRepository(test_db_session)

    @pytest.mark.asyncio
    async def test_create_file(self):
        """测试创建文件记录"""
        kb = await self.kb_repo.create_kb(
            name="文件测试库",
            user_id="test_user_101",
            embedding_model_id="test_model_101",
        )
        
        file = await self.file_repo.create_file(
            knowledge_base_id=kb.id,
            file_name="test.pdf",
            display_name="测试 PDF",
            file_size=1024 * 1024,  # 1MB
            file_type="pdf",
            file_extension="pdf",
            content_hash="abc123hash",
        )
        
        assert file.file_name == "test.pdf"
        assert file.display_name == "测试 PDF"
        assert file.file_size == 1048576
        assert file.processing_status == "pending"
        assert file.progress_percentage == 0

    @pytest.mark.asyncio
    async def test_update_processing_status(self):
        """测试更新处理状态"""
        kb = await self.kb_repo.create_kb(
            name="状态测试库",
            user_id="test_user_102",
            embedding_model_id="test_model_102",
        )
        
        file = await self.file_repo.create_file(
            knowledge_base_id=kb.id,
            file_name="process_test.txt",
            display_name="处理测试",
            file_size=1024,
            file_type="text",
            file_extension="txt",
            content_hash="xyz789",
        )
        
        # 更新为处理中
        await self.file_repo.update_processing_status(
            file.id,
            status="processing",
            progress=50,
            current_step="正在向量化...",
        )
        
        # 验证状态
        updated = await self.file_repo.get_file(file.id)
        assert updated.processing_status == "processing"
        assert updated.progress_percentage == 50
        assert updated.current_step == "正在向量化..."
        assert updated.processed_at is None  # 未完成
        
        # 更新为完成
        await self.file_repo.update_processing_status(
            file.id,
            status="completed",
            progress=100,
            current_step="处理完成",
            total_chunks=10,
            total_tokens=5000,
        )
        
        updated = await self.file_repo.get_file(file.id)
        assert updated.processing_status == "completed"
        assert updated.progress_percentage == 100
        assert updated.total_chunks == 10
        assert updated.total_tokens == 5000
        assert updated.processed_at is not None  # 已完成

    @pytest.mark.asyncio
    async def test_list_files(self):
        """测试列出文件列表"""
        kb = await self.kb_repo.create_kb(
            name="列表测试库",
            user_id="test_user_103",
            embedding_model_id="test_model_103",
        )
        
        # 创建多个文件
        for i in range(5):
            await self.file_repo.create_file(
                knowledge_base_id=kb.id,
                file_name=f"file{i}.txt",
                display_name=f"文件{i}",
                file_size=1024,
                file_type="text",
                file_extension="txt",
                content_hash=f"hash{i}",
            )
        
        files = await self.file_repo.list_files(kb.id, skip=0, limit=3)
        assert len(files) == 3

    @pytest.mark.asyncio
    async def test_count_files(self):
        """测试统计文件数量"""
        kb = await self.kb_repo.create_kb(
            name="计数测试库",
            user_id="test_user_104",
            embedding_model_id="test_model_104",
        )
        
        count = await self.file_repo.count_files(kb.id)
        assert count == 0
        
        # 创建 3 个文件
        for i in range(3):
            await self.file_repo.create_file(
                knowledge_base_id=kb.id,
                file_name=f"count{i}.txt",
                display_name=f"计数{i}",
                file_size=1024,
                file_type="text",
                file_extension="txt",
                content_hash=f"count_hash{i}",
            )
        
        count = await self.file_repo.count_files(kb.id)
        assert count == 3


class TestKBChunkRepository:
    """测试 KBChunkRepository"""

    @pytest.fixture(autouse=True)
    def setup(self, test_db_session):
        """每个测试使用独立的数据库会话"""
        self.session = test_db_session
        self.chunk_repo = KBChunkRepository(test_db_session)
        self.file_repo = KBFileRepository(test_db_session)
        self.kb_repo = KBRepository(test_db_session)

    @pytest.mark.asyncio
    async def test_create_chunk(self):
        """测试创建分块记录"""
        kb = await self.kb_repo.create_kb(
            name="分块测试库",
            user_id="test_user_201",
            embedding_model_provider="openai",
            embedding_model_name="text-embedding-v3",
        )
        
        file = await self.file_repo.create_file(
            knowledge_base_id=kb.id,
            file_name="chunk_test.txt",
            display_name="分块测试",
            file_size=2048,
            file_type="text",
            file_extension="txt",
            content_hash="chunk_hash",
        )
        
        chunk = await self.chunk_repo.create_chunk(
            file_id=file.id,
            knowledge_base_id=kb.id,
            content="这是第一个分块的内容",
            chunk_index=0,
            vector_id="vector_001",
            token_count=50,
        )
        
        assert chunk.content == "这是第一个分块的内容"
        assert chunk.chunk_index == 0
        assert chunk.vector_id == "vector_001"
        assert chunk.token_count == 50

    @pytest.mark.asyncio
    async def test_list_chunks_by_file(self):
        """测试按文件列出分块"""
        kb = await self.kb_repo.create_kb(
            name="分块列表库",
            user_id="test_user_202",
            embedding_model_provider="openai",
            embedding_model_name="text-embedding-v3",
        )
        
        file = await self.file_repo.create_file(
            knowledge_base_id=kb.id,
            file_name="list_chunks.txt",
            display_name="分块列表测试",
            file_size=4096,
            file_type="text",
            file_extension="txt",
            content_hash="list_hash",
        )
        
        # 创建 10 个分块
        for i in range(10):
            await self.chunk_repo.create_chunk(
                file_id=file.id,
                knowledge_base_id=kb.id,
                content=f"分块内容{i}",
                chunk_index=i,
                vector_id=f"vector_{i:03d}",
                token_count=100,
            )
        
        chunks = await self.chunk_repo.list_chunks_by_file(file.id, skip=0, limit=5)
        assert len(chunks) == 5
        assert chunks[0].chunk_index == 0  # 按顺序
        assert chunks[4].chunk_index == 4

    @pytest.mark.asyncio
    async def test_delete_chunks_by_file(self):
        """测试批量删除文件的分块"""
        kb = await self.kb_repo.create_kb(
            name="删除测试库",
            user_id="test_user_203",
            embedding_model_provider="openai",
            embedding_model_name="text-embedding-v3",
        )
        
        file = await self.file_repo.create_file(
            knowledge_base_id=kb.id,
            file_name="delete_chunks.txt",
            display_name="删除分块测试",
            file_size=2048,
            file_type="text",
            file_extension="txt",
            content_hash="delete_hash",
        )
        
        # 创建 5 个分块
        for i in range(5):
            await self.chunk_repo.create_chunk(
                file_id=file.id,
                knowledge_base_id=kb.id,
                content=f"分块{i}",
                chunk_index=i,
                vector_id=f"vec_{i}",
                token_count=50,
            )
        
        # 批量删除
        deleted_count = await self.chunk_repo.delete_chunks_by_file(file.id)
        assert deleted_count == 5
        
        # 验证已删除
        remaining = await self.chunk_repo.list_chunks_by_file(file.id)
        assert len(remaining) == 0

    @pytest.mark.asyncio
    async def test_count_chunks(self):
        """测试统计分块数量"""
        kb = await self.kb_repo.create_kb(
            name="分块计数库",
            user_id="test_user_204",
            embedding_model_provider="openai",
            embedding_model_name="text-embedding-v3",
        )
        
        file = await self.file_repo.create_file(
            knowledge_base_id=kb.id,
            file_name="count_chunks.txt",
            display_name="分块计数测试",
            file_size=2048,
            file_type="text",
            file_extension="txt",
            content_hash="count_hash",
        )
        
        count = await self.chunk_repo.count_chunks(file.id)
        assert count == 0
        
        # 创建 7 个分块
        for i in range(7):
            await self.chunk_repo.create_chunk(
                file_id=file.id,
                knowledge_base_id=kb.id,
                content=f"分块{i}",
                chunk_index=i,
                vector_id=f"vec_{i}",
                token_count=50,
            )
        
        count = await self.chunk_repo.count_chunks(file.id)
        assert count == 7
