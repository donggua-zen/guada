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
import traceback
from typing import Generator, List, Optional, Tuple, Union

from app.repositories.message_repository import MessageRepository
from app.repositories.model_repository import ModelRepository
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

    def _construct_context_message(self, prompts, conversation_messages, merge=False):
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
            prompts, [msg for msg in conversation_messages if msg["role"] == "system"]
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

        context_messages = [{"role": "system", "content": system_prompt}]

        context_messages.extend(
            [
                {"role": msg["role"], "content": msg["content"]}
                for msg in conversation_messages
                if msg["role"] != "system"
            ]
        )
        return context_messages

    def construct_context_message(
        self, session: dict, conversation_messages: list[dict]
    ):
        context_messages = self._construct_context_message(
            {
                "assistant_name": (session["settings"].get("assistant_name")),
                "assistant_identity": (session["settings"].get("assistant_identity")),
                "system_prompt": (session["settings"].get("system_prompt", "")),
            },
            conversation_messages,
        )
        return context_messages

    def _transform_content_structure(self, msg: dict):
        """
        生成消息内容，如果包含文件则添加文件内容作为附件。

        Args:
            msg (dict): 包含 'content' 和可选 'files' 键的消息字典

        Returns:
            str or list: 消息内容字符串或包含文本和文件内容的列表
        """
        files = msg.get("files")

        # 如果没有附加文件，直接返回原始内容
        if not files or msg["role"] != "user":
            return msg

        # 构建包含基础内容和文件内容的列表
        content_parts = [
            {
                "text": msg.get("content", ""),
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

        return {**msg, "content": content_parts}

    def _get_conversation_messages(
        self, session: dict, user_message_id: str, strategy: MemoryStrategy
    ):
        """
        获取对话消息列表，根据记忆策略处理消息

        参数:
            session (dict): 会话信息字典，包含会话ID等信息
            user_message_id (str): 用户消息ID，作为消息获取的结束标识
            strategy (MemoryStrategy): 记忆策略对象，用于控制消息获取和处理逻辑

        返回:
            list: 处理后的消息列表
        """
        while True:
            args = {
                "session_id": session["id"],
                "start_message_id": None,
                "end_message_id": None,
                "include_start": None,
                "include_end": None,
                "offset": None,
                "limit": None,
                "order_type": "asc",
                "with_files": True,
            }
            conditions = strategy.pre_process_memory(session, None)
            if not conditions:  # 满足条件则跳出循环
                break

            args["limit"] = conditions.get("limit", None)
            args["offset"] = conditions.get("offset", None)
            args["with_files"] = conditions.get("with_files", True)
            args["start_message_id"] = conditions.get("after_id", None)
            args["end_message_id"] = user_message_id
            args["include_start"] = conditions.get("include_start", False)
            args["include_end"] = conditions.get("include_end", True)  # 包含用户消息
            args["order_type"] = conditions.get("direction", "asc")

            messages = MessageRepository.get_messages(**args)

            conversation_messages = [
                self._transform_content_structure(msg) for msg in messages
            ]

            strategy.process_memory(session, conversation_messages)
        return strategy.get_messages()

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
            conversation_messages = self._get_conversation_messages(
                session, user_message_id=current_message_id, strategy=strategy
            )
            assistant_message = message_service.add_message(
                session_id=session["id"],
                role="assistant",
                content="",
                parent_id=(
                    conversation_messages[-1]["id"] if conversation_messages else None
                ),
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
            context_messages = self.construct_context_message(
                session, conversation_messages
            )
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
            traceback.print_exc()
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
                user_message = (
                    conversation_messages[-1] if conversation_messages else None
                )
                if user_message and strategy:
                    strategy.post_process_memory(
                        session,
                        [user_message, assistant_message],
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
        )

        memory_type = session["settings"]["memory_type"] or "sliding_window"

        if memory_type == "sliding_window":
            return SlidingWindowStrategy()
        elif memory_type == "summary_augmented_sliding_window":
            return SummaryAugmentedSlidingWindowStrategy()
        # elif memory_type == "sliding_window_with_rag":
        #     return SlidingWindowWithRAGStrategy()
        else:
            return MemorylessStrategy()

    def token_statistics(self, session_id: str) -> dict:
        from app.tokenizer.auto_tokenizer import get_tokenizer

        session = SessionRepository.get_session_by_id(session_id)
        if session is None:
            raise ValueError("Invalid session id")

        strategy = self.get_memory_strategy(session)

        settings = session["settings"]
        model = ModelRepository.get_model(model_id=settings["model_id"])

        conversation_messages = self._get_conversation_messages(
            session, strategy=strategy, user_message_id=None
        )
        tokenizer = get_tokenizer(model["model_name"])

        system_prompt_tokens = 0
        context_tokens = 0
        summary_tokens = 0

        context_messages = self.construct_context_message(
            session, conversation_messages
        )

        for i, message in enumerate(context_messages):
            if message["role"] == "system":
                if i == 0:  # 第一个系统提示语
                    system_prompt_tokens += tokenizer.count_tokens(message["content"])
                else:  # 其他系统提示词一般是摘要和召回记录
                    summary_tokens += tokenizer.count_tokens(message["content"])
            else:
                context_tokens += tokenizer.count_tokens(message["content"])

        max_memory_tokens = system_prompt_tokens + summary_tokens + context_tokens

        max_memory_tokens = (
            settings.get("max_memory_tokens", max_memory_tokens) or max_memory_tokens
        )

        return {
            "max_memory_tokens": max_memory_tokens,
            "system_prompt_tokens": system_prompt_tokens,
            "summary_tokens": summary_tokens,
            "context_tokens": context_tokens,
        }
