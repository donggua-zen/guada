"""
聊天服务模块

该模块提供核心的聊天功能，包括:
1. 构造系统提示和上下文消息
2. 调用大语言模型生成回复
3. 管理不同的记忆策略
4. 模型供应商映射

通过该服务，可以实现角色扮演对话系统的核心功能，支持多种记忆策略和模型供应商的集成。
"""

from contextlib import closing
import datetime
import logging
from typing import Generator, Optional

from app.exceptions import APIException
from app.models.model import Model
from app.repositories.model_repository import ModelRepository
from app.repositories.session_repository import SessionRepository
from app.services.chat.memory_manager_service import MemoryManagerService
from app.services.domain.llm_service import LLMService, LLMServiceChunk
from app.services.domain.web_search_engine import WebSearchEngine
from app.services.message_service import MessageService
from app.utils.settings_manager import SettingsManager

message_service = MessageService()

logger = logging.getLogger(__name__)


class ChatService:
    def __init__(self):
        pass

    def _add_assistant_message(
        self,
        session_id: str,
        regeneration_mode: str = "overwrite",
        assistant_message_id: Optional[str] = None,
        parent_id: Optional[str] = None,
    ):

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
                session_id=session_id,
                role="assistant",
                content="",
                parent_id=parent_id,
                meta_data={},
            )

    def _web_search(self, model: Model, messages: list[dict]):
        """
        执行网络搜索操作，基于对话历史生成搜索查询并获取相关结果

        该函数会分析最近的对话历史，使用LLM生成合适的搜索关键词，然后执行网络搜索，
        并将搜索结果格式化后附加到最新的用户消息中，供后续处理使用。

        Args:
            model (Model): 用于生成搜索关键词的语言模型对象
            messages (list[dict]): 包含对话历史的消息列表，每个消息包含role和content字段

        Returns:
            list: 更新后的对话消息列表，其中最新消息已附加搜索结果提示

        Raises:
            ValueError: 当未配置搜索API密钥时抛出异常
        """

        api_key = SettingsManager.get("search_api_key", "")
        search_prompt_context_length = SettingsManager.get(
            "search_prompt_context_length", 10
        )
        default_search_model_id = SettingsManager.get("default_search_model_id", "")

        # 如果配置了专用的搜索模型且不是当前模型，则切换到该模型
        if default_search_model_id != "" and default_search_model_id != "current":
            search_model = ModelRepository.get_model(model_id=default_search_model_id)
            if search_model:  # 搜索功能需要模型
                model = search_model

        if not api_key:  # 搜索功能需要API Key
            raise ValueError("api_key is required")

        # 提取指定数量的最近对话记录用于构建搜索上下文
        conversation_messages = [
            f'<role="{msg["role"]}">{msg["content"]}<role="{msg["role"]}">'
            for msg in messages[-search_prompt_context_length:]
        ]
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 构建生成搜索关键词的提示词
        prompt = "请根据聊天记录，为最新的用户提问，生成一个简洁明了的搜索词，用于后续的网页搜索。直接输出，不要进行任何额外描述。\n"
        prompt += "对话记录：\n" + "\n".join(conversation_messages)
        prompt += f"\n当前日期：{current_time}"

        # 使用LLM生成搜索关键词
        llm_service = LLMService(model.provider.api_url, model.provider.api_key)
        chunk = llm_service.completions(
            model.model_name,
            [{"role": "user", "content": prompt}],
            temperature=None,
            top_p=None,
            frequency_penalty=None,
            stream=False,
            thinking=False,
            complete_chunk=None,
        )

        logger.debug("搜索词：%s", chunk.content)

        # 执行网络搜索并获取结果
        web_search = WebSearchEngine(api_key=api_key)
        results = web_search.search(chunk.content)

        # 格式化搜索结果
        web_results = "\n".join(
            [
                f"position:{result['position']}\nsite:{result['site']}\nname:{result['name']}\nsummary:{result['summary']}\n"
                for result in results
            ]
        )

        # 将搜索结果附加到最新的用户消息中
        prompt = f"请根据搜索结果回答用户问题\n# 搜索结果：\n{web_results} # 当前时间:{current_time} \n# 用户问题：\n"
        conversation_messages[-1]["content"] = (
            prompt + conversation_messages[-1]["content"]
        )

        return conversation_messages

    def chunk_to_response(self, chunk: LLMServiceChunk) -> dict:
        """
        将LLM服务返回的数据块转换为响应格式

        根据数据块中的不同字段（完成原因、推理内容或普通内容）将其转换为不同类型的消息:
        - finish: 表示生成完成，包含完成原因和可能的错误信息
        - think: 表示模型正在思考，包含推理过程的内容
        - text: 表示普通的文本内容

        Args:
            chunk (LLMServiceChunk): 包含大语言模型生成内容的数据块

        Returns:
            dict: 格式化后的响应字典，包含类型和相应的消息内容
        """
        if chunk.finish_reason is not None:
            return {
                "type": "finish",
                "finish_reason": chunk.finish_reason,
                "error": chunk.error,
            }
        elif chunk.reasoning_content is not None:
            return {
                "type": "think",
                "msg": chunk.reasoning_content,
            }

        elif chunk.content is not None:
            return {
                "type": "text",
                "msg": chunk.content,
            }

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
        current_message_id = message_id

        session = SessionRepository.get_session_by_id(session_id)

        if session is None:
            raise ValueError("Invalid session id")

        SessionRepository.update_session(
            session_id,
            data={
                "updated_at": datetime.datetime.now(datetime.timezone.utc),
            },
        )
        memory_manager = MemoryManagerService()
        conversation_messages = memory_manager.get_conversation_messages(
            session_id=session_id,
            model_name=session.model.model_name,
            user_message_id=current_message_id,
            max_messages=session.settings.get("max_memory_length", 9999) or 9999,
            max_tokens=session.settings.get("max_memory_tokens", 32 * 1024)
            or 32 * 1024,
            prompt_settings={
                "assistant_name": (session.settings.get("assistant_name")),
                "assistant_identity": (session.settings.get("assistant_identity")),
                "system_prompt": (session.settings.get("system_prompt", "")),
            },
        )

        assistant_message = self._add_assistant_message(
            session.id,
            regeneration_mode=regeneration_mode,
            assistant_message_id=assistant_message_id,
            parent_id=conversation_messages[-1]["id"],
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

        model = session.model
        if model is None:
            raise ValueError("Invalid model name")

        # 更优雅的方式获取模型参数
        model_params = {
            "thinking": (
                session.settings.get("thinking_enabled")
                if "thinking" in model.features
                else None
            ),
            "temperature": session.settings.get("model_temperature"),
            "top_p": session.settings.get("model_top_p"),
            "frequency_penalty": session.settings.get("model_frequency_penalty"),
            "use_user_prompt": session.settings.get("use_user_prompt", False),
        }

        yield {
            "type": "create",
            "message_id": assistant_message["id"],
            "content_id": assistant_message_current_content["id"],
            "model_name": model.model_name,
        }
        try:
            if session.settings.get("web_search_enabled", False):

                yield {"type": "web_search", "msg": "start"}
                conversation_messages = self._web_search(
                    model=model,
                    messages=conversation_messages,
                )
                yield {"type": "web_search", "msg": "stop"}

            complete_chunk = LLMServiceChunk()

            llm_service = LLMService(model.provider.api_url, model.provider.api_key)
            logger.debug(f"Using model: {model.model_name}")

            with closing(
                llm_service.completions(
                    model.model_name,
                    messages=conversation_messages,
                    temperature=model_params["temperature"],
                    top_p=model_params["top_p"],
                    frequency_penalty=model_params["frequency_penalty"],
                    stream=True,
                    thinking=model_params["thinking"],
                    complete_chunk=complete_chunk,
                )
            ) as generator:
                for chunk in generator:
                    yield self.chunk_to_response(chunk)
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
            yield self.chunk_to_response(chunk)
        finally:
            logger.debug("Generation complete")
            if assistant_message is not None:
                message_service.update_message(
                    assistant_message["id"],
                    data={
                        "content": complete_chunk.content,
                        "reasoning_content": complete_chunk.reasoning_content,
                        "meta_data": {
                            "model_name": model.model_name,
                            "finish_reason": complete_chunk.finish_reason,
                            "error": complete_chunk.error,
                        },
                    },
                )

                # 使用策略处理对话后的记忆
                # user_message = (
                #     conversation_messages[-1] if conversation_messages else None
                # )
                # if user_message and strategy:
                #     strategy.post_process_memory(
                #         session.to_dict(),
                #         [user_message, assistant_message],
                #     )

    def token_statistics(self, session_id: str) -> dict:
        from app.tokenizer.auto_tokenizer import get_tokenizer

        session = SessionRepository.get_session_by_id(session_id)
        if session is None:
            raise APIException("Session not found", status_code=404)

        settings = session.settings
        model = session.model

        memory_manager = MemoryManagerService()
        conversation_messages = memory_manager.get_conversation_messages(
            session_id=session_id,
            model_name=session.model.model_name,
            user_message_id=None,
            max_messages=session.settings.get("max_memory_length", 9999) or 9999,
            max_tokens=session.settings.get("max_memory_tokens", 32 * 1024)
            or 32 * 1024,
            prompt_settings={
                "assistant_name": (session.settings.get("assistant_name")),
                "assistant_identity": (session.settings.get("assistant_identity")),
                "system_prompt": (session.settings.get("system_prompt", "")),
            },
        )

        system_prompt_tokens = 0
        context_tokens = 0
        summary_tokens = 0

        for i, message in enumerate(conversation_messages):
            if message["role"] == "system":
                if i == 0:  # 第一个系统提示语
                    system_prompt_tokens += message["tokens"]
                else:  # 其他系统提示词一般是摘要和召回记录
                    summary_tokens += message["tokens"]
            else:
                context_tokens += message["tokens"]

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
