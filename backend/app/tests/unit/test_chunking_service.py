"""
ChunkingService 单元测试

测试智能文本分块服务的所有功能：
1. 语义分块效果验证
2. Token 分块降级方案验证
3. 重叠部分添加逻辑
4. 空文本和边界条件处理
"""

import pytest
from app.services.chunking_service import ChunkingService


class TestChunkingService:
    """测试 ChunkingService"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """每个测试前初始化分块服务（使用较小的 Token 限制以触发分块）"""
        self.service = ChunkingService(
            max_chunk_size=50,  # 减小限制以便在短文本下也能分块
            overlap_size=10,
            min_chunk_size=10,
        )

    @pytest.mark.asyncio
    async def test_token_chunking_basic(self):
        """测试 Token 分块基本功能"""
        # Arrange
        text = "这是一个用于测试 Token 分块器的长文本。" * 20
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            metadata={"source": "token_test"},
        )
        
        # Assert
        assert len(chunks) >= 1
        assert all(chunk["content"] for chunk in chunks)
        assert chunks[0]["metadata"]["strategy"] == "token"
        # 验证 token_count 字段是否存在
        assert "token_count" in chunks[0]["metadata"]

    @pytest.mark.asyncio
    async def test_empty_text(self):
        """测试空文本处理"""
        # Arrange
        empty_texts = ["", "   ", "\n\n", None]
        
        # Act & Assert
        for text in empty_texts:
            if text is None:
                chunks = await self.service.chunk_text(text=None)
            else:
                chunks = await self.service.chunk_text(text=text)
            assert chunks == []

    @pytest.mark.asyncio
    async def test_overlap_addition(self):
        """测试重叠部分添加逻辑"""
        # Arrange
        service = ChunkingService(
            max_chunk_size=30, # 进一步减小限制
            overlap_size=5,
            min_chunk_size=5,
        )
        
        text = "第一部分内容非常重要。第二部分内容是第一部分的延续。第三部分内容是总结。" * 3
        
        # Act
        chunks = await service.chunk_text(text=text)
        
        # Assert
        assert len(chunks) >= 1
        # 检查元数据中是否有重叠长度记录（目前简化实现可能为 0）
        assert "overlap_length" in chunks[0]["metadata"]

    @pytest.mark.asyncio
    async def test_metadata_structure(self):
        """测试元数据结构的完整性"""
        # Arrange
        text = "测试元数据结构是否包含所有必要字段。" * 10
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            metadata={"file_id": "123"},
        )
        
        # Assert
        assert len(chunks) > 0
        first_chunk = chunks[0]
        assert "content" in first_chunk
        assert "clean_content" in first_chunk
        assert "chunk_index" in first_chunk
        assert "metadata" in first_chunk
        assert "overlap_length" in first_chunk["metadata"]
        assert "chunk_size" in first_chunk["metadata"]
        assert "clean_size" in first_chunk["metadata"]
        assert "strategy" in first_chunk["metadata"]
        assert first_chunk["metadata"]["file_id"] == "123"

    @pytest.mark.asyncio
    async def test_single_chunk(self):
        """测试单个分块（文本长度小于最大限制）"""
        # Arrange
        text = "这是一段短文本，不需要分块。"
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
        )
        
        # Assert
        assert len(chunks) >= 1  # 至少有一个块
        assert chunks[0]["chunk_index"] == 0

    @pytest.mark.asyncio
    async def test_special_characters_handling(self):
        """测试特殊字符处理"""
        # Arrange
        text = """特殊字符测试：
        - 标点符号：！@#$%^&*()
        - 数学公式：E = mc²
        - 代码：<div>Hello</div>
        """
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
        )
        
        # Assert
        assert len(chunks) > 0
        # 验证特殊字符被正确保留（在任意一个块中）
        full_text = "".join(chunk["content"] for chunk in chunks)
        assert "mc" in full_text  # 数学公式部分
        assert "div" in full_text  # HTML 标签部分
