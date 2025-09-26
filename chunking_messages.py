import re
from typing import List, Dict, Optional
import unicodedata


class ChunkingMessages:
    def chunking(
        self,
        messages: List[Dict[str, str]],
        max_chunk_size: int = 1000,
        short_term_memory_count: int = 10,
        min_chunk_size: int = 50,
        min_merge_size: int = 100,
        max_short_term_chars: Optional[int] = None,
    ) -> List[List[Dict[str, str]]]:
        """
        智能消息分块函数优化版

        参数:
        - messages: 消息列表，每个消息为 {"role":"xxx","content":"xxx"}
        - max_chunk_size: 每个块的最大字数限制
        - short_term_memory_count: 保留作为短期记忆的消息条数
        - min_chunk_size: 最小块大小，小于此值的小块不会被单独保存
        - min_merge_size: 最小合并空间，至少有这么多空间才尝试合并超长消息的一部分
        - max_short_term_chars: 最大短期记忆字数，如果为None则使用max_chunk_size

        返回值: 块数组
        """

        if not messages:
            return []

        # 设置默认值
        if max_short_term_chars is None:
            max_short_term_chars = max_chunk_size

        # 计算实际可保留的短期记忆条数
        actual_short_term_count = min(short_term_memory_count, len(messages))

        # 分离历史消息和短期记忆候选
        historical_messages = messages[:-actual_short_term_count]
        short_term_candidates = messages[-actual_short_term_count:]

        # 计算短期记忆候选的总字数
        short_term_total_chars = sum(
            len(msg["content"]) for msg in short_term_candidates
        )

        # 如果所有消息都可以作为短期记忆且不超限，直接返回
        if (
            len(messages) <= short_term_memory_count
            and short_term_total_chars <= max_short_term_chars
        ):
            return [messages]

        # 动态调整短期记忆，确保不超过字数限制
        while short_term_total_chars > max_short_term_chars and short_term_candidates:
            # 从短期记忆候选中最旧的消息开始移除（保持最新的消息）
            removed_msg = short_term_candidates.pop(0)  # 改为从开头移除，保留最新消息
            historical_messages.append(removed_msg)
            short_term_total_chars -= len(removed_msg["content"])

        # 对历史消息进行分块
        chunks = self._chunk_messages(
            historical_messages, max_chunk_size, min_chunk_size, min_merge_size
        )

        # 添加短期记忆作为最后一个块
        chunks.append(short_term_candidates)

        return chunks

    def _chunk_messages(
        self,
        messages: List[Dict[str, str]],
        max_chunk_size: int,
        min_chunk_size: int,
        min_merge_size: int,
    ) -> List[List[Dict[str, str]]]:
        """
        核心分块函数，处理消息分块逻辑
        """
        chunks = []
        current_chunk = []
        current_chunk_size = 0

        i = 0
        while i < len(messages):
            message = messages[i]
            message_content = message["content"]
            message_size = len(message_content)

            if message_size > max_chunk_size:
                if current_chunk and current_chunk_size > min_chunk_size:
                    chunks.append(current_chunk)
                    current_chunk = []
                    current_chunk_size = 0

                if current_chunk:
                    remaining_space = max_chunk_size - current_chunk_size
                    if remaining_space >= min_merge_size:
                        partial_content = message_content[:remaining_space]
                        truncate_point = self._find_sentence_boundary(
                            partial_content, remaining_space - 50
                        )
                        if truncate_point > 0:
                            partial_content = partial_content[:truncate_point] + ".."

                        partial_message = {
                            "role": message["role"],
                            "content": partial_content,
                            "is_partial": True,
                        }
                        current_chunk.append(partial_message)
                        chunks.append(current_chunk)

                        remaining_content = message_content[
                            truncate_point if truncate_point > 0 else remaining_space :
                        ]
                        if remaining_content:
                            split_messages = self._split_long_message(
                                {"role": message["role"], "content": remaining_content},
                                max_chunk_size,
                            )
                            for split_msg in split_messages:
                                chunks.append([split_msg])
                    else:
                        chunks.append(current_chunk)
                        split_messages = self._split_long_message(
                            message, max_chunk_size
                        )
                        for split_msg in split_messages:
                            chunks.append([split_msg])
                else:
                    split_messages = self._split_long_message(message, max_chunk_size)
                    for split_msg in split_messages:
                        chunks.append([split_msg])

                i += 1
                current_chunk = []
                current_chunk_size = 0
                continue

            if current_chunk_size + message_size <= max_chunk_size:
                current_chunk.append(message)
                current_chunk_size += message_size
                i += 1
            else:
                if current_chunk:
                    chunks.append(current_chunk)

                # overlap_chunk = self._create_overlap_chunk(
                #     current_chunk, min(100, max_chunk_size // 10)
                # )
                # current_chunk = overlap_chunk
                # current_chunk_size = sum(len(msg["content"]) for msg in overlap_chunk)
                current_chunk = []
                current_chunk_size = 0

        if current_chunk and current_chunk_size >= min_chunk_size:
            chunks.append(current_chunk)

        return chunks

    def _split_long_message(
        self, message: Dict[str, str], max_chunk_size: int
    ) -> List[Dict[str, str]]:
        """
        分割超长消息，保持语义完整性
        """
        content = message["content"]
        role = message["role"]

        if len(content) <= max_chunk_size:
            return [message]

        split_points = []
        for i in range(max_chunk_size, len(content), max_chunk_size):
            found = False
            for j in range(i, max(i - 100, 0), -1):
                if j < len(content) and content[j] in {
                    "。",
                    "！",
                    "？",
                    ".",
                    "!",
                    "?",
                    "\n",
                    ";",
                    "；",
                    "，",
                    ",",
                }:
                    split_points.append(j + 1)
                    found = True
                    break

            if not found:
                split_points.append(i)

        split_messages = []
        start = 0
        for split_point in split_points:
            end = min(split_point, len(content))
            chunk_content = content[start:end]
            if end < len(content):
                chunk_content += ".."

            split_msg = {"role": role, "content": chunk_content}

            if start > 0:
                split_msg["is_continuation"] = True

            split_messages.append(split_msg)
            start = end

        if start < len(content):
            split_messages.append(
                {"role": role, "content": content[start:], "is_continuation": True}
            )

        return split_messages

    def _create_overlap_chunk(
        self, previous_chunk: List[Dict[str, str]], overlap_size: int
    ) -> List[Dict[str, str]]:
        """
        创建重叠块，保留部分上文内容
        """
        if not previous_chunk:
            return []

        overlap_chunk = []
        current_size = 0

        for i in range(len(previous_chunk) - 1, -1, -1):
            msg = previous_chunk[i]
            msg_size = len(msg["content"])

            if current_size + msg_size <= overlap_size:
                overlap_chunk.insert(0, msg)
                current_size += msg_size
            else:
                remaining_size = overlap_size - current_size
                if remaining_size > 20:
                    truncate_point = self._find_sentence_boundary(
                        msg["content"], remaining_size
                    )
                    if truncate_point > 0:
                        truncated_content = msg["content"][-truncate_point:] + ".."
                    else:
                        truncated_content = msg["content"][-remaining_size:] + ".."

                    truncated_msg = {
                        "role": msg["role"],
                        "content": truncated_content,
                        "is_truncated": True,
                    }
                    overlap_chunk.insert(0, truncated_msg)
                break

        return overlap_chunk

    def _find_sentence_boundary(self, text: str, max_length: int) -> int:
        """
        在文本中寻找合适的句子边界
        """
        if len(text) <= max_length:
            return len(text)

        for i in range(max_length, max(max_length - 100, 0), -1):
            if i < len(text) and text[i] in {
                "。",
                "！",
                "？",
                ".",
                "!",
                "?",
                "\n",
                ";",
                "；",
            }:
                return i + 1

        for i in range(max_length, max(max_length - 50, 0), -1):
            if i < len(text) and text[i] in {"，", ",", " "}:
                return i + 1

        return max_length



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
        print("********叠加文字：", overlap_text)
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
