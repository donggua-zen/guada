"""
智能文本分块服务

基于语义和结构进行文本分块，使用段落感知分块策略：
- 保持段落完整性
- 在段落边界处分块
- 自动处理超大段落
- 支持分块重叠（避免信息丢失）
"""

import logging
from typing import List, Dict, Optional
from app.utils.chunking import chunking_text, preprocess_text

logger = logging.getLogger(__name__)


class ChunkingService:
    """智能文本分块服务"""

    def __init__(
        self,
        max_chunk_size: int = 1000,
        overlap_size: int = 100,
        min_chunk_size: int = 50,
    ):
        """
        初始化分块服务

        Args:
            max_chunk_size: 最大分块大小（字符数）
            overlap_size: 分块重叠大小（字符数）
            min_chunk_size: 最小分块大小（字符数）
        """
        self.max_chunk_size = max_chunk_size
        self.overlap_size = overlap_size
        self.min_chunk_size = min_chunk_size

    async def chunk_text(
        self,
        text: str,
        metadata: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        对文本进行分块（使用段落感知分块）

        Args:
            text: 待分块的文本
            metadata: 元数据（会添加到每个分块中）

        Returns:
            List[Dict]: 分块结果，每个分块包含 content, chunk_index, metadata, overlap_length 等字段
                       overlap_length: 重叠区域的字符长度，0 表示无重叠
        """
        if not text or len(text.strip()) == 0:
            return []

        # 预处理文本
        text = preprocess_text(text)

        # 使用段落感知分块（返回带重叠长度的分块）
        chunks_with_overlap = await self._paragraph_based_chunking_with_overlap(text)

        # 为每个分块添加索引和元数据
        result = []
        for idx, chunk_data in enumerate(chunks_with_overlap):
            full_chunk = {
                "content": chunk_data["content"],
                "chunk_index": idx,
                "metadata": {
                    **metadata,
                    "overlap_length": chunk_data["overlap_length"],
                },
            }
            # 添加分块特定的元数据
            full_chunk["metadata"]["chunk_size"] = len(chunk_data["content"])
            full_chunk["metadata"]["strategy"] = "paragraph"
            # 计算纯净内容（不含重叠部分）
            if chunk_data["overlap_length"] > 0:
                full_chunk["clean_content"] = chunk_data["content"][
                    chunk_data["overlap_length"] :
                ]  # 去除重叠部分
                full_chunk["metadata"]["clean_size"] = len(full_chunk["clean_content"])
            else:
                full_chunk["clean_content"] = chunk_data["content"]
                full_chunk["metadata"]["clean_size"] = len(chunk_data["content"])

            result.append(full_chunk)

        logger.info(f"文本分块完成：共{len(result)}个分块，策略=paragraph")
        return result

    async def _paragraph_based_chunking_with_overlap(self, text: str) -> List[Dict]:
        """
        基于段落的分块（带重叠区域长度）

        尽可能保持段落完整性，在段落边界处分块
        为每个分块计算重叠部分的字符长度

        Args:
            text: 文本内容

        Returns:
            List[Dict]: 分块列表，每个分块包含 content 和 overlap_length
        """
        # 按段落分割
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        if not paragraphs:
            return []

        # 第一阶段：初步分块（不处理重叠）
        raw_chunks = []
        current_chunk = ""

        for para in paragraphs:
            # 如果当前段落加到当前块会超出限制
            if len(current_chunk) + len(para) > self.max_chunk_size:
                # 如果当前块不为空，保存它
                if current_chunk:
                    raw_chunks.append(current_chunk)

                # 如果单个段落就超出限制，需要进一步分块
                if len(para) > self.max_chunk_size:
                    sub_chunks = self._simple_fixed_chunking(para)
                    raw_chunks.extend(sub_chunks[:-1])  # 除了最后一个
                    current_chunk = sub_chunks[-1] if sub_chunks else ""
                else:
                    current_chunk = para
            else:
                # 添加到当前块
                current_chunk = current_chunk + "\n\n" + para if current_chunk else para

        # 添加最后一个块
        if current_chunk:
            raw_chunks.append(current_chunk)

        # 第二阶段：处理重叠，计算重叠长度
        if len(raw_chunks) <= 1 or self.overlap_size <= 0:
            # 无需重叠，所有块的 overlap_length 为 0
            return [{"content": chunk, "overlap_length": 0} for chunk in raw_chunks]

        # 为每个块计算重叠长度
        result = []
        for i, chunk in enumerate(raw_chunks):
            if i == 0:
                # 第一个块没有重叠
                result.append({"content": chunk, "overlap_length": 0})
            else:
                # 计算需要添加的重叠文本长度
                prev_chunk = raw_chunks[i - 1]
                actual_overlap_len = min(self.overlap_size, len(prev_chunk))
                overlap_text = prev_chunk[len(prev_chunk) - actual_overlap_len :]

                # 在当前块开头添加重叠文本
                new_content = overlap_text + chunk
                # overlap_length 就是重叠文本的长度
                overlap_length = len(overlap_text)

                result.append(
                    {"content": new_content, "overlap_length": overlap_length}
                )

        return result

    def _simple_fixed_chunking(self, text: str) -> List[str]:
        """
        简单的固定大小分块（用于处理超大段落）

        Args:
            text: 文本内容

        Returns:
            List[str]: 分块列表
        """
        chunks = []
        for i in range(0, len(text), self.max_chunk_size):
            chunk = text[i : i + self.max_chunk_size]
            chunks.append(chunk)
        return chunks

    def estimate_token_count(self, text: str) -> int:
        """
        估算文本的 token 数量

        简单估算：中文约 1.5 字符/token，英文约 4 字符/token

        Args:
            text: 文本内容

        Returns:
            int: 估算的 token 数量
        """
        # 粗略估算：平均 3 字符/token
        return len(text) // 3
