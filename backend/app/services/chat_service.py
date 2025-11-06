"""
聊天服务模块

该模块提供核心的聊天功能，包括:
1. 构造系统提示和上下文消息
2. 调用大语言模型生成回复
3. 管理不同的记忆策略
4. 模型供应商映射

通过该服务，可以实现角色扮演对话系统的核心功能，支持多种记忆策略和模型供应商的集成。
"""

import datetime
import html
from typing import Generator, List, Optional, Tuple

from app.repositories.session_repository import SessionRepository
from app.services.domain.memory_strategy import MemoryStrategy
from app.services.llm_service import LLMServiceChunk
from app.services.message_service import MessageService

message_service = MessageService()


class ChatService:
    def __init__(self):
        pass

    def _construct_system_prompt(self, prompts: dict, system_messages):
        """获取系统提示"""
        # 类型和存在性检查
        if not isinstance(prompts, dict):
            return ""

        if system_messages is None:
            system_messages = []

        system_prompt_parts = []

        # 安全地获取 system_prompt
        if "system_prompt" in prompts:
            system_prompt_parts.append(prompts["system_prompt"])

        # 安全地处理 system_messages
        for message in system_messages:
            if isinstance(message, dict) and message.get("role") == "system":
                content = message.get("content", "")
                if content:  # 只添加非空内容
                    system_prompt_parts.append(content)

        # 使用换行符连接所有部分
        return "\n".join(system_prompt_parts)

    def _construct_context_message(self, prompts, messages, merge=False):
        """
        根据角色和消息构造上下文消息列表。

        Args:
            prompts: 提示词相关对象或信息。
            messages (list): 消息列表，其中每个消息是一个字典，包含 "role" 和 "content" 两个键。
            merge (bool): 是否合并系统提示和历史消息，默认为 False。

        Returns:
            list: 构造后的上下文消息列表，每个消息是一个字典，包含 "role" 和 "content" 两个键。
        """
        system_prompt = self._construct_system_prompt(
            prompts, [msg for msg in messages if msg["role"] == "system"]
        )

        # 注释掉调试输出，防止敏感信息泄漏
        # print(f"--------------------({len(messages)} messages)-----------------------------")
        # if len(messages) > 0:
        #     for msg in messages[:3]:
        #         print(f"{msg['role']}: {msg['content']}")
        #     print(f".......")
        # if len(messages) > 3:
        #     for msg in messages[-1:]:
        #         print(f"{msg['role']}: {msg['content']}")
        # print("------------------------------------------------------------")

        if merge:
            if not messages:
                raise ValueError("当 merge=True 时，messages 不得为空")

            prompt = (
                "<system_prompt> 你的设定\n"
                "<history> 历史记录\n"
                "<user_input> 用户最新输入\n"
            )
            escaped_system_prompt = html.escape(system_prompt)
            prompt += f"<system_prompt>{escaped_system_prompt}</system_prompt>\n"
            prompt += "<history>"
            if len(messages) > 1:
                history_lines = [
                    f"<message role=\"{msg['role']}\">{html.escape(msg['content'])}</message>"
                    for msg in messages[:-1]
                ]
                prompt += "\n".join(history_lines)
            prompt += "</history>"
            user_content = html.escape(messages[-1]["content"])
            prompt += f"<user_input>{user_content}</user_input>"
            context_messages = [{"role": "user", "content": prompt}]
        else:
            context_messages = [{"role": "system", "content": system_prompt}]

        def gen_content(msg):
            """
            生成消息内容，如果包含文件则添加文件内容作为附件。

            Args:
                msg (dict): 包含 'content' 和可选 'files' 键的消息字典

            Returns:
                str or list: 消息内容字符串或包含文本和文件内容的列表
            """
            files = msg.get("files")
            base_content = msg.get("content", "")

            # 如果没有附加文件，直接返回原始内容
            if not files:
                return base_content

            # 构建包含基础内容和文件内容的列表
            content_parts = [
                {
                    "text": base_content,
                    "type": "text",
                }
            ]

            # 添加每个文件的内容
            for i, file in enumerate(files):
                # 确保 file 对象具有所需属性
                file_name = file.get("file_name", "unknow")
                file_content = file.get("content", "")

                file_text = (
                    f"\n\n<ATTACHMENT_FILE>\n"
                    f"<FILE_INDEX>File {i}</FILE_INDEX>\n"
                    f"<FILE_NAME>{file_name}</FILE_NAME>\n"
                    f"<FILE_CONTENT>\n{file_content}\n</FILE_CONTENT>\n"
                    f"</ATTACHMENT_FILE>\n"
                )

                content_parts.append(
                    {
                        "text": file_text,
                        "type": "text",
                    }
                )

            return content_parts

        context_messages.extend(
            [
                {"role": msg["role"], "content": gen_content(msg)}
                for msg in messages
                if msg["role"] != "system"
            ]
        )
        return context_messages

    def construct_context_message(self, session: dict, messages: list[dict]):
        context_messages = self._construct_context_message(
            {
                "assistant_name": (session["settings"].get("assistant_name")),
                "assistant_identity": (session["settings"].get("assistant_identity")),
                "system_prompt": (session["settings"].get("system_prompt", "")),
            },
            messages,
        )
        return context_messages

    def completions(
        self, session_id, message_id
    ) -> Generator[LLMServiceChunk, None, None]:
        """
        根据会话ID和消息ID生成模型回复的流式响应。

        该方法通过获取会话上下文、模型配置以及记忆策略，调用大语言模型服务生成回复内容，
        并以流式方式返回结果。在生成过程中，会记录助手消息并更新会话和消息状态。

        参数:
            session_id (str): 会话的唯一标识符，用于获取会话信息和上下文消息
            message_id (str): 当前用户消息的ID，用于构建上下文和确定回复关系

        返回:
            Generator[LLMService]: 模型回复的流式响应，每个元素是一个包含部分回复内容的 LLMServiceChunk 对象
        """
        from app.services import ModelService, LLMService  # 避免循环导入

        current_message_id = message_id
        model_service = ModelService()
        assistant_message = None
        messages = []
        complete_chunk = LLMServiceChunk()
        generator = None
        try:
            session = SessionRepository.get_session_by_id(session_id)

            if session is None:
                raise ValueError("Invalid session id")

            if "settings" not in session or not isinstance(session["settings"], dict):
                raise ValueError("Session settings missing or invalid")

            SessionRepository.update_session(
                session_id,
                data={
                    "updated_at": datetime.datetime.now(datetime.timezone.utc),
                },
            )
            strategy = self.get_memory_strategy(session)

            messages = strategy.process_memory(session, current_message_id)
            assistant_message = message_service.add_message(
                session_id=session["id"],
                role="assistant",
                content="",
                parent_id=messages[-1]["id"] if messages else None,
                reasoning_content="",
                meta_data={},
            )

            model = model_service.get_model(session["settings"]["model_id"])
            if model is None:
                raise ValueError("Invalid model name")

            # 更优雅的方式获取模型参数
            model_params = {
                "thinking": "thinking" in model.get("features", []),
                "temperature": session["settings"].get("model_temperature"),
                "top_p": session["settings"].get("model_top_p"),
                "frequency_penalty": session["settings"].get("model_frequency_penalty"),
            }

            llm_service = LLMService(
                model["provider"]["api_url"], model["provider"]["api_key"]
            )
            context_messages = self.construct_context_message(session, messages)
            print(f"Using model: {model['model_name']}")
            yield {"message_id": assistant_message["id"]}
            generator = llm_service.generate_response(
                model["model_name"],
                context_messages,
                temperature=model_params["temperature"],
                top_p=model_params["top_p"],
                frequency_penalty=model_params["frequency_penalty"],
                stream=True,
                thinking=model_params["thinking"],
                complete_chunk=complete_chunk,
            )
            for chunk in generator:
                yield chunk.to_dict()
            print("Model response complete")
        except GeneratorExit:
            print("User stopped generation")
            if generator is not None:
                generator.close()
            chunk = LLMServiceChunk()
            chunk.finish_reason = "user_stop"
            complete_chunk.finish_reason = chunk.finish_reason
            yield chunk.to_dict()
            return
        except Exception as e:
            print(f"Error: {e}")
            chunk = LLMServiceChunk()
            chunk.finish_reason = "error"
            chunk.error = str(e)
            # 同步更新完整的消息块
            complete_chunk.finish_reason = chunk.finish_reason
            complete_chunk.error = chunk.error
            yield chunk.to_dict()
            return
        finally:
            if assistant_message is not None:
                message_service.update_message(
                    assistant_message["id"],
                    data={
                        "content": complete_chunk.content,
                        "reasoning_content": complete_chunk.reasoning_content,
                        "meta_data": {
                            "finish_reason": complete_chunk.finish_reason,
                            "error": complete_chunk.error,
                        },
                    },
                )

                # 使用策略处理对话后的记忆
                user_message = messages[-1] if messages else None
                if user_message and strategy:
                    strategy.post_process_memory(
                        session["id"],
                        user_message=user_message,
                        assistant_message=assistant_message,
                    )

    def get_memory_strategy(self, session: dict) -> MemoryStrategy:
        """
        根据角色配置获取记忆策略实例

        Args:
            character: 角色信息

        Returns:
            记忆策略实例
        """
        from app.services.domain.memory_strategy import (
            MemorylessStrategy,
            SlidingWindowStrategy,
            SummaryAugmentedSlidingWindowStrategy,
            SlidingWindowWithRAGStrategy,
        )

        memory_type = session.get("memory_type", "sliding_window")
        if memory_type == "sliding_window":
            return SlidingWindowStrategy()
        elif memory_type == "summary_augmented_sliding_window":
            return SummaryAugmentedSlidingWindowStrategy()
        elif memory_type == "sliding_window_with_rag":
            return SlidingWindowWithRAGStrategy()
        else:
            return MemorylessStrategy()
