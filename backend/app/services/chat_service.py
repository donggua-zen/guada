"""
聊天服务模块

该模块提供核心的聊天功能，包括:
1. 构造系统提示和上下文消息
2. 调用大语言模型生成回复
3. 管理不同的记忆策略
4. 模型供应商映射

通过该服务，可以实现角色扮演对话系统的核心功能，支持多种记忆策略和模型供应商的集成。
"""

import base64
from contextlib import closing
import datetime
import logging
import os
import traceback
from typing import Generator, Optional

from app.repositories.message_repository import MessageRepository
from app.repositories.model_repository import ModelRepository
from app.repositories.session_repository import SessionRepository
from app.services.domain.memory_strategy import MemoryStrategy
from app.services.llm_service import LLMServiceChunk
from app.services.message_service import MessageService
from app.utils import convert_webpath_to_filepath
from app.utils.settings_manager import SettingsManager

message_service = MessageService()

logger = logging.getLogger(__name__)


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

    def _construct_context_message(
        self, prompts, conversation_messages, use_user_prompt=False
    ):
        """
        根据角色和消息构造上下文消息列表。

        Args:
            prompts: 提示词相关对象或信息。
            messages (list): 消息列表，其中每个消息是一个字典，包含 "role" 和 "content" 两个键。

        Returns:
            list: 构造后的上下文消息列表，每个消息是一个字典，包含 "role" 和 "content" 两个键。
        """
        system_prompt = self._construct_system_prompt(
            prompts, [msg for msg in conversation_messages if msg["role"] == "system"]
        )

        logger.debug(
            f"--------------------({len(conversation_messages)} messages)-----------------------------"
        )
        if len(conversation_messages) > 0:
            for msg in conversation_messages[:3]:
                logger.debug(f"{msg['role']}: {msg['content']}")
            logger.debug(f".......")
        if len(conversation_messages) > 3:
            for msg in conversation_messages[-1:]:
                logger.debug(f"{msg['role']}: {msg['content']}")
        logger.debug("------------------------------------------------------------")

        context_messages = [
            {
                "role": "system" if not use_user_prompt else "user",
                "content": system_prompt,
            }
        ]

        context_messages.extend(
            [
                {"role": msg["role"], "content": msg["content"]}
                for msg in conversation_messages
                if msg["role"] != "system"
            ]
        )
        return context_messages

    def construct_context_message(
        self, session: dict, conversation_messages: list[dict], use_user_prompt=False
    ):
        context_messages = self._construct_context_message(
            {
                "assistant_name": (session["settings"].get("assistant_name")),
                "assistant_identity": (session["settings"].get("assistant_identity")),
                "system_prompt": (session["settings"].get("system_prompt", "")),
            },
            conversation_messages,
            use_user_prompt=use_user_prompt,
        )
        return context_messages

    def _transform_content_structure(self, msg: dict):
        """
        生成消息内容，如果包含文件则添加文件内容作为附件。

        Args:
            msg (dict): 包含 'contents' 和可选 'files' 键的消息字典

        Returns:
            str or list: 消息内容字符串或包含文本和文件内容的列表
        """

        msg["content"] = [
            content["content"] for content in msg["contents"] if content["is_current"]
        ][0] or ""

        # msg.pop("contents")
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
            if file.get("file_type") == "image":
                file_url = file.get("url", "")
                image_body = {}
                if file_url.startswith("/"):
                    file_path = convert_webpath_to_filepath(file_url)
                    try:
                        if os.path.exists(file_path):
                            with open(file_path, "rb") as image_file:
                                # 读取图片文件并编码为base64
                                base64_data = base64.b64encode(
                                    image_file.read()
                                ).decode("utf-8")

                                # 根据文件扩展名确定MIME类型
                                file_extension = file.get("file_extension")
                                mime_type = "image/jpeg"  # 默认值
                                if file_extension == "png":
                                    mime_type = "image/png"
                                elif file_extension == "gif":
                                    mime_type = "image/gif"
                                elif file_extension == "bmp":
                                    mime_type = "image/bmp"
                                elif file_extension == "webp":
                                    mime_type = "image/webp"

                                # 构造data URI格式
                                image_body["url"] = (
                                    f"data:{mime_type};base64,{base64_data}"
                                )
                            logger.debug(f"成功将图片 {file_path} 转换为base64格式")
                        else:
                            logger.warning(f"图片文件不存在: {file_path}")
                            image_body["url"] = ""  # 文件不存在时设置为空
                    except Exception as e:
                        logger.error(f"图片文件读取失败: {file_path}, 错误: {str(e)}")
                        image_body["url"] = ""  # 读取失败时设置为空
                else:
                    image_body["url"] = file_url
                content_parts.append(
                    {
                        "type": "image_url",
                        "image_url": image_body,
                    }
                )
            elif file.get("file_type") == "text":
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
                "with_contents": True,
                "only_current_content": True,
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

    def _add_assistant_message(
        self,
        session: dict,
        regeneration_mode: str = "overwrite",
        assistant_message_id: Optional[str] = None,
        conversation_messages: Optional[list[dict]] = None,
    ) -> dict:

        if regeneration_mode == "multi_version":
            if not assistant_message_id:
                raise ValueError("assistant_message_id is required")
            return message_service.add_message_content(
                message_id=assistant_message_id,
                content="",
                reasoning_content="",
                meta_data={},
            )
        else:
            if regeneration_mode == "overwrite":
                try:
                    message_service.delete_message(message_id=assistant_message_id)
                except:
                    pass
            return message_service.add_message(
                session_id=session["id"],
                role="assistant",
                content="",
                parent_id=(
                    conversation_messages[-1]["id"] if conversation_messages else None
                ),
                meta_data={},
            )

    def _web_search(self, model: dict, messages: list[dict], current_date: str = None):
        from app.services.domain.web_search import WebSearch
        from app.services import LLMService  # 避免循环导入

        serper_api_key = SettingsManager.get("search_api_key", "")
        search_prompt_context_length = SettingsManager.get(
            "search_prompt_context_length", 10
        )
        default_search_model_id = SettingsManager.get("default_search_model_id", "")

        if default_search_model_id != "" and default_search_model_id != "current":
            search_model = ModelRepository.get_model(model_id=default_search_model_id)
            if search_model:  # 搜索功能需要模型
                model = search_model

        if not serper_api_key:  # 搜索功能需要API Key
            raise ValueError("serper_api_key is required")

        conversation_messages = [
            f'<role="{msg["role"]}">{msg["content"]}<role="{msg["role"]}">'
            for msg in messages[-search_prompt_context_length:]
        ]
        prompt = "请根据聊天记录，为最新的用户提问，生成一个简洁明了的搜索词，用于后续的网页搜索。直接输出，不要进行任何额外描述。\n"
        prompt += "对话记录：\n" + "\n".join(conversation_messages)
        if current_date:  # 搜索功能需要当前日期
            prompt += f"\n当前日期：{current_date}"

        llm_service = LLMService(
            model["provider"]["api_url"], model["provider"]["api_key"]
        )
        chunk = llm_service.completions(
            model["model_name"],
            [{"role": "user", "content": prompt}],
            temperature=None,
            top_p=None,
            frequency_penalty=None,
            stream=False,
            thinking=False,
            complete_chunk=None,
        )

        logger.debug("搜索词：%s", chunk.content)
        web_search = WebSearch(serper_api_key=serper_api_key)
        results = web_search.search(chunk.content)
        return "\n".join(
            [
                f"position:{result['position']}\ntitle:{result['title']}\n,snippet:{result['snippet']}\n"
                for result in results
            ]
        )

    def completions(
        self,
        session_id: str,
        message_id: str,
        regeneration_mode: str = "overwrite",
        assistant_message_id: str = None,
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
        from app.services import LLMService  # 避免循环导入

        current_message_id = message_id
        assistant_message = None
        complete_chunk = LLMServiceChunk()
        model = None
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

            assistant_message = self._add_assistant_message(
                session,
                regeneration_mode=regeneration_mode,
                assistant_message_id=assistant_message_id,
                conversation_messages=conversation_messages,
            )

            assistant_message_current_content = next(
                (
                    content
                    for content in assistant_message["contents"]
                    if content["is_current"]
                ),
                {},
            )

            if not assistant_message_current_content:
                raise ValueError("Assistant message content missing")

            model = session["model"]
            if model is None:
                raise ValueError("Invalid model name")

            # 更优雅的方式获取模型参数
            model_params = {
                "thinking": "thinking" in model.get("features", []),
                "temperature": session["settings"].get("model_temperature"),
                "top_p": session["settings"].get("model_top_p"),
                "frequency_penalty": session["settings"].get("model_frequency_penalty"),
                "use_user_prompt": session["settings"].get("use_user_prompt", False),
            }

            llm_service = LLMService(
                model["provider"]["api_url"], model["provider"]["api_key"]
            )
            context_messages = self.construct_context_message(
                session,
                conversation_messages,
                use_user_prompt=model_params["use_user_prompt"],
            )
            logger.debug(f"Using model: {model['model_name']}")
            yield {
                "type": "create",
                "message_id": assistant_message["id"],
                "content_id": assistant_message_current_content["id"],
                "model_name": model["model_name"],
            }

            if session["settings"].get("web_search_enabled", False):
                current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                yield {"type": "web_search", "msg": "start"}
                web_results = self._web_search(
                    model=model, messages=context_messages, current_date=current_time
                )
                yield {"type": "web_search", "msg": "stop"}

                prompt = f"请根据搜索结果回答用户问题\n# 搜索结果：\n{web_results} # 当前时间:{current_time} \n# 用户问题：\n"
                logger.debug("拼接后的用户问题: %s", prompt)
                context_messages[-1]["content"] = (
                    prompt + context_messages[-1]["content"]
                )
            with closing(
                llm_service.completions(
                    model["model_name"],
                    context_messages,
                    temperature=model_params["temperature"],
                    top_p=model_params["top_p"],
                    frequency_penalty=model_params["frequency_penalty"],
                    stream=True,
                    thinking=model_params["thinking"]
                    and session["settings"].get("thinking_enabled", False),
                    complete_chunk=complete_chunk,
                )
            ) as generator:
                for chunk in generator:
                    if chunk.finish_reason is not None:
                        yield {
                            "type": "finish",
                            "finish_reason": chunk.finish_reason,
                            "error": chunk.error,
                        }
                    elif chunk.reasoning_content is not None:
                        yield {
                            "type": "think",
                            "msg": chunk.reasoning_content,
                        }

                    elif chunk.content is not None:
                        yield {
                            "type": "text",
                            "msg": chunk.content,
                        }
            logger.debug("Model response complete")
        except GeneratorExit:
            logger.debug("User stopped generation")
            complete_chunk.finish_reason = "user_stop"
            return
        except Exception as e:
            logger.exception(f"Error: {e}")
            chunk = LLMServiceChunk()
            chunk.finish_reason = "error"
            chunk.error = str(e)
            # 同步更新完整的消息块
            complete_chunk.finish_reason = chunk.finish_reason
            complete_chunk.error = chunk.error
            yield {
                "type": "finish",
                "finish_reason": chunk.finish_reason,
                "error": chunk.error,
            }
            return
        finally:
            logger.debug("Generation complete")
            if assistant_message is not None:
                message_service.update_message(
                    assistant_message["id"],
                    data={
                        "content": complete_chunk.content,
                        "reasoning_content": complete_chunk.reasoning_content,
                        "meta_data": {
                            "model_name": model["model_name"] or "",
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
        model = session["model"]

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

    def web_search(self, message_id: str):
        from app.services.domain.web_search import WebSearch
        from app.services import LLMService  # 避免循环导入

        message = MessageRepository.get_message(message_id)

        messages = MessageRepository.get_messages(
            session_id=message["session_id"],
            end_message_id=message_id,
            include_end=False,
            limit=10,
            with_files=False,
            with_contents=True,
            only_current_content=True,
        )
        messages.append(message)
        if messages is None:  # 获取不到消息，则返回空
            raise ValueError("Invalid message id")

        session = SessionRepository.get_session_by_id(messages[-1]["session_id"])

        conversation_messages = [
            f'<role="{msg["role"]}">{msg["contents"][0]["content"]}<role="{msg["role"]}">'
            for msg in messages
        ]
        prompt = "请根据聊天记录，为最新的用户提问，生成一个简洁明了的搜索词，用于后续的网页搜索。直接输出，不要进行任何额外描述。\n"
        prompt += "对话记录：\n" + "\n".join(conversation_messages)
        model = session["model"]
        if model is None:
            raise ValueError("Invalid model name")

        # 更优雅的方式获取模型参数
        model_params = {
            "thinking": "thinking" in model.get("features", []),
            "temperature": session["settings"].get("model_temperature"),
            "top_p": session["settings"].get("model_top_p"),
            "frequency_penalty": session["settings"].get("model_frequency_penalty"),
            "use_user_prompt": session["settings"].get("use_user_prompt", False),
        }
        llm_service = LLMService(
            model["provider"]["api_url"], model["provider"]["api_key"]
        )
        chunk = llm_service.completions(
            model["model_name"],
            [{"role": "user", "content": prompt}],
            temperature=model_params["temperature"],
            top_p=model_params["top_p"],
            frequency_penalty=model_params["frequency_penalty"],
            stream=False,
            thinking=False,
            complete_chunk=None,
        )

        logger.debug("搜索词：%s", chunk.content)
        web_search = WebSearch()
        results = web_search.search(chunk.content)
        return {"results": results}
