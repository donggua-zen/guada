"""
聊天服务模块

该模块提供核心的聊天功能，包括:
1. 构造系统提示和上下文消息
2. 调用大语言模型生成回复
3. 管理不同的记忆策略
4. 模型供应商映射

通过该服务，可以实现角色扮演对话系统的核心功能，支持多种记忆策略和模型供应商的集成。
"""

from typing import List, Optional, Tuple
from ai_models import ai_models
from llm_service_factory import llm_service_factory
from memory_strategy import MemoryStrategy, SlidingWindowWithRAGStrategy


class _ChatService:
    def __init__(self):
        pass

    def _construct_system_prompt(self, character, system_messages):
        """获取系统提示"""
        system_prompt = ""
        if "name" in character:
            system_prompt += f"你的名字叫{character['name']},"
        if "identity" in character:
            system_prompt += f"\n你的设定是：\n{character['identity']}"
        if "detailed_setting" in character:
            system_prompt += f"\n{character['detailed_setting']}"
        for message in system_messages:
            if message["role"] == "system":
                system_prompt += f"\n{message['content']}"
        return system_prompt

    def _construct_context_message(self, character, messages):
        """
        根据角色和消息构造上下文消息列表。

        Args:
        character (str): 角色名称。
        messages (list): 消息列表，其中每个消息是一个字典，包含 "role" 和 "content" 两个键。

        Returns:
        list: 构造后的上下文消息列表，每个消息是一个字典，包含 "role" 和 "content" 两个键。

        """
        system_prompt = self._construct_system_prompt(
            character, [msg for msg in messages if msg["role"] == "system"]
        )
        context_messages = [{"role": "system", "content": system_prompt}]
        context_messages.extend(
            [
                {"role": msg["role"], "content": msg["content"]}
                for msg in messages
                if msg["role"] != "system"
            ]
        )
        print(
            f"--------------------({len(context_messages)} messages)-----------------------------"
        )
        if len(context_messages) > 0:
            for msg in context_messages[:3]:
                print(f"{msg['role']}: {msg['content']}")
            print(f".......")
        if len(context_messages) > 3:
            for msg in context_messages[-1:]:
                print(f"{msg['role']}: {msg['content']}")
        print("------------------------------------------------------------")
        return context_messages

    def completions(self, character, messages):
        """
        根据输入的角色、摘要和消息生成回复。

        Args:
        character (dict): 包含角色信息的字典，至少包含 'model' 键。
        summary (Optional[Summary]): 摘要对象。
        messages (list): 消息列表，每个元素为一个字符串。

        Returns:
        str: 根据输入生成的回复。

        """
        llm_service = llm_service_factory.get_service(
            self._get_provider_for_model(character["model"])
        )
        context_messages = self._construct_context_message(character, messages)
        generatior = llm_service.generate_response(
            character["model"],
            context_messages,
            temperature=0.75,
            stream=True,
            thinking=True,
        )
        return generatior

    def get_memory_strategy(self, character: dict) -> MemoryStrategy:
        """
        根据角色配置获取记忆策略实例

        Args:
            character: 角色信息

        Returns:
            记忆策略实例
        """
        from memory_strategy import (
            MemorylessStrategy,
            SlidingWindowStrategy,
            SummaryAugmentedSlidingWindowStrategy,
        )

        memory_type = character.get("memory_type", "sliding_window")
        if memory_type == "sliding_window":
            return SlidingWindowStrategy()
        elif memory_type == "summary_augmented_sliding_window":
            return SummaryAugmentedSlidingWindowStrategy()
        elif memory_type == "sliding_window_with_rag":
            return SlidingWindowWithRAGStrategy()
        else:
            return MemorylessStrategy()

    def _get_provider_for_model(self, model_name: str) -> str:
        """
        根据模型名称查找对应的供应商
        这里需要实现从模型到供应商的映射逻辑
        """
        # 示例实现：遍历ai_modes查找匹配的模型
        for model in ai_models:
            if model["name"] == model_name:
                return model["provider"]

        # 默认回退到阿里云
        return "aliyun"


_chat_service = _ChatService()


def get_chat_service() -> _ChatService:
    return _chat_service
