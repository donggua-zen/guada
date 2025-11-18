import logging
import re
from typing import List, Dict, Optional
import unicodedata

logger = logging.getLogger(__name__)


def count_effective_length(text: str) -> int:
    """
    计算中英文混合文本的有效长度
    中文按字符计数，英文按单词计数
    """
    if not text:
        return 0

    # 分离中文字符和英文单词
    chinese_chars = re.findall(r"[\u4e00-\u9fff]", text)
    english_words = re.findall(r"[a-zA-Z]+", text)
    other_chars = len(text) - len("".join(chinese_chars)) - len("".join(english_words))

    # 中文按字符计数，英文按单词计数，其他字符按字符计数
    return len(chinese_chars) + len(english_words) + other_chars


def chunking_messages(
    messages: List[Dict],
    max_threshold: int,
    safe_threshold: int,
    chunk_size: int,
    absolute_max_limit: int = None,
) -> List[List[Dict]]:
    """
    将对话消息列表按字数分块，智能处理问答对以优化分块大小

    Args:
        messages: 对话消息列表，已按时间排序，每条消息包含 'id', 'role', 'content', 'parent_id'
        max_threshold: 触发分块的最大字数阈值
        safe_threshold: 安全阈值，剩余消息字数小于等于此值时单独成块
        chunk_size: 目标分块大小（字数）

    Returns:
        list: 分块后的消息列表，每个元素是一个消息块
    """
    # 计算总字数
    total_chars = sum(
        count_effective_length(msg.get("content", "")) for msg in messages
    )

    # 如果总字数不超过最大阈值，直接返回整个对话
    if total_chars <= max_threshold:
        return [messages]

    chunks = []  # 存储所有分块
    current_chunk = []  # 当前正在构建的分块
    current_chars = 0  # 当前分块的字数统计

    # 动态分块范围：设置最小和最大块大小以减少波动
    min_chunk_size = max(chunk_size // 2, 100)  # 最小块大小基于分块大小，避免过小
    max_chunk_size = int(chunk_size * 1.5)  # 最大块大小允许10%上浮
    logger.debug(f"min_chunk_size:{min_chunk_size} max_chunk_size:{max_chunk_size}")
    remaining_chars = total_chars
    i = 0
    while i < len(messages):
        # 检查剩余消息是否可以直接作为最后一个分块
        if remaining_chars <= safe_threshold:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = []
            # 将剩余所有消息作为一个独立的分块
            chunks.append(messages[i:])
            break

        msg = messages[i]
        msg_chars = count_effective_length(msg.get("content", ""))
        # 检查是否应该结束当前分块
        if current_chars + msg_chars > chunk_size and current_chars >= min_chunk_size:
            # 优先检查对话完整性：当前消息是否为user，且下一条是它的回答
            if (
                msg.get("role") == "user"
                and i + 1 < len(messages)
                and messages[i + 1].get("role") == "assistant"
                and messages[i + 1].get("parent_id") == msg.get("id")
            ):

                next_msg = messages[i + 1]
                next_chars = count_effective_length(next_msg.get("content", ""))
                qa_pair_chars = msg_chars + next_chars

                if current_chars + qa_pair_chars <= max_chunk_size:
                    # 将问答对加入当前分块
                    current_chunk.append(msg)
                    current_chunk.append(next_msg)
                    current_chars += qa_pair_chars
                    remaining_chars -= qa_pair_chars
                    i += 2  # 跳过下一条消息

            elif current_chars + msg_chars <= max_chunk_size:
                current_chunk.append(msg)
                i += 1
                current_chars += msg_chars
                remaining_chars -= msg_chars

            # if absolute_max_limit is not None and current_chars > absolute_max_limit:
            #    chunk_last_msg = current_chunk[-1]
            #    split = min()

            chunks.append(current_chunk)
            current_chunk = []
            current_chars = 0
        else:
            # 将当前消息添加到分块
            current_chunk.append(msg)
            current_chars += msg_chars
            remaining_chars -= msg_chars
            i += 1

    # 添加最后一个分块（如果有）
    # if current_chunk:
    #     chunks.append(current_chunk)

    return chunks


def chunking_text(
    text: str,
    max_chunk_size: int = 1000,
    overlap_size: int = 100,
    min_chunk_size: int = 50,
) -> List[str]:
    """
    文本分块函数，避免最后一块过小
    参数:
    - text: 需要分块的文本
    - max_chunk_size: 每个块的最大字符数限制
    - overlap_size: 叠加文字的长度
    - min_chunk_size: 最小块大小，小于此值的块会被合并到前一个块
    返回值: 文本块列表
    """
    # 参数验证
    if not text:
        return []
    if max_chunk_size <= overlap_size:
        raise ValueError("max_chunk_size必须大于overlap_size")
    if overlap_size < 0:
        raise ValueError("overlap_size不能为负数")
    if overlap_size >= max_chunk_size:
        raise ValueError("overlap_size必须小于max_chunk_size")
    if min_chunk_size < 0:
        raise ValueError("min_chunk_size不能为负数")
    text_length = len(text)
    # 如果文本长度小于等于最大块大小，直接返回整个文本
    if text_length <= max_chunk_size:
        return [text]
    # 初始分块（不考虑叠加）
    chunk_max_capacity = max_chunk_size - min_chunk_size
    chunks = []
    start = 0
    while start < text_length:
        end = min(
            start + (chunk_max_capacity if start > 0 else max_chunk_size),
            text_length,
        )
        chunk = text[start:end]
        chunks.append(chunk)
        start = end
    # 处理最后一块过小的情况
    if len(chunks) > 1 and len(chunks[-1]) < min_chunk_size:
        # 将最后一块合并到前一块
        last_chunk = chunks.pop()
        prev_chunk = chunks.pop()
        # 计算合并后的长度
        combined_length = len(prev_chunk) + len(last_chunk)
        # 如果合并后长度超过限制，可能需要调整
        if combined_length > chunk_max_capacity:
            # 策略1: 截断前一块的内容
            excess = combined_length - chunk_max_capacity
            if len(prev_chunk) > excess:
                prev_chunk = prev_chunk[:-excess]
            # 策略2: 如果前一块太短，则接受稍大的块
            # 这里我们选择策略2，接受稍大的块
            pass
        chunks.append(prev_chunk + last_chunk)
    # 添加叠加文字（从第二个块开始）
    for i in range(1, len(chunks)):
        # 获取前一个块的末尾部分作为叠加
        overlap_text = chunks[i - 1][-overlap_size:]
        logger.debug("********叠加文字：", overlap_text)
        # 将叠加文字添加到当前块的开头
        chunks[i] = overlap_text + chunks[i]
        # # 确保添加叠加后不超过最大长度
        # if len(chunks[i]) > max_chunk_size:
        #     # 如果超过，截断当前块的开头部分
        #     excess = len(chunks[i]) - max_chunk_size
        #     chunks[i] = chunks[i][excess:]
    return chunks


def preprocess_text(
    text: str,
    max_length: Optional[int] = None,
    remove_extra_whitespace: bool = True,
    normalize_unicode: bool = True,
    remove_control_chars: bool = True,
    collapse_repeated_chars: bool = True,
) -> str:
    """
    为RAG检索预处理文本，删除多余空白字符，同时保持语义完整性

    参数:
    - text: 要预处理的文本
    - max_length: 最大长度限制，如果提供则截断文本
    - remove_extra_whitespace: 是否删除多余空白字符
    - normalize_unicode: 是否标准化Unicode字符
    - remove_control_chars: 是否删除控制字符
    - collapse_repeated_chars: 是否压缩重复字符（如多个标点）

    返回:
    预处理后的文本
    """
    if not text:
        return text

    # 步骤1: 标准化Unicode字符（将全角字符转为半角等）
    if normalize_unicode:
        text = unicodedata.normalize("NFKC", text)

    # 步骤2: 删除控制字符（除空格、制表符、换行符外）
    if remove_control_chars:
        # 保留空格、制表符、换行符
        text = "".join(
            char
            for char in text
            if char.isprintable() or char in (" ", "\t", "\n", "\r")
        )

    # 步骤3: 处理多余空白字符
    if remove_extra_whitespace:
        # 将所有空白字符（包括换行、制表符）替换为单个空格
        text = re.sub(r"\s+", " ", text)
        # 去除首尾空格
        text = text.strip()

    # 步骤4: 可选 - 压缩重复字符（如多个标点符号）
    if collapse_repeated_chars:
        # 压缩重复的标点符号（保留一个）
        text = re.sub(r"([!?.,;:])\1+", r"\1", text)

    # 步骤3: 处理标点符号
    # remove_punctuation=True
    # keep_essential_punctuation=True
    # if remove_punctuation:
    #     if keep_essential_punctuation:
    #         # 定义要保留的必要标点（用于电子邮件、网址等）
    #         essential_chars = {'@', '.', '-', '_', '/', ':', '#'}
    #         # 删除非必要标点
    #         text = ''.join(
    #             char for char in text
    #             if not (char in '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' and char not in essential_chars)
    #         )
    #     else:
    #         # 删除所有标点
    #         text = re.sub(r'[^\w\s]', '', text)

    return text
