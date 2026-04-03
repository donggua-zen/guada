"""
聊天服务模块

该模块提供核心的聊天功能，包括:
1. 构造系统提示和上下文消息
2. 调用大语言模型生成回复
3. 管理不同的记忆策略
4. 模型供应商映射

通过该服务，可以实现角色扮演对话系统的核心功能，支持多种记忆策略和模型供应商的集成。
"""

import asyncio
import datetime
import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional, cast

import ulid
from fastapi import HTTPException
from sqlalchemy import select

from app.database import get_db_manager
from app.models.message import Message
from app.models.message_content import MessageContent
from app.models.session import Session
from app.repositories.message_repository import MessageRepository
from app.repositories.model_repository import ModelRepository
from app.repositories.session_repository import SessionRepository
from app.services.chat.memory_manager_service import MemoryManagerService
from app.services.domain.llm_service import LLMService, LLMServiceChunk
from app.services.settings_manager import SettingsManager
from app.services.tools.tool_orchestrator import (
    ToolOrchestrator,
    ToolExecutionContext,
    ProviderConfig,
)
from app.services.tools.providers.tool_provider_base import (
    ToolCallRequest,
    ToolCallResponse,
)

logger = logging.getLogger(__name__)


class ThinkingTimeInfo:
    """思考时间信息（简单数据容器）

    用于保存消息内容的思考开始和结束时间，避免依赖 MessageContent 的临时属性。
    这样可以确保即使 message_content 是重新查询的，思考时间信息也不会丢失。

    Attributes:
        thinking_started_at: 思考开始时间（UTC）
        thinking_finished_at: 思考结束时间（UTC）
    """

    def __init__(self):
        self.thinking_started_at: Optional[datetime.datetime] = None
        self.thinking_finished_at: Optional[datetime.datetime] = None


class AgentService:
    """代理服务：处理聊天对话的核心业务逻辑"""

    def __init__(
        self,
        session_repo: SessionRepository,
        model_repo: ModelRepository,
        message_repo: MessageRepository,
        memory_manager_service: MemoryManagerService,
        setting_service: SettingsManager,
        tool_orchestrator: ToolOrchestrator,  # 新增：工具编排器
    ):
        """初始化代理服务

        Args:
            session_repo: 会话仓库
            model_repo: 模型仓库
            message_repo: 消息仓库
            memory_manager_service: 记忆管理服务
            setting_service: 设置管理服务
            tool_orchestrator: 工具编排器（负责统一调度所有工具调用）
        """
        self.session_repo = session_repo
        self.model_repo = model_repo
        self.message_repo = message_repo
        self.memory_manager_service = memory_manager_service
        self.setting_service = setting_service
        self.tool_orchestrator = tool_orchestrator  # 保存引用

    def _merge_settings(
        self, session: Session
    ) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
        """统一处理会话和角色设置的合并逻辑

        Args:
            session: 会话对象

        Returns:
            Tuple[session_settings, character_settings, merged_settings]
            - session_settings: 会话设置字典
            - character_settings: 角色设置字典
            - merged_settings: 合并后的设置（会话优先，角色兜底）
        """
        session_settings = session.settings or {}
        character_settings: Dict[str, Any] = {}

        character_settings = session.character.settings or {}

        # 合并策略：会话设置优先，未设置的字段从角色继承
        merged_settings = {**character_settings, **session_settings}

        return session_settings, character_settings, merged_settings

    async def _build_system_prompt(
        self,
        merged_settings: Dict[str, Any],
        context: ToolExecutionContext,
    ) -> str:
        """构建完整的系统提示词（包含工具注入）

        Args:
            merged_settings: 合并后的设置
            session_id: 会话 ID

        Returns:
            str: 完整的系统提示词
        """
        # 1. 基础系统提示词
        system_prompt = merged_settings.get("system_prompt", "")

        # 2. 获取所有工具的提示词注入
        tool_prompts = []

        # 从 ToolOrchestrator 获取所有 Provider 的提示词
        prompts = await self.tool_orchestrator.get_all_tool_prompts(context=context)
        if prompts:
            tool_prompts.append(prompts)

        # 3. 合并提示词
        if tool_prompts:
            system_prompt += "\n\n" + "\n\n".join(tool_prompts)

        logger.debug(f"Built system prompt with {len(tool_prompts)} tool injections")
        return system_prompt

    async def _handle_all_tool_calls(
        self,
        tool_calls: List[Dict[str, Any]],
        context: ToolExecutionContext,  # 新增参数
    ) -> List[Dict[str, Any]]:
        """处理所有工具调用（重构版 - 使用 ToolOrchestrator）

        Args:
            tool_calls: 工具调用列表
            session_id: 当前会话 ID（用于自动注入）

        Returns:
            List[Dict[str, Any]]: 工具执行结果列表

        """

        requests = []
        for tc in tool_calls:
            # 确保 arguments 是字典类型（兼容字符串和字典）
            arguments = tc.get("arguments", {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse arguments JSON: {e}")
                    arguments = {}

            # 创建请求对象
            requests.append(
                ToolCallRequest(
                    id=tc["id"],
                    name=tc["name"],
                    arguments=arguments,
                )
            )

        # 批量执行（自动路由到正确的提供者，使用上下文缓存）
        responses = await self.tool_orchestrator.execute_batch(
            requests, context=context
        )

        # 格式化为 OpenAI 兼容格式
        return [
            {
                "tool_call_id": r.tool_call_id,
                "role": r.role,
                "name": r.name,
                "content": r.content,
            }
            for r in responses
        ]

    async def completions(
        self,
        session_id: str,
        message_id: str,
        regeneration_mode: str = "overwrite",
        assistant_message_id: Optional[str] = None,
    ) -> AsyncGenerator[LLMServiceChunk, None]:
        """根据会话 ID 和消息 ID 生成模型回复的流式响应

        该方法通过获取会话上下文、模型配置以及记忆策略，调用大语言模型服务生成回复内容，
        并以流式方式返回结果。在生成过程中，会记录助手消息并更新会话和消息状态。

        Args:
            session_id: 会话的唯一标识符，用于获取会话信息和上下文消息
            message_id: 当前用户消息的 ID，用于构建上下文和确定回复关系
            regeneration_mode: 再生模式，可选值："overwrite"(覆盖) 或其他
            assistant_message_id: 助手消息 ID，仅在 regeneration_mode 不为"overwrite"时使用

        Yields:
            LLMServiceChunk: 模型回复的流式响应块
        """
        current_message_id = message_id

        # 验证会话存在性
        session = await self._validate_session(session_id)
        # 更新最后活跃时间为当前 UTC 时间
        session.last_active_at = datetime.datetime.now(datetime.timezone.utc)
        # 立即提交事务，确保流式开始时数据已持久化
        await self.session_repo.session.commit()
        chat_turns: List[Dict[str, Any]] = []

        # 修复：创建专用的思考时间信息对象，避免依赖 message_content 的临时属性
        # 注意：只需要保存当前轮次的思考时间信息
        current_turn_thinking_info: Optional[ThinkingTimeInfo] = None

        try:
            # 重构：使用统一的设置合并方法
            _, _, merged_settings = self._merge_settings(session)

            # 获取对话消息
            conversation_messages = (
                await self.memory_manager_service.get_conversation_messages(
                    session_id=session.id,
                    user_message_id=current_message_id,
                    max_messages=merged_settings.get("max_memory_length", 9999) or 9999,
                    skip_tool_calls=merged_settings.get("skip_tool_calls", False),
                )
            )

            # 创建助手消息
            if regeneration_mode == "overwrite":
                # 删除原有的助手消息
                await self.message_repo.delete_message_by_parent_id(
                    parent_id=message_id
                )

                # 创建新的助手消息
                assistant_message = await self.message_repo.add_message_structure(
                    session_id=session.id,
                    role="assistant",
                    parent_id=message_id,
                )
            else:
                # 复用现有的助手消息
                assistant_message = await self.message_repo.get_message(
                    message_id=assistant_message_id
                )

            # 验证模型配置
            model, provider = await self._validate_model_config(session)

            # 获取模型参数
            model_params = self._extract_model_params(session, model, merged_settings)

            # 重构：使用统一的设置合并方法提取工具配置
            _, character_settings, _ = self._merge_settings(session)

            # 从角色设置中提取 MCP 配置和工具配置
            enabled_mcp_servers = (
                character_settings.get("mcp_servers") if character_settings else None
            )
            enabled_tools = (
                character_settings.get("tools") if character_settings else None
            )

            if enabled_tools:
                logger.info(f"Character has {len(enabled_tools)} enabled local tools")

            # 新增：检查当前用户消息是否有知识库引用
            has_kb_reference = (
                "_metadata" in conversation_messages[-1]
                and "referenced_kbs" in conversation_messages[-1]["_metadata"]
            )

            # 构建工具执行上下文（与 execute_batch 使用相同的上下文以复用缓存）
            tool_context = ToolExecutionContext(
                inject_params={"session_id": session.id, "user_id": session.user_id},
                provider_configs={
                    "mcp": ProviderConfig(enabled_tools=enabled_mcp_servers),
                    "local": ProviderConfig(enabled_tools=enabled_tools),
                    "memory": ProviderConfig(enabled_tools=True),
                    # 如果有知识库引用，启用 knowledge_base provider（不限制具体 ID，让 AI 自行选择）
                    "knowledge_base": ProviderConfig(
                        enabled_tools=True if has_kb_reference else False,
                    ),
                },
            )

            # 追加系统提示词
            # 注意：系统提示词必须位于消息列表顶部（最前面）
            system_prompt = await self._build_system_prompt(
                merged_settings, tool_context
            )
            if system_prompt:
                # 新增：替换系统提示词中的变量
                system_prompt = self._replace_system_prompt_variables(system_prompt)
                use_user_prompt = merged_settings.get("use_user_prompt", False)
                system_message = {
                    "role": "user" if use_user_prompt else "system",
                    "content": system_prompt,
                }
                # 修复：插入到列表开头，而不是追加到末尾
            conversation_messages.insert(0, system_message)
            # 使用 ToolOrchestrator 获取统一的工具 schema（自动合并本地和 MCP 工具）
            # 关键：直接返回 OpenAI API 要求的数组格式
            tools = await self.tool_orchestrator.get_all_tools(tool_context)
            logger.info(f"Using {len(tools)} tools (including MCP tools)")

            # 调用 LLM 服务生成回复
            llm_service = LLMService(provider.api_url, provider.api_key)
            logger.debug(f"Using model: {model.model_name}")
            need_to_continue = True
            turns_id = str(ulid.new())

            while need_to_continue:

                # 创建消息内容对象
                messgae_content = MessageContent(
                    turns_id=turns_id,
                    content=None,
                    reasoning_content=None,
                    meta_data={"model_name": model.model_name},
                    additional_kwargs={},
                )
                assistant_message.current_turns_id = turns_id
                assistant_message.contents.append(messgae_content)
                await self.message_repo.session.commit()

                # 修复：为当前轮次创建思考时间信息对象
                current_turn_thinking_info = ThinkingTimeInfo()

                # 发送创建消息事件
                yield {
                    "type": "create",
                    "message_id": assistant_message.id,
                    "turns_id": turns_id,
                    "content_id": messgae_content.id,
                    "model_name": model.model_name,
                }

                # 初始化完整响应块
                complete_chunk: Dict[str, Any] = {
                    "role": "assistant",
                    "reasoning_content": None,
                    "content": None,
                }
                try:
                    # 调用 LLM 服务生成流式响应
                    generator = await llm_service.completions(
                        model=model.model_name,
                        messages=conversation_messages + chat_turns,
                        temperature=model_params["temperature"],
                        top_p=model_params["top_p"],
                        frequency_penalty=model_params["frequency_penalty"],
                        stream=True,
                        tools=tools,  # 直接使用数组，无需转换
                        thinking=model_params["thinking"],
                    )

                    chat_turns.append(complete_chunk)

                    # 处理流式响应块
                    async for chunk in generator:
                        chunk = cast(LLMServiceChunk, chunk)
                        if chunk.usage is not None:
                            complete_chunk["usage"] = {
                                "prompt_tokens": chunk.usage["prompt_tokens"],
                                "completion_tokens": chunk.usage["completion_tokens"],
                                "total_tokens": chunk.usage["total_tokens"],
                            }
                        if chunk.finish_reason is not None:
                            if chunk.finish_reason == "tool_calls":
                                tool_call_response = await self._handle_all_tool_calls(
                                    complete_chunk.get("tool_calls"),
                                    context=tool_context,  # 传递工具执行上下文
                                )
                                chat_turns.extend(tool_call_response)
                                complete_chunk["tool_calls_response"] = [
                                    tool_call for tool_call in tool_call_response
                                ]
                                yield {
                                    "type": "tool_calls_response",
                                    "tool_calls_response": complete_chunk[
                                        "tool_calls_response"
                                    ],
                                    "usage": complete_chunk.get("usage"),
                                }
                                need_to_continue = True

                            else:
                                need_to_continue = False

                            complete_chunk["finish_reason"] = chunk.finish_reason

                            # 兜底：如果直到 finish 都没有记录结束时间（只有思考没有内容），在此记录
                            self._record_thinking_finished(
                                current_turn_thinking_info, "finish_reason (fallback)"
                            )

                            yield {
                                "type": "finish",
                                "finish_reason": chunk.finish_reason,
                                "error": chunk.error,
                                "usage": complete_chunk.get("usage"),
                            }
                            break
                        elif chunk.reasoning_content is not None:
                            # 修复：使用 current_turn_thinking_info 记录思考开始时间
                            if (
                                current_turn_thinking_info
                                and not current_turn_thinking_info.thinking_started_at
                            ):
                                current_turn_thinking_info.thinking_started_at = (
                                    datetime.datetime.now(datetime.timezone.utc)
                                )

                            complete_chunk["reasoning_content"] = (
                                complete_chunk["reasoning_content"] or ""
                            ) + chunk.reasoning_content
                            yield {
                                "type": "think",
                                "msg": chunk.reasoning_content,
                                "usage": complete_chunk.get("usage"),
                            }

                        elif chunk.content is not None:
                            # 优化：使用统一的辅助方法记录思考结束时间
                            self._record_thinking_finished(
                                current_turn_thinking_info, "first content chunk"
                            )

                            complete_chunk["content"] = (
                                complete_chunk["content"] or ""
                            ) + chunk.content
                            yield {
                                "type": "text",
                                "msg": chunk.content,
                                "usage": complete_chunk.get("usage"),
                            }

                        elif "tool_calls" in chunk.additional_kwargs:
                            # 优化：使用统一的辅助方法记录思考结束时间
                            self._record_thinking_finished(
                                current_turn_thinking_info, "first tool_calls chunk"
                            )

                            if complete_chunk.get("tool_calls") is None:
                                complete_chunk["tool_calls"] = []

                            # 累积工具调用信息
                            for tool_call in chunk.additional_kwargs["tool_calls"]:
                                index = tool_call["index"]

                                find = next(
                                    (
                                        x
                                        for x in complete_chunk["tool_calls"]
                                        if x["index"] == index
                                    ),
                                    None,
                                )

                                if find is None:
                                    complete_chunk["tool_calls"].append(
                                        {
                                            "id": tool_call["id"],
                                            "index": tool_call["index"],
                                            "type": tool_call["type"],
                                            "name": tool_call["name"],
                                            "arguments": "",
                                        }
                                    )

                                # 累积参数字符串 (注意：可能是 None，需要判断)
                                if tool_call["arguments"] is not None:
                                    complete_chunk["tool_calls"][index][
                                        "arguments"
                                    ] += tool_call["arguments"]
                            yield {
                                "type": "tool_call",
                                "tool_calls": [
                                    {
                                        "id": tool_call[
                                            "id"
                                        ],  # 全量，除第一次外可能为空
                                        "index": tool_call[
                                            "index"
                                        ],  # 全量，除第一次外可能为空
                                        "type": tool_call[
                                            "type"
                                        ],  # 全量，除第一次外可能为空
                                        "name": tool_call[
                                            "name"
                                        ],  # 全量，除第一次外可能为空
                                        "arguments": tool_call[
                                            "arguments"
                                        ],  # 增量传输，每次只传输新增内容，有可能为空
                                    }
                                    for tool_call in chunk.additional_kwargs[
                                        "tool_calls"
                                    ]
                                ],
                                "usage": complete_chunk.get("usage"),
                            }
                except asyncio.CancelledError:
                    logger.debug("User stopped generation")
                    complete_chunk["finish_reason"] = "user_stop"

                    # 优化：使用统一的辅助方法记录思考结束时间
                    self._record_thinking_finished(
                        current_turn_thinking_info, "user stop"
                    )
                    raise
                except Exception as e:
                    logger.error(f"Error during completion generation: {e}")
                    logger.exception(e)
                    complete_chunk["finish_reason"] = "error"
                    complete_chunk["error"] = str(e)
                    yield {
                        "type": "finish",
                        "finish_reason": "error",
                        "error": str(e),
                        "usage": complete_chunk.get("usage"),
                    }
                    need_to_continue = False
                finally:
                    # 保存生成的资源（消息内容、token 等）
                    if complete_chunk["finish_reason"] == "user_stop":
                        await asyncio.wait_for(
                            asyncio.shield(
                                self._save_generation_resources(
                                    messgae_content,
                                    complete_chunk,
                                    model,
                                    current_turn_thinking_info,  # 传入思考时间信息
                                    safesave=True,
                                )
                            ),
                            timeout=5,
                        )
                    else:
                        await self._save_generation_resources(
                            messgae_content,
                            complete_chunk,
                            model,
                            current_turn_thinking_info,  # 传入思考时间信息
                            safesave=False,
                        )

        finally:
            logger.debug("Session completed")

    # 辅助方法

    async def _validate_session(self, session_id: str) -> Session:
        """验证会话是否存在

        Args:
            session_id: 会话 ID

        Returns:
            Message: 会话对象

        Raises:
            HTTPException: 当会话不存在时抛出 404 错误
        """
        session = await self.session_repo.get_session_by_id(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Invalid session id")
        return session

    def _replace_system_prompt_variables(self, system_prompt: str) -> str:
        """替换系统提示词中的变量

        支持以下变量：
        - {time}: 当前时间（UTC）

        Args:
            system_prompt: 原始系统提示词

        Returns:
            str: 替换后的系统提示词
        """
        # 当前仅支持 {time} 变量，但保留扩展能力
        if "{time}" in system_prompt:
            current_time = datetime.datetime.now(datetime.timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%S UTC"
            )
            system_prompt = system_prompt.replace("{time}", current_time)

        # TODO: 未来可以在此添加更多变量
        # if "{date}" in system_prompt:
        #     system_prompt = system_prompt.replace("{date}", ...)
        # if "{user_name}" in system_prompt:
        #     system_prompt = system_prompt.replace("{user_name}", ...)

        return system_prompt

    def _record_thinking_finished(
        self,
        current_turn_thinking_info: Optional[ThinkingTimeInfo],
        reason: str,
    ) -> None:
        """记录思考结束时间

        Args:
            current_turn_thinking_info: 当前轮次的思考时间信息对象
            reason: 记录原因（用于日志）
        """
        if (
            current_turn_thinking_info
            and current_turn_thinking_info.thinking_started_at
            and not current_turn_thinking_info.thinking_finished_at
        ):
            current_turn_thinking_info.thinking_finished_at = datetime.datetime.now(
                datetime.timezone.utc
            )
            logger.info(f"Thinking finished at {reason}")

    async def _validate_model_config(self, session: Session):
        """验证模型配置

        Args:
            session: 会话对象

        Returns:
            Tuple: (model, provider) 元组

        Raises:
            HTTPException: 当模型配置无效时抛出 404 错误
        """
        model = session.model
        provider = await self.model_repo.get_provider(model.provider_id)
        if model is None:
            raise HTTPException(status_code=404, detail="Invalid model name")
        return model, provider

    def _extract_model_params(
        self,
        session: Message,
        model: Any,
        merged_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """提取模型参数

        优先使用会话的设置，如果会话没有设置则从角色配置继承

        Args:
            session: 会话对象
            model: 模型对象
            merged_settings: 合并后的设置字典（可选，避免重复计算）

        Returns:
            Dict[str, Any]: 模型参数字典
        """

        return {
            "thinking": (
                merged_settings.get("thinking_enabled")
                if model and "thinking" in (model.features or [])
                else None
            ),
            "temperature": merged_settings.get("model_temperature"),
            "top_p": merged_settings.get("model_top_p"),
            "frequency_penalty": merged_settings.get("model_frequency_penalty"),
            "use_user_prompt": merged_settings.get("use_user_prompt", False),
        }

    async def _save_generation_resources(
        self,
        assistant_content: MessageContent,
        complete_chunk: Dict[str, Any],
        model: Any,
        current_turn_thinking_info: Optional[ThinkingTimeInfo] = None,
        safesave: bool = False,
    ):
        """保存生成的资源（消息内容、token 等）

        Args:
            assistant_content: 助手消息内容对象
            complete_chunk: 完整的响应块
            model: 模型对象
            thinking_time_info: 思考时间信息字典（可选）
            safesave: 是否使用安全保存模式
        """

        async def save(message_content: MessageContent):
            """内部保存函数"""
            if message_content is None:
                logger.error("Message content not found")
                return

            # 修复：从 current_turn_thinking_info 计算思考时长
            thinking_duration_ms: Optional[int] = None
            if current_turn_thinking_info:
                if (
                    current_turn_thinking_info.thinking_started_at
                    and current_turn_thinking_info.thinking_finished_at
                ):
                    thinking_duration_ms = int(
                        (
                            current_turn_thinking_info.thinking_finished_at
                            - current_turn_thinking_info.thinking_started_at
                        ).total_seconds()
                        * 1000
                    )
                    logger.info(
                        f"Thinking duration calculated: {thinking_duration_ms}ms"
                    )
                else:
                    logger.warning(
                        f"Thinking timestamps incomplete. "
                        f"Has start: {current_turn_thinking_info.thinking_started_at is not None}, "
                        f"Has finish: {current_turn_thinking_info.thinking_finished_at is not None}"
                    )
            else:
                logger.warning("Thinking time info not found")

            # 设置消息内容的基本属性
            message_content.role = "assistant"
            message_content.reasoning_content = complete_chunk.get("reasoning_content")
            message_content.content = complete_chunk.get("content")

            # 设置额外的 kwargs
            additional_kwargs = [
                "name",
                "tool_calls",
                "tool_call_id",
                "tool_calls_response",
            ]
            message_content.additional_kwargs = {}
            for key in additional_kwargs:
                if key in complete_chunk:
                    message_content.additional_kwargs[key] = complete_chunk[key]
            # 重构：移除冗余的 tool_calls 字段，已保存在 additional_kwargs 中
            # message_content.tool_calls = complete_chunk.get("tool_calls")  # ❌ 已删除
            message_content.finish_reason = complete_chunk.get("finish_reason")

            # 构建 meta_data，添加思考时长和 usage 信息
            message_content.meta_data = {
                "model_name": model.model_name,
                "finish_reason": complete_chunk.get("finish_reason"),
                "error": complete_chunk.get("error"),
            }

            # 如果有思考时长，保存到 meta_data
            if thinking_duration_ms is not None:
                message_content.meta_data["thinking_duration_ms"] = thinking_duration_ms
                logger.info(
                    f"Thinking duration saved to meta_data: {thinking_duration_ms}ms"
                )

            # 如果有 usage 信息，保存到 meta_data
            if complete_chunk.get("usage"):
                message_content.meta_data["usage"] = complete_chunk["usage"]
                logger.info(
                    f"Tokens saved: prompt={complete_chunk['usage']['prompt_tokens']}, "
                    f"completion={complete_chunk['usage']['completion_tokens']}, "
                    f"total={complete_chunk['usage']['total_tokens']}"
                )

            logger.debug("Saving message content")

        # 根据 safesave 参数选择保存策略
        if not safesave:
            # 直接保存并提交会话
            await save(assistant_content)
            await self.session_repo.session.commit()
        else:
            # 使用独立的数据库会话进行安全保存
            db_manager = get_db_manager()
            async with db_manager.async_session_factory() as session:
                try:
                    logger.debug("Starting safe save mode")

                    # 查询消息内容
                    stmt = (
                        select(MessageContent)
                        .filter(MessageContent.id == assistant_content.id)
                        .limit(1)
                    )
                    result = await session.execute(stmt)
                    message_content = result.scalar_one_or_none()

                    if message_content:
                        await save(message_content)
                        await session.commit()
                    else:
                        logger.error(
                            f"Message content {assistant_content.id} not found in safe save mode"
                        )

                except Exception as e:
                    logger.error(f"Database commit failed in safe save mode")
                    logger.exception(e)
                    await session.rollback()
                finally:
                    logger.debug("Database session closed")

        logger.debug("Generation cleanup completed")
