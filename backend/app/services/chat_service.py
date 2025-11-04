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


class ChatService:
    def __init__(self):
        pass

    def _construct_system_prompt(self, prompts, system_messages):
        """获取系统提示"""
        system_prompt = ""
        if "assistant_name" in prompts:
            system_prompt += f"你的名字叫{prompts['assistant_name']},"
        if "assistant_identity" in prompts:
            system_prompt += f"\n你的设定是：\n{prompts['assistant_identity']}"
        if "system_prompt" in prompts:
            system_prompt += f"\n{prompts['system_prompt']}"
        for message in system_messages:
            if message["role"] == "system":
                system_prompt += f"\n{message['content']}"
        return system_prompt

    def _construct_context_message(self, prompts, messages, merge=False):
        """
        根据角色和消息构造上下文消息列表。

        Args:
        character (str): 角色名称。
        messages (list): 消息列表，其中每个消息是一个字典，包含 "role" 和 "content" 两个键。

        Returns:
        list: 构造后的上下文消息列表，每个消息是一个字典，包含 "role" 和 "content" 两个键。

        """
        system_prompt = self._construct_system_prompt(
            prompts, [msg for msg in messages if msg["role"] == "system"]
        )
        print(
            f"--------------------({len(messages)} messages)-----------------------------"
        )
        if len(messages) > 0:
            for msg in messages[:3]:
                print(f"{msg['role']}: {msg['content']}")
            print(f".......")
        if len(messages) > 3:
            for msg in messages[-1:]:
                print(f"{msg['role']}: {msg['content']}")
        print("------------------------------------------------------------")
        if merge:
            prompt = f"<system_prompt> 你的设定\n<history> 历史记录\n<user_input> 用户最新输入\n"
            prompt += f"<system_prompt>{system_prompt}</system_prompt>\n"
            prompt += "<history>"
            if len(messages) > 1:
                prompt += "\n".join(
                    [
                        f"<message role=\"{msg['role']}\">{msg['content']}</message>"
                        for msg in messages[:-1]
                    ]
                )
            prompt += "</history>"
            prompt += f"<user_input>{messages[-1]["content"]}</user_input>"
            context_messages = [{"role": "user", "content": prompt}]
        else:
            context_messages = [{"role": "system", "content": system_prompt}]
            context_messages.extend(
                [
                    {"role": msg["role"], "content": msg["content"]}
                    for msg in messages
                    if msg["role"] != "system"
                ]
            )
        return context_messages

    def construct_context_message(self, session: dict, messages: list[dict]):
        context_messages = self._construct_context_message(
            {
                "assistant_name": (
                    session["settings"]["assistant_name"]
                    if "assistant_name" in session["settings"]
                    else None
                ),
                "assistant_identity": (
                    session["settings"]["assistant_identity"]
                    if "assistant_identity" in session["settings"]
                    else None
                ),
                "system_prompt": (
                    session["settings"].get("system_prompt")
                    if "system_prompt" in session["settings"]
                    else ""
                ),
            },
            messages,
        )
        return context_messages

    def completions(self, session: dict, messages: list[dict]):
        """
        根据输入的角色、摘要和消息生成回复。

        Args:
        character (dict): 包含角色信息的字典，至少包含 'model' 键。
        summary (Optional[Summary]): 摘要对象。
        messages (list): 消息列表，每个元素为一个字符串。

        Returns:
        str: 根据输入生成的回复。

        """
        from app.services import ModelService, LLMService  # 避免循环导入

        model_service = ModelService()
        model = model_service.get_model(session["settings"]["model_id"])
        if model is None:
            raise ValueError("Invalid model name")

        support_thinking = True if "thinking" in model["features"] else None

        llm_service = LLMService(
            model["provider"]["api_url"], model["provider"]["api_key"]
        )
        context_messages = self.construct_context_message(session, messages)
        generatior = llm_service.generate_response(
            model["model_name"],
            context_messages,
            temperature=0.75,
            stream=True,
            thinking=support_thinking,
        )
        return generatior
