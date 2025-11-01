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

from services import vector_memory, message_service, summary_service
from utils.chunking import chunking_text, preprocess_text


class RAGHelper:
    """RAG 功能辅助类"""

    def __init__(self):
        pass

    def _get_exclusion_condition(self, active_message_ids):
        """获取排除条件"""
        return {
            "$and": [
                {"message_id_1": {"$nin": list(active_message_ids)}},
                {"message_id_2": {"$nin": list(active_message_ids)}},
            ]
        }

    def create_memory_message(self, memory_result):
        """创建记忆消息"""
        msg1 = self.message_service.get_message(memory_result["message_id_1"])
        msg2 = self.message_service.get_message(memory_result["message_id_2"])
        content = (
            f'{{"role": "{msg1["role"]}", "content": "{msg1["content"]}"}}'
            f'{{"role": "{msg2["role"]}", "content": "{msg2["content"]}"}}'
        )

        return {
            "role": "system",
            "content": f"<recollection>根据最新输入回忆的稍早前对话，可能相关也可能不相关，根据实际情况决定是否使用：\n{content}</recollection>",
            "is_memory": True,
        }

    def add_memory_from_messages(self, session_id, user_message, assistant_message):
        """从消息中添加记忆"""
        # 删除上一次用户消息对应的记忆
        vector_memory.delete_memory_by_message_id(message_id=user_message["id"])
        content = f"{user_message['content']}\n{assistant_message['content']}"
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
                    "message_id_1": user_message["id"],
                    "message_id_2": assistant_message["id"],
                },
            )

    def query_relevant_memories(
        self,
        query_text: str,
        session_id: str,
        active_message_ids: set,
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
        exclusion_condition = self._get_exclusion_condition(active_message_ids)

        memory_results = vector_memory.query_memories(
            query_text=query_text,
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

    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super().__new__(cls, *args, **kwargs)
        return cls._instance

    """记忆处理策略接口"""

    @abstractmethod
    def process_memory(
        self, session: dict, current_message_id: str
    ) -> Tuple[List[dict]]:
        """
        处理记忆逻辑

        Args:
            session_id: 会话ID
            character: 角色信息
            current_message_id: 结束消息ID

        Returns:
            处理后的消息列表和摘要信息
        """
        pass

    @abstractmethod
    def post_process_memory(
        self,
        session: dict,
        user_message: dict,
        assistant_message: dict,
    ):
        """
        处理对话后的记忆逻辑

        Args:
            session_id: 会话ID
            user_message: 用户消息
            assistant_message: 助手消息
        """
        pass


class SlidingWindowStrategy(MemoryStrategy):
    """滑动窗口记忆策略"""

    def process_memory(self, session: dict, current_message_id: str):
        messages = message_service.get_messages(
            session_id=session["id"],
            tail_message_id=current_message_id,
            last_n_messages=10,
        )
        return messages

    def post_process_memory(self, session: dict, user_message, assistant_message):
        # 滑动窗口策略不需要处理对话后的记忆
        pass


class SummaryAugmentedSlidingWindowStrategy(MemoryStrategy):
    """总结增强滑动窗口策略"""

    def __init__(self):
        self.rag_helper = rag_helper

    def process_memory(self, session: dict, current_message_id: str) -> list[dict]:
        """
        处理会话记忆，生成并返回最终的消息列表。

        Args:
        session_id (str): 会话ID。
        character (dict): 角色信息。
        current_message_id (str): 当前消息的ID。

        Returns:
        list[dict]: 包含最终消息列表的字典列表。

        """
        MEMORY_SCORE_THRESHOLD = 0.58
        start_id = summary_service.get_last_message_id(session["id"])
        messages = message_service.get_messages(
            session_id=session["id"],
            start_message_id=start_id,
            tail_message_id=current_message_id,
        )

        if len(messages) > 0 and messages[0]["id"] == start_id:
            messages.pop(0)

        # TODO 将用户记录临时移除，避免被压缩，但是这里应该有更好的做法
        user_message = None
        if len(messages) > 0 and messages[-1]["role"] == "user":
            user_message = messages.pop()

        compression_result = summary_service.conditionally_compress_history(
            session["id"], character=None, messages=messages
        )

        summaries = compression_result.summaries
        active_messages = compression_result.active_messages

        # 将用户输入重新加入历史记录
        if user_message is not None:
            active_messages.append(user_message)

        final_messages = []

        if summaries:
            content = "\n".join([result["content"] for result in summaries])
            final_messages.append(
                {
                    "role": "system",
                    "content": f"<experience>#剧情回顾：\n{content}</experience>",
                    "is_summary": True,  # 添加标记表明这是记忆消息
                }
            )

        # 获取所有活跃消息的ID
        active_message_ids = {msg["id"] for msg in active_messages}

        # 使用RAG辅助类的统一查询方法
        memory_results = self.rag_helper.query_relevant_memories(
            query_text=active_messages[-1]["content"],
            session_id=session["id"],
            active_message_ids=active_message_ids,
            n_results=3,
            score_threshold=MEMORY_SCORE_THRESHOLD,
        )

        if memory_results:
            # 使用RAG辅助类的方法创建记忆消息
            memory_message = self.rag_helper.create_memory_message(
                memory_results[0]["metadata"]
            )
            final_messages.append(memory_message)

        final_messages.extend(active_messages)
        return final_messages

    def post_process_memory(
        self, session_id, character, user_message, assistant_message
    ):
        # 使用RAG辅助类的方法添加记忆
        self.rag_helper.add_memory_from_messages(
            session_id, user_message, assistant_message
        )


class SlidingWindowWithRAGStrategy(MemoryStrategy):
    """滑动窗口+记忆检索策略"""

    def __init__(self):
        self.rag_helper = rag_helper

    def process_memory(self, session: dict, current_message_id: str):
        # 获取滑动窗口消息
        messages = message_service.get_messages(
            session_id=session["id"],
            tail_message_id=current_message_id,
            last_n_messages=10,
        )

        # 如果没有消息，直接返回
        if not messages:
            return messages

        # 获取所有活跃消息的ID
        active_message_ids = {msg["id"] for msg in messages}

        # 使用RAG辅助类的统一查询方法
        memory_results = self.rag_helper.query_relevant_memories(
            query_text=messages[-1]["content"],
            session_id=session["id"],
            active_message_ids=active_message_ids,
            n_results=1,
            score_threshold=0.6,
        )

        if memory_results:
            # 使用RAG辅助类的方法创建记忆消息
            memory_message = self.rag_helper.create_memory_message(
                memory_results[0]["metadata"]
            )
            messages.insert(0, memory_message)

        return messages

    def post_process_memory(self, session: dict, user_message, assistant_message):
        # 使用RAG辅助类的方法添加记忆
        self.rag_helper.add_memory_from_messages(
            session["id"], user_message, assistant_message
        )


class MemorylessStrategy(MemoryStrategy):
    """无记忆策略"""

    def process_memory(self, session: dict, current_message_id: str):
        messages = [message_service.get_message(current_message_id)]
        return messages

    def post_process_memory(self, session: dict, user_message, assistant_message):
        # 无记忆策略不需要处理对话后的记忆
        pass
