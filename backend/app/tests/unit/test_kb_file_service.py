"""
KBFileService 单元测试

测试知识库文件服务的完整处理流程：
1. 文件处理全流程（解析、分块、向量化、存储）
2. 并发控制信号量机制
3. 错误处理和状态回滚
4. 文件哈希计算
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.kb_file_service import KBFileService
from app.repositories.kb_repository import KBRepository
from app.repositories.kb_file_repository import KBFileRepository
from app.repositories.kb_chunk_repository import KBChunkRepository
from app.services.file_parser_service import FileParserService
from app.services.chunking_service import ChunkingService
from app.services.vector_service import VectorService


class TestKBFileService:
    """测试 KBFileService"""

    @pytest.fixture(autouse=True)
    def setup(self, test_db_session):
        """每个测试使用独立的数据库会话"""
        self.session = test_db_session
        self.service = KBFileService(test_db_session)
        
        # Mock 相关依赖
        self.service.kb_repo = AsyncMock(spec=KBRepository)
        self.service.file_repo = AsyncMock(spec=KBFileRepository)
        self.service.chunk_repo = AsyncMock(spec=KBChunkRepository)
        self.service.parser_service = AsyncMock(spec=FileParserService)
        self.service.vector_service = AsyncMock(spec=VectorService)

    @pytest.mark.asyncio
    async def test_process_file_full_flow(self):
        """测试文件处理完整流程"""
        # Arrange
        kb_id = "test-kb-001"
        file_path = "/tmp/test.txt"
        file_name = "test.txt"
        display_name = "测试文件"
        file_size = 1024
        file_type = "text"
        file_extension = "txt"
        
        # Mock 知识库
        mock_kb = MagicMock()
        mock_kb.id = kb_id
        mock_kb.chunk_max_size = 1000
        mock_kb.chunk_overlap_size = 100
        mock_kb.chunk_min_size = 50
        mock_kb.embedding_model_provider = "openai"
        mock_kb.embedding_model_name = "text-embedding-v3"
        self.service.kb_repo.get_kb = AsyncMock(return_value=mock_kb)
        
        # Mock 文件记录
        mock_file = MagicMock()
        mock_file.id = "file-001"
        self.service.file_repo.create_file = AsyncMock(return_value=mock_file)
        self.service.file_repo.update_processing_status = AsyncMock()
        
        # Mock 文件哈希计算（避免实际读取文件）
        self.service._calculate_file_hash = AsyncMock(return_value="test_hash_abc123")
        
        # Mock 文件解析
        self.service.parser_service.parse_file_from_path = AsyncMock(
            return_value="这是测试文件内容\n用于分块测试"
        )
        
        # Mock 分块服务
        with patch.object(ChunkingService, 'chunk_text', new_callable=AsyncMock) as mock_chunk:
            mock_chunk.return_value = [
                {"content": "这是第一个分块", "chunk_index": 0, "metadata": {}},
                {"content": "这是第二个分块", "chunk_index": 1, "metadata": {}},
            ]
            
            # Mock 向量化
            self.service.vector_service.get_embedding = AsyncMock(
                return_value=[0.1] * 1536
            )
            self.service.vector_service.add_chunks_to_collection = AsyncMock()
            
            # Mock 分块创建
            self.service.chunk_repo.create_chunk = AsyncMock()
            
            # Act
            file_id = await self.service.process_file(
                knowledge_base_id=kb_id,
                file_path=file_path,
                file_name=file_name,
                display_name=display_name,
                file_size=file_size,
                file_type=file_type,
                file_extension=file_extension,
            )
            
            # Assert
            assert file_id == "file-001"
            self.service.kb_repo.get_kb.assert_called_once_with(kb_id)
            assert self.service.file_repo.create_file.called
            self.service.parser_service.parse_file_from_path.assert_called_once_with(file_path)
            assert mock_chunk.called
            assert self.service.vector_service.get_embedding.call_count == 2
            assert self.service.chunk_repo.create_chunk.call_count == 2
            
            # 验证完成状态被调用（不检查所有参数，因为可能有额外参数）
            calls = self.service.file_repo.update_processing_status.call_args_list
            completed_calls = [c for c in calls if c[1].get('status') == 'completed' and c[1].get('progress') == 100]
            assert len(completed_calls) > 0

    @pytest.mark.asyncio
    async def test_process_file_kb_not_found(self):
        """测试知识库不存在时的错误处理"""
        # Arrange
        self.service.kb_repo.get_kb = AsyncMock(return_value=None)
        
        # Act & Assert
        with pytest.raises(RuntimeError, match="知识库不存在"):
            await self.service.process_file(
                knowledge_base_id="non-existent-kb",
                file_path="/tmp/test.txt",
                file_name="test.txt",
                display_name="测试文件",
                file_size=1024,
                file_type="text",
                file_extension="txt",
            )

    @pytest.mark.asyncio
    async def test_process_file_parsing_error(self):
        """测试文件解析失败时的错误处理和状态回滚"""
        # Arrange
        kb_id = "test-kb-002"
        mock_kb = MagicMock()
        mock_kb.id = kb_id
        mock_kb.chunk_max_size = 1000
        mock_kb.chunk_overlap_size = 100
        mock_kb.chunk_min_size = 50
        self.service.kb_repo.get_kb = AsyncMock(return_value=mock_kb)
        
        mock_file = MagicMock()
        mock_file.id = "file-002"
        self.service.file_repo.create_file = AsyncMock(return_value=mock_file)
        self.service.file_repo.update_processing_status = AsyncMock()
        
        # Mock 文件哈希计算
        self.service._calculate_file_hash = AsyncMock(return_value="test_hash")
        
        # Mock 解析失败
        self.service.parser_service.parse_file_from_path = AsyncMock(
            side_effect=Exception("文件格式不支持")
        )
        
        # Act & Assert
        with pytest.raises(RuntimeError, match="文件处理失败"):
            await self.service.process_file(
                knowledge_base_id=kb_id,
                file_path="/tmp/unsupported.xyz",
                file_name="unsupported.xyz",
                display_name="不支持的文件",
                file_size=2048,
                file_type="xyz",
                file_extension="xyz",
            )
        
        # 验证状态已更新为失败（检查任意一次调用）
        calls = self.service.file_repo.update_processing_status.call_args_list
        # 至少有一次调用包含 failed 状态
        failed_calls = [c for c in calls if len(c[1].get('status', '')) > 0 and c[1]['status'] == 'failed']
        assert len(failed_calls) > 0

    @pytest.mark.asyncio
    async def test_process_file_embedding_error(self):
        """测试向量化失败时的错误处理"""
        # Arrange
        kb_id = "test-kb-003"
        mock_kb = MagicMock()
        mock_kb.id = kb_id
        mock_kb.chunk_max_size = 1000
        mock_kb.chunk_overlap_size = 100
        mock_kb.chunk_min_size = 50
        mock_kb.embedding_model_provider = "openai"
        mock_kb.embedding_model_name = "text-embedding-v3"
        self.service.kb_repo.get_kb = AsyncMock(return_value=mock_kb)
        
        mock_file = MagicMock()
        mock_file.id = "file-003"
        self.service.file_repo.create_file = AsyncMock(return_value=mock_file)
        self.service.file_repo.update_processing_status = AsyncMock()
        
        # Mock 文件哈希计算
        self.service._calculate_file_hash = AsyncMock(return_value="test_hash")
        
        self.service.parser_service.parse_file_from_path = AsyncMock(
            return_value="测试内容"
        )
        
        with patch.object(ChunkingService, 'chunk_text', new_callable=AsyncMock) as mock_chunk:
            mock_chunk.return_value = [
                {"content": "分块 1", "chunk_index": 0, "metadata": {}},
            ]
            
            # Mock 向量化失败
            self.service.vector_service.get_embedding = AsyncMock(
                side_effect=Exception("API 调用失败")
            )
            
            # Act & Assert
            with pytest.raises(RuntimeError, match="分块 0 向量化失败"):
                await self.service.process_file(
                    knowledge_base_id=kb_id,
                    file_path="/tmp/test.txt",
                    file_name="test.txt",
                    display_name="测试文件",
                    file_size=1024,
                    file_type="text",
                    file_extension="txt",
                )
            
            # 验证状态已更新为失败（检查任意一次调用）
            calls = self.service.file_repo.update_processing_status.call_args_list
            # 至少有一次调用包含 failed 状态
            failed_calls = [c for c in calls if len(c[1].get('status', '')) > 0 and c[1]['status'] == 'failed']
            assert len(failed_calls) > 0

    @pytest.mark.asyncio
    async def test_semaphore_concurrency_control(self):
        """测试并发控制信号量机制"""
        # Arrange
        # 重置信号量
        KBFileService._processing_semaphore = None
        
        service1 = KBFileService(self.session)
        service2 = KBFileService(self.session)
        
        # Act
        # 验证信号量已初始化且并发数为 1
        assert service1._processing_semaphore is not None
        assert service2._processing_semaphore is not None
        assert service1._processing_semaphore._value == 1
        assert service2._processing_semaphore._value == 1
        
        # 验证两个服务实例共享同一个信号量
        assert service1._processing_semaphore is service2._processing_semaphore

    @pytest.mark.asyncio
    async def test_calculate_file_hash(self):
        """测试文件哈希计算"""
        # Arrange
        import tempfile
        import os
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as f:
            f.write("测试文件内容用于哈希计算")
            temp_path = f.name
        
        try:
            # Act
            hash_result = await self.service._calculate_file_hash(temp_path)
            
            # Assert
            assert isinstance(hash_result, str)
            assert len(hash_result) == 64  # SHA256 哈希长度为 64
            
            # 验证相同内容生成相同哈希
            hash_result2 = await self.service._calculate_file_hash(temp_path)
            assert hash_result == hash_result2
            
        finally:
            # 清理临时文件
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_get_file_processing_status(self):
        """测试获取文件处理状态"""
        # Arrange
        mock_file = MagicMock()
        mock_file.id = "file-004"
        mock_file.display_name = "测试文件"
        mock_file.processing_status = "processing"
        mock_file.progress_percentage = 50
        mock_file.current_step = "正在向量化..."
        mock_file.error_message = None
        mock_file.total_chunks = 10
        mock_file.uploaded_at = MagicMock()
        mock_file.uploaded_at.isoformat.return_value = "2024-01-01T00:00:00Z"
        mock_file.processed_at = None
        
        self.service.file_repo.get_file = AsyncMock(return_value=mock_file)
        
        # Act
        status = await self.service.get_file_processing_status("file-004")
        
        # Assert
        assert status is not None
        assert status["id"] == "file-004"
        assert status["file_name"] == "测试文件"
        assert status["processing_status"] == "processing"
        assert status["progress_percentage"] == 50
        assert status["current_step"] == "正在向量化..."
        assert status["total_chunks"] == 10

    @pytest.mark.asyncio
    async def test_get_file_processing_status_not_found(self):
        """测试获取不存在的文件状态"""
        # Arrange
        self.service.file_repo.get_file = AsyncMock(return_value=None)
        
        # Act
        status = await self.service.get_file_processing_status("non-existent-file")
        
        # Assert
        assert status is None

    @pytest.mark.asyncio
    async def test_delete_file_and_chunks(self):
        """测试删除文件及其分块"""
        # Arrange
        mock_file = MagicMock()
        mock_file.id = "file-005"
        mock_file.knowledge_base_id = "kb-001"
        
        self.service.file_repo.get_file = AsyncMock(return_value=mock_file)
        self.service.chunk_repo.delete_chunks_by_file = AsyncMock(return_value=5)
        self.service.file_repo.delete_file = AsyncMock(return_value=True)
        
        # Act
        result = await self.service.delete_file_and_chunks("file-005")
        
        # Assert
        assert result is True
        self.service.chunk_repo.delete_chunks_by_file.assert_called_once_with("file-005")
        self.service.file_repo.delete_file.assert_called_once_with("file-005")

    @pytest.mark.asyncio
    async def test_delete_file_not_found(self):
        """测试删除不存在的文件"""
        # Arrange
        self.service.file_repo.get_file = AsyncMock(return_value=None)
        
        # Act
        result = await self.service.delete_file_and_chunks("non-existent-file")
        
        # Assert
        assert result is False

    @pytest.mark.asyncio
    async def test_process_file_with_provided_content(self):
        """测试使用提供的文件内容而不是读取文件"""
        # Arrange
        kb_id = "test-kb-004"
        mock_kb = MagicMock()
        mock_kb.id = kb_id
        mock_kb.chunk_max_size = 1000
        mock_kb.chunk_overlap_size = 100
        mock_kb.chunk_min_size = 50
        self.service.kb_repo.get_kb = AsyncMock(return_value=mock_kb)
        
        mock_file = MagicMock()
        mock_file.id = "file-006"
        self.service.file_repo.create_file = AsyncMock(return_value=mock_file)
        self.service.file_repo.update_processing_status = AsyncMock()
        
        # Mock 文件哈希计算
        self.service._calculate_file_hash = AsyncMock(return_value="test_hash")
        
        provided_content = "直接提供的内容，不需要读取文件"
        
        with patch.object(ChunkingService, 'chunk_text', new_callable=AsyncMock) as mock_chunk:
            mock_chunk.return_value = [
                {"content": provided_content, "chunk_index": 0, "metadata": {}},
            ]
            
            self.service.vector_service.get_embedding = AsyncMock(
                return_value=[0.1] * 1536
            )
            self.service.vector_service.add_chunks_to_collection = AsyncMock()
            self.service.chunk_repo.create_chunk = AsyncMock()
            
            # Act
            file_id = await self.service.process_file(
                knowledge_base_id=kb_id,
                file_path="/tmp/not_needed.txt",
                file_name="test.txt",
                display_name="测试文件",
                file_size=1024,
                file_type="text",
                file_extension="txt",
                content=provided_content,
            )
            
            # Assert
            assert file_id == "file-006"
            # 验证没有调用文件解析
            self.service.parser_service.parse_file_from_path.assert_not_called()
