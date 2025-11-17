"""
记忆策略模块

该模块定义了不同的记忆处理策略，用于在对话系统中管理对话历史和记忆检索。
包含多种策略实现，如滑动窗口、总结增强滑动窗口、RAG增强滑动窗口和无记忆策略。

主要功能：
- 定义记忆处理策略接口
- 实现多种记忆管理策略
- 提供对话历史压缩和检索功能
- 支持基于向量的记忆存储和查询

依赖模块：
- chunking_messages: 文本分块处理
- message_service: 消息服务
- summary_service: 摘要服务
- vector_memory: 向量记忆存储
"""

from abc import ABC, abstractmethod
from typing import List, Tuple, Optional, Dict, Any

# from app.services import get_message_service
# from app.services.summary_service import get_summary_service
from app.repositories.message_repository import MessageRepository
from app.services import MessageService
from app.tokenizer.auto_tokenizer import get_tokenizer
from app.utils.chunking import chunking_text, preprocess_text
from app.utils.vector_memory import get_vector_memory

vector_memory = get_vector_memory()


class RAGHelper:
    """RAG 功能辅助类"""

    def __init__(self):
        pass

    def _get_exclusion_condition(self, active_message_ids):
        """获取排除条件"""
        return {
            {"message_id": {"$nin": list(active_message_ids)}},
        }

    def create_memory_message(self, memory_result):
        """创建记忆消息"""

        context_messages = MessageRepository.get_conversation_messages(
            memory_result["message_id"]
        )
        content = "\n".join(
            [
                f"{message['role']}: {message['content']}"
                for message in context_messages
                if message["role"] != "system"
            ]
        )

        return {
            "role": "system",
            "content": f"<recollection>根据最新输入回忆的早期对话，可能相关也可能不相关，根据实际情况决定是否使用：\n{content}</recollection>",
            "is_memory": True,
        }

    def add_memory_from_messages(self, session_id, conversation: list[dict]):
        """从消息中添加记忆"""
        # 删除上一次用户消息对应的记忆
        if not conversation:
            return
        conversation_id = conversation[0]["id"]
        vector_memory.delete_memory_by_message_id(message_id=conversation_id)
        content_parts = []
        for message in conversation:
            if isinstance(message["content"], list[dict]):
                content.append(message["content"][0]["text"])
            else:
                content.append(message["content"])
        content = "\n".join(content_parts)
        chunks = chunking_text(
            preprocess_text(content),
            max_chunk_size=400,
            overlap_size=30,
            min_chunk_size=80,
        )
        for chunk in chunks:
            # 添加新的记忆
            vector_memory.add_memory(
                session_id=session_id,
                content=chunk,
                metadata={
                    "message_id": conversation_id,
                },
            )

    def query_relevant_memories(
        self,
        context_messages: list[dict],
        session_id: str,
        n_results: int = 3,
        score_threshold: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        查询相关记忆

        Args:
            query_text: 查询文本
            session_id: 会话ID
            active_message_ids: 活跃消息ID集合
            n_results: 返回结果数量
            score_threshold: 分数阈值

        Returns:
            相关记忆列表
        """
        frist_message = context_messages[0]
        user_message = context_messages[-1]
        exclusion_condition = {
            "message_id": {"<": frist_message["id"]},
        }

        memory_results = vector_memory.query_memories(
            query_text=user_message["content"],
            session_id=session_id,
            n_results=n_results,
            where=exclusion_condition,
        )
        for result in memory_results:
            print(
                f"RAG - 内容: {result['content'][:50]}..., 相似度: {result['score']:.3f}"
            )
        # 过滤并返回高分数结果
        return [
            result for result in memory_results if result["score"] >= score_threshold
        ]


# 创建全局 RAG 辅助实例
rag_helper = RAGHelper()


class MemoryStrategy(ABC):
    """记忆处理策略接口"""

    @abstractmethod
    def pre_process_memory(self, session: dict, user_message: dict) -> dict:
        """
        预处理内存数据的抽象方法

        该方法用于在处理用户消息之前对会话内存进行预处理操作，
        具体实现由子类负责提供

        参数:
            session (dict): 会话上下文信息，包含当前对话的状态和历史记录
            user_message (dict): 用户发送的消息内容及相关元数据

        返回:
            dict: 处理后的内存数据，用于后续的消息处理流程
        """
        pass

    @abstractmethod
    def process_memory(self, session: dict, context_messages: list[dict]) -> list[dict]:
        """
        抽象方法，用于处理内存中的会话数据和上下文消息

        参数:
            session (dict): 包含会话信息的字典，用于存储会话状态和相关数据
            context_messages (list[dict]): 上下文消息列表，每个消息为包含角色和内容的字典

        返回值:
            list[dict]: 待处理消息列表，每个消息为包含角色和内容的字典

        说明:
            该方法需要被子类实现，用于根据会话状态和上下文消息进行内存处理操作
        """
        pass

    @abstractmethod
    def get_messages(self) -> list[dict]:
        """获取会话历史消息"""
        pass

    @abstractmethod
    def post_process_memory(self, session: dict, conversation: list[dict]) -> None:
        """
        抽象方法，用于在对话结束后对内存进行后处理操作

        该方法需要在子类中实现，负责处理会话结束后的内存清理、数据持久化
        或其他后处理逻辑

        参数:
            session (dict): 包含会话相关信息的字典，可能包含用户ID、会话ID等上下文信息
            conversation (list[dict]): 对话历史记录列表，每个元素为包含角色和内容的字典

        返回值:
            None: 该方法不返回任何值，主要执行副作用操作

        异常:
            NotImplementedError: 由于是抽象方法，直接调用会抛出此异常
        """
        pass


class SlidingWindowStrategy(MemoryStrategy):
    """滑动窗口记忆策略"""

    _messages: list[dict] = []
    continue_fetch_messages = True

    def __init__(self):
        pass

    def pre_process_memory(self, session: dict, user_message: dict):
        if self.continue_fetch_messages:
            max_memory_length = session["settings"].get("max_memory_length", 200) or 200
            self.continue_fetch_messages = False
            return {"offset": 0, "limit": max_memory_length, "direction": "desc"}
        return None

    def process_memory(self, session: dict, context_messages: list[dict]) -> None:
        context_messages.reverse()
        self._messages = context_messages

    def get_messages(self) -> list[dict]:
        return self._messages

    def post_process_memory(self, session: dict, conversation: list[dict]):
        # 滑动窗口策略不需要处理对话后的记忆
        pass


class TokenAwareSlidingWindowStrategy(MemoryStrategy):
    """基于Token的记忆策略"""

    continue_fetch_messages = True
    betch_size = 20
    betch_offset = 0
    model_name = "gpt-3.5-turbo"
    max_memory_tokens = 1000
    total_tokens = 0
    _messages: list[dict] = []

    def __init__(self, settings: dict):
        self.model_name = settings.get("model_name", "gpt-3.5-turbo")
        self.tokenizer = get_tokenizer(self.model_name)

    def pre_process_memory(self, session: dict, user_message):
        if self.continue_fetch_messages:
            conditions = {
                "offset": self.betch_offset,
                "limit": self.betch_size,
                "direction": "desc",
            }
            self.betch_offset += self.betch_size
            return conditions
        else:
            return None

    def process_memory(self, session: dict, context_messages: list[dict]) -> None:
        # 从后往前遍历，避免修改列表顺序
        for i in range(len(context_messages) - 1, -1, -1):
            message = context_messages[i]
            tokens = self.tokenizer.count_tokens(message["content"])
            if self.total_tokens + tokens > self.max_memory_tokens:
                self.continue_fetch_messages = False
                context_messages = context_messages[i + 1 :]  # +1 跳过当前消息
                break

        self._messages.append(message)

    def get_messages(self) -> list[dict]:
        return reversed(self._messages)

    def post_process_memory(self, session: dict, conversation: list[dict]) -> None:
        pass


class SummaryAugmentedSlidingWindowStrategy(MemoryStrategy):
    """总结增强滑动窗口策略"""

    _messages: list[dict] = []
    continue_fetch_messages = True

    def __init__(self):
        from app.services.domain.summary_service import SummaryService

        self.summary_service = SummaryService()

    def pre_process_memory(self, session: dict, user_message):
        if self.continue_fetch_messages:
            after_id = self.summary_service.get_last_message_id(session["id"])
            conditions = {
                "after_id": after_id,
                "direction": "asc",
            }
            self.continue_fetch_messages = False
            return conditions
        else:
            return None

    def process_memory(self, session: dict, context_messages: list[dict]) -> None:
        """
        处理会话记忆，生成并返回最终的消息列表。

        Args:
        session_id (str): 会话ID。
        character (dict): 角色信息。
        current_message_id (str): 当前消息的ID。

        Returns:
        list[dict]: 包含最终消息列表的字典列表。

        """

        # TODO 将用户记录临时移除，避免被压缩，但是这里应该有更好的做法
        user_message = None
        if len(context_messages) > 0 and context_messages[-1]["role"] == "user":
            user_message = context_messages.pop()

        compression_result = self.summary_service.conditionally_compress_history(
            session["id"], context_messages=context_messages
        )

        summaries = compression_result.summaries
        active_messages = compression_result.active_messages

        # 将用户输入重新加入历史记录
        if user_message is not None:
            active_messages.append(user_message)

        if summaries:
            content = "\n".join([result["content"] for result in summaries])
            self._messages.append(
                {
                    "role": "system",
                    "content": f"<experience>#早期对话摘要：\n{content}</experience>",
                    "is_summary": True,  # 添加标记表明这是记忆消息
                }
            )

        self._messages.extend(active_messages)

    def get_messages(self) -> list[dict]:
        return self._messages

    def post_process_memory(self, session: dict, conversation: list[dict]) -> None:
        pass


class MemorylessStrategy(MemoryStrategy):
    """无记忆策略"""

    _message = None
    continue_fetch_messages = True

    def __init__(self):
        self.message_service = MessageService()

    def pre_process_memory(self, session: dict, user_message):
        if self.continue_fetch_messages:
            self.continue_fetch_messages = False
            return {
                "limit": 1,
                "direction": "desc",
            }
        return None

    def process_memory(self, session: dict, context_messages: list[dict]) -> None:
        self._message = context_messages[-1]

    def post_process_memory(self, session: dict, conversation: list[dict]) -> None:
        pass

    def get_messages(self) -> list[dict]:
        return [self._message]
