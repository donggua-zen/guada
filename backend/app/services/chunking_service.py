"""
智能文本分块服务

基于 Token 数量进行文本分块，保持语义连贯性：
- 使用项目现有的 tokenizer 模块计算 Token 数
- 优先在句子或段落边界处分块
- 支持分块重叠（避免信息丢失）
"""

import logging
import asyncio
from typing import List, Dict, Optional
from app.tokenizer.auto_tokenizer import get_tokenizer
from app.utils.chunking import preprocess_text

logger = logging.getLogger(__name__)


class ChunkingService:
    """基于 Token 的智能文本分块服务"""

    def __init__(
        self,
        chunk_size: int = 1000,
        overlap_size: int = 100,
        model_name: str = "gpt-4o",
    ):
        """
        初始化分块服务

        Args:
            chunk_size: 分块大小限制（Token 数）
            overlap_size: 分块重叠大小（Token 数）
            model_name: 用于计算 Token 的模型名称
        """
        self.chunk_size = chunk_size
        self.overlap_size = overlap_size
        self.tokenizer = get_tokenizer(model_name)

    async def chunk_text(
        self,
        text: str,
        metadata: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        对文本进行基于 Token 的分块

        Args:
            text: 待分块的文本
            metadata: 元数据（会添加到每个分块中）

        Returns:
            List[Dict]: 分块结果
        """
        if not text or len(text.strip()) == 0:
            return []

        # 预处理文本
        text = preprocess_text(text)

        # 执行分块 (同步逻辑放入线程池)
        chunks_data = await asyncio.to_thread(self._token_based_chunking, text)

        result = []
        prev_tokens_list = None
        
        for idx, content in enumerate(chunks_data):
            # 对当前分块内容进行 Token 编码
            current_tokens_list = self.tokenizer.encode(content)
            token_count = len(current_tokens_list)
            
            overlap_length = 0
            clean_content = content
            
            # 处理重叠逻辑
            if idx > 0 and self.overlap_size > 0 and prev_tokens_list:
                # 获取前一个分块的末尾 tokens 作为重叠部分
                overlap_token_ids = prev_tokens_list[-self.overlap_size:] if len(prev_tokens_list) >= self.overlap_size else prev_tokens_list
                overlap_text = self.tokenizer.decode(overlap_token_ids)
                
                # 检查当前分块是否已经自然包含了这部分重叠（例如因为句子边界导致的自然衔接）
                if content.startswith(overlap_text):
                    # 如果自然包含，则 clean_content 不需要再次剥离，但记录重叠长度
                    overlap_length = len(overlap_token_ids)
                else:
                    # 如果不包含，说明我们需要在逻辑上记录重叠，但在物理存储上可能需要 prepend
                    # 为了简化，这里我们假设 content 是纯净的，重叠仅用于检索时的上下文增强
                    # 在实际 RAG 中，通常会将 overlap 拼接到 content 前面或后面
                    # 这里我们选择将重叠部分拼接到 content 前面形成完整的 chunk 用于 embedding
                    full_embedding_content = overlap_text + content
                    overlap_length = len(overlap_token_ids)
                    # 更新 token_count 为包含重叠后的总数
                    token_count = self.tokenizer.count_tokens(full_embedding_content)
                    clean_content = content # 保持原始内容用于展示
                    content = full_embedding_content # 更新 content 为包含重叠的内容用于存储/索引

            full_chunk = {
                "content": content,
                "clean_content": clean_content,
                "chunk_index": idx,
                "metadata": {
                    **(metadata or {}),
                    "overlap_length": overlap_length,
                    "chunk_size": len(clean_content),
                    "token_count": token_count,
                    "clean_size": len(clean_content),
                    "strategy": "token",
                },
            }
            result.append(full_chunk)
            
            # 更新 prev_tokens_list 供下一次迭代使用
            # 注意：如果 content 已经被修改为包含重叠，我们需要重新 encode 或者使用原始的 current_tokens_list
            # 这里为了准确性，我们对最终的 content 重新 encode
            prev_tokens_list = self.tokenizer.encode(content)

        logger.info(f"文本分块完成：共{len(result)}个分块，策略=token")
        return result

    def _token_based_chunking(self, text: str) -> List[str]:
        """
        基于 Token 数量和句子边界的智能分块逻辑
        
        策略：
        1. 按句子边界分割文本，保持语义完整性。
        2. 累加句子到当前分块，直到加入下一个句子会超出 chunk_size。
        3. 严禁将一个句子强行拆分或合并进已满的分块。
        """
        import re
        # 使用正则表达式按句子边界分割（支持中英文标点）
        # (?<=[。！？.!?]) 表示在句号、感叹号、问号之后分割，但保留标点在句子末尾
        sentences = re.split(r'(?<=[。！？.!?])', text)
        # 过滤掉空字符串并去除首尾空白
        sentences = [s.strip() for s in sentences if s.strip()]
        
        if not sentences:
            return [text] if text else []

        chunks = []
        current_chunk_sentences = []
        current_tokens = 0

        for sentence in sentences:
            sentence_tokens = self.tokenizer.count_tokens(sentence)
            
            # 检查加入当前句子后是否超出限制
            # 如果当前分块不为空，需要考虑句子间的分隔符（这里简化为空格或换行，视情况而定，暂按空格估算或直接累加）
            # 为了精确，我们计算加入分隔符后的总 Token 数
            separator = " "
            separator_tokens = self.tokenizer.count_tokens(separator) if current_chunk_sentences else 0
            
            total_needed = current_tokens + separator_tokens + sentence_tokens

            if total_needed > self.chunk_size and current_chunk_sentences:
                # 如果超出限制且当前分块已有内容，则结束当前分块
                chunks.append(" ".join(current_chunk_sentences))
                # 开始新分块，当前句子作为起始
                current_chunk_sentences = [sentence]
                current_tokens = sentence_tokens
            else:
                # 加入当前句子
                if current_chunk_sentences:
                    current_chunk_sentences.append(sentence)
                    current_tokens += separator_tokens + sentence_tokens
                else:
                    current_chunk_sentences.append(sentence)
                    current_tokens += sentence_tokens

        # 处理最后一个分块
        if current_chunk_sentences:
            chunks.append(" ".join(current_chunk_sentences))

        return chunks
