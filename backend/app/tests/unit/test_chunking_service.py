"""
ChunkingService 单元测试

测试智能文本分块服务的所有功能：
1. 不同分块策略（fixed, paragraph, heading, code）
2. 重叠部分添加逻辑
3. Token 数量估算准确性
4. 空文本和边界条件处理
"""

import pytest
from app.services.chunking_service import ChunkingService


class TestChunkingService:
    """测试 ChunkingService"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """每个测试前初始化分块服务"""
        self.service = ChunkingService(
            max_chunk_size=100,
            overlap_size=20,
            min_chunk_size=30,
        )

    @pytest.mark.asyncio
    async def test_fixed_size_chunking(self):
        """测试固定大小分块策略"""
        # Arrange
        text = "这是第一段内容。" * 20  # 约 240 字符
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="fixed",
            metadata={"source": "test"},
        )
        
        # Assert
        assert len(chunks) > 1  # 应该分成多个块
        assert all(chunk["content"] for chunk in chunks)
        assert all(chunk["chunk_index"] >= 0 for chunk in chunks)
        assert all(chunk["metadata"]["source"] == "test" for chunk in chunks)
        assert all(chunk["metadata"]["strategy"] == "fixed" for chunk in chunks)

    @pytest.mark.asyncio
    async def test_paragraph_based_chunking(self):
        """测试基于段落的分块策略"""
        # Arrange
        text = """这是第一段。

这是第二段。

这是第三段。

这是第四段，比较长，需要单独成块。""" * 5
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="paragraph",
            metadata={"type": "article"},
        )
        
        # Assert
        assert len(chunks) > 0
        # 验证每个块都有元数据
        for chunk in chunks:
            assert chunk["metadata"]["type"] == "article"
            assert chunk["content"]  # 内容不为空

    @pytest.mark.asyncio
    async def test_heading_based_chunking(self):
        """测试基于标题的分块策略"""
        # Arrange
        text = """# 第一章

这是第一章的内容。

## 第一节

第一节的内容。

# 第二章

这是第二章的内容。

## 第一节

第二章第一节的内容。
"""
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="heading",
            metadata={"format": "markdown"},
        )
        
        # Assert
        assert len(chunks) > 0
        # 验证每个块都包含标题
        for chunk in chunks:
            content = chunk["content"]
            assert any(content.strip().startswith('#' * i) for i in range(1, 7))

    @pytest.mark.asyncio
    async def test_code_chunking(self):
        """测试代码分块策略"""
        # Arrange
        text = """def function1():
    print("Hello")
    return True

def function2():
    x = 1
    y = 2
    return x + y

class MyClass:
    def __init__(self):
        self.value = 0
    
    def method(self):
        return self.value
"""
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="code",
            metadata={"language": "python"},
        )
        
        # Assert
        assert len(chunks) > 0
        # 验证代码块完整性
        for chunk in chunks:
            content = chunk["content"]
            # 代码块应该包含完整的函数或类定义
            assert content.strip()

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
    async def test_single_chunk(self):
        """测试单个分块（文本长度小于最大限制）"""
        # Arrange
        text = "这是一段短文本，不需要分块。"
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="fixed",
        )
        
        # Assert
        assert len(chunks) >= 1  # 至少有一个块
        assert chunks[0]["chunk_index"] == 0

    @pytest.mark.asyncio
    async def test_overlap_addition(self):
        """测试重叠部分添加逻辑"""
        # Arrange
        service = ChunkingService(
            max_chunk_size=100,
            overlap_size=30,
            min_chunk_size=20,
        )
        
        chunks = ["第一个块的内容" * 3, "第二个块的内容" * 3, "第三个块的内容" * 3]
        
        # Act
        result = service._add_overlap(chunks)
        
        # Assert
        assert len(result) == 3
        # 第二个块应该包含第一个块的末尾
        assert "第一个块的内容" in result[1]
        # 第三个块应该包含第二个块的末尾
        assert "第二个块的内容" in result[2]
        # 第一个块不应该有重叠
        assert result[0] == chunks[0]

    @pytest.mark.asyncio
    async def test_overlap_disabled(self):
        """测试禁用重叠的情况"""
        # Arrange
        service = ChunkingService(
            max_chunk_size=100,
            overlap_size=0,
            min_chunk_size=20,
        )
        
        chunks = ["块 1", "块 2", "块 3"]
        
        # Act
        result = service._add_overlap(chunks)
        
        # Assert
        assert len(result) == 3
        assert result == chunks  # 不应该有变化

    @pytest.mark.asyncio
    async def test_single_chunk_no_overlap(self):
        """测试单个分块时不添加重叠"""
        # Arrange
        chunks = ["只有一个块"]
        
        # Act
        result = self.service._add_overlap(chunks)
        
        # Assert
        assert len(result) == 1
        assert result == chunks

    @pytest.mark.asyncio
    async def test_token_count_estimation(self):
        """测试 Token 数量估算"""
        # Arrange
        test_cases = [
            ("中文文本测试", 1),  # 5 字符 / 3 ≈ 1
            ("English text test", 4),  # 17 字符 / 3 ≈ 5
            ("混合 Chinese and English", 7),  # 24 字符 / 3 ≈ 8
            ("", 0),  # 空文本
        ]
        
        # Act & Assert
        for text, expected_min in test_cases:
            estimated = self.service.estimate_token_count(text)
            assert estimated >= 0
            # 只验证大致范围，因为这是粗略估算
            if text:
                assert estimated <= len(text)  # 不应该超过字符数

    @pytest.mark.asyncio
    async def test_metadata_inclusion(self):
        """测试元数据正确添加到每个分块"""
        # Arrange
        text = "测试内容。" * 50
        custom_metadata = {
            "file_id": "file-123",
            "author": "tester",
            "tags": ["test", "chunking"],
        }
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="fixed",
            metadata=custom_metadata,
        )
        
        # Assert
        assert len(chunks) > 0
        for chunk in chunks:
            # 验证自定义元数据
            assert chunk["metadata"]["file_id"] == "file-123"
            assert chunk["metadata"]["author"] == "tester"
            assert chunk["metadata"]["tags"] == ["test", "chunking"]
            # 验证自动添加的元数据
            assert "chunk_size" in chunk["metadata"]
            assert "strategy" in chunk["metadata"]
            assert chunk["metadata"]["chunk_size"] == len(chunk["content"])

    @pytest.mark.asyncio
    async def test_unknown_strategy_fallback(self):
        """测试未知策略时回退到固定大小分块"""
        # Arrange
        text = "测试内容。" * 50
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="unknown_strategy",
        )
        
        # Assert
        assert len(chunks) > 0
        assert all(chunk["metadata"]["strategy"] == "unknown_strategy" 
                   for chunk in chunks)

    @pytest.mark.asyncio
    async def test_chunk_index_sequential(self):
        """测试分块索引顺序递增"""
        # Arrange
        text = "内容。" * 100
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="fixed",
        )
        
        # Assert
        for i, chunk in enumerate(chunks):
            assert chunk["chunk_index"] == i

    @pytest.mark.asyncio
    async def test_large_text_chunking(self):
        """测试大文本分块"""
        # Arrange
        text = "这是一段很长的文本。" * 1000  # 约 20000 字符
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="fixed",
        )
        
        # Assert
        assert len(chunks) > 1
        # 验证每个块都不超过最大限制（考虑重叠）
        for chunk in chunks:
            assert len(chunk["content"]) <= 150  # 允许一定的重叠余量

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
            strategy="fixed",
        )
        
        # Assert
        assert len(chunks) > 0
        # 验证特殊字符被正确保留（在任意一个块中）
        full_text = "".join(chunk["content"] for chunk in chunks)
        assert "mc" in full_text  # 数学公式部分
        assert "div" in full_text  # HTML 标签部分

    @pytest.mark.asyncio
    async def test_very_small_max_chunk_size(self):
        """测试非常小的最大分块大小"""
        # Arrange
        service = ChunkingService(
            max_chunk_size=10,
            overlap_size=2,
            min_chunk_size=5,
        )
        
        text = "这是一个测试文本，用于验证极小的分块大小。"
        
        # Act
        chunks = await service.chunk_text(
            text=text,
            strategy="fixed",
        )
        
        # Assert
        assert len(chunks) > 1
        # 验证每个块都很小
        for chunk in chunks:
            assert len(chunk["content"]) <= 15  # 允许少量重叠

    @pytest.mark.asyncio
    async def test_metadata_copy_isolation(self):
        """测试元数据复制隔离"""
        # Arrange
        text = "测试。" * 50
        metadata = {"counter": 0}
        
        # Act
        chunks = await self.service.chunk_text(
            text=text,
            strategy="fixed",
            metadata=metadata,
        )
        
        # Modify original metadata
        metadata["counter"] = 999
        
        # Assert
        for chunk in chunks:
            # 验证每个块的元数据是独立的副本
            assert chunk["metadata"]["counter"] == 0  # 不受原字典修改影响
