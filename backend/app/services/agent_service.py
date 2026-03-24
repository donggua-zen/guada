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
import logging
import ulid
import json
from typing import AsyncGenerator, Optional, cast, List, Dict, Any

from fastapi import HTTPException
from sqlalchemy import select
from app.database import get_db_manager
from app.models.message import Message
from app.models.message_content import MessageContent
from app.repositories.message_repository import MessageRepository
from app.repositories.model_repository import ModelRepository
from app.repositories.session_repository import SessionRepository
from app.services.chat.memory_manager_service import MemoryManagerService
from app.services.domain.function_calling.utils import (
    get_tools_schema,
    handle_tool_calls,
)
from app.services.domain.llm_service import LLMService, LLMServiceChunk
from app.services.mcp.tool_manager import MCPToolManager
from app.services.settings_manager import SettingsManager

logger = logging.getLogger(__name__)


class AgentService:
    def __init__(
        self,
        session_repo: SessionRepository,
        model_repo: ModelRepository,
        message_repo: MessageRepository,
        memory_manager_service: MemoryManagerService,
        setting_service: SettingsManager,
        mcp_tool_manager: MCPToolManager,
    ):
        self.session_repo = session_repo
        self.model_repo = model_repo
        self.message_repo = message_repo
        self.memory_manager_service = memory_manager_service
        self.setting_service = setting_service
        self.mcp_tool_manager = mcp_tool_manager

    async def _get_mcp_tools_schema(
        self, 
        character_settings: Optional[Dict[str, Any]] = None
    ) -> list:
        """
        获取 MCP 工具的 schema

        Args:
            character_settings: 角色的 settings 字典 (包含 mcp_servers 字段)

        Returns:
            list: MCP 工具 schema 列表
        """
        try:
            # 提取角色已启用的 MCP 服务器 ID 列表
            enabled_mcp_servers = None
            if character_settings:
                enabled_mcp_servers = character_settings.get('mcp_servers')
                logger.info(f"Character has {len(enabled_mcp_servers or [])} enabled MCP servers")
            
            # 使用注入的 MCPToolManager
            all_mcp_tools = await self.mcp_tool_manager.get_all_mcp_tools(
                enabled_mcp_servers=enabled_mcp_servers
            )

            # 转换为 OpenAI function calling 格式
            mcp_tools_schema = []
            for tool_name, tool_data in all_mcp_tools.items():
                if isinstance(tool_data, dict):
                    schema = {
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "description": tool_data.get(
                                "description", f"MCP tool: {tool_name}"
                            ),
                            "parameters": tool_data.get("inputSchema", {})
                            or tool_data.get("parameters", {}),
                        },
                    }
                    mcp_tools_schema.append(schema)

            return mcp_tools_schema
        except Exception as e:
            logger.error(f"Error loading MCP tools: {e}")
            return []

    async def _execute_mcp_tool(
        self, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        执行 MCP 工具调用

        Args:
            tool_name: 工具名称（包含 mcp__前缀）
            arguments: 工具参数

        Returns:
            Dict: 工具调用结果
        """
        try:
            # 使用注入的 MCPToolManager
            result = await self.mcp_tool_manager.execute_tool(tool_name, arguments)

            return {
                "tool_call_id": None,  # 会在上层设置
                "role": "tool",
                "name": tool_name,
                "content": (
                    str(result["content"])
                    if not isinstance(result["content"], str)
                    else result["content"]
                ),
            }
        except Exception as e:
            logger.error(f"Error executing MCP tool {tool_name}: {e}")
            logger.exception(e)
            return {
                "tool_call_id": None,
                "role": "tool",
                "name": tool_name,
                "content": f"Error: {str(e)}",
            }

    async def _handle_all_tool_calls(
        self,
        tool_calls: List[dict],
    ) -> List[Dict[str, Any]]:
        """
        处理所有工具调用（包括本地工具和 MCP 工具）

        Args:
            tool_calls: 工具调用列表

        Returns:
            List[Dict]: 工具执行结果列表
        """
        tool_results = []

        for tool_call in tool_calls:
            func_name = tool_call["name"]

            # 解析参数
            try:
                import json

                arguments = json.loads(tool_call["arguments"])

                # 判断是否为 MCP 工具
                if func_name.startswith("mcp__"):
                    # MCP 工具调用
                    logger.info(f"Calling MCP tool: {func_name}")
                    result = await self._execute_mcp_tool(func_name, arguments)
                    result["tool_call_id"] = tool_call["id"]
                    tool_results.append(result)
                else:
                    # 本地工具调用
                    local_result = await handle_tool_calls([tool_call])
                    tool_results.extend(local_result)

            except Exception as e:
                logger.error(f"Error handling tool call {func_name}: {e}")
                tool_results.append(
                    {
                        "tool_call_id": tool_call["id"],
                        "role": "tool",
                        "name": func_name,
                        "content": f"Error: {str(e)}",
                    }
                )

        return tool_results

    async def completions(
        self,
        session_id: str,
        message_id: str,
        regeneration_mode: str = "overwrite",
        assistant_message_id: str = None,
    ) -> AsyncGenerator[LLMServiceChunk, None]:
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

        # 验证会话存在性
        session = await self._validate_session(session_id)
        session.updated_at = datetime.datetime.now(datetime.timezone.utc)
        # complete_chunk = LLMServiceChunk()
        chat_turns = []

        try:
            # 获取对话消息
            conversation_messages = await self._get_conversation_messages(
                session, current_message_id
            )

            # 创建助手消息
            # assistant_message = await self._add_assistant_message(
            #     session.id,
            #     regeneration_mode=regeneration_mode,
            #     assistant_message_id=assistant_message_id,
            #     parent_id=message_id,
            # )

            if regeneration_mode == "overwrite":
                await self.message_repo.delete_message_by_parent_id(
                    parent_id=message_id
                )

                assistant_message = await self.message_repo.add_message_structure(
                    session_id=session.id,
                    role="assistant",
                    parent_id=message_id,
                )
            else:
                assistant_message = await self.message_repo.get_message(
                    message_id=assistant_message_id
                )

            # assistant_message_current_content = self._get_current_content(
            #     assistant_message
            # )

            # 验证模型配置
            model, provider = await self._validate_model_config(session)

            # 获取模型参数
            model_params = self._extract_model_params(session, model)

            # 获取 MCP 工具列表并合并到本地工具
            all_tools_schema = get_tools_schema()  # 本地工具
            
            # 从角色设置中提取 MCP 配置
            character_settings = {}
            if hasattr(session, 'character') and session.character:
                character_settings = session.character.settings or {}
            
            mcp_tools_schema = await self._get_mcp_tools_schema(
                character_settings=character_settings
            )  # MCP 工具
            all_tools_schema.extend(mcp_tools_schema)  # 合并工具列表

            logger.info(
                f"Using {len(all_tools_schema)} tools (including {len(mcp_tools_schema)} MCP tools)"
            )
            # 提交会话更新
            # await self.session_repo.session.commit()
            # await self.session_repo.session.begin()
            # # 处理网络搜索（如果启用）
            # if model_params.get("web_search_enabled", False):
            #     yield {"type": "web_search", "msg": "start"}
            #     conversation_messages = await self._perform_web_search(
            #         model, conversation_messages
            #     )
            #     yield {"type": "web_search", "msg": "stop"}
            # 发送创建消息事件
            # yield {
            #     "type": "create",
            #     "message_id": assistant_message.id,
            #     "model_name": model.model_name,
            # }
            # 调用LLM服务
            """生成模型响应"""
            llm_service = LLMService(provider.api_url, provider.api_key)
            logger.debug(f"Using model: {model.model_name}")
            need_to_continue = True
            turns_id = str(ulid.new())
            while need_to_continue:

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
                # 发送创建消息事件
                yield {
                    "type": "create",
                    "message_id": assistant_message.id,
                    "turns_id": turns_id,
                    "content_id": messgae_content.id,
                    "model_name": model.model_name,
                }
                complete_chunk = {
                    "role": "assistant",
                    "reasoning_content": None,
                    "content": None,
                }
                try:
                    generator = llm_service.completions(
                        model.model_name,
                        messages=conversation_messages + chat_turns,
                        temperature=model_params["temperature"],
                        top_p=model_params["top_p"],
                        frequency_penalty=model_params["frequency_penalty"],
                        stream=True,
                        tools=all_tools_schema,  # 使用合并后的工具列表
                        thinking=model_params["thinking"],
                    )

                    chat_turns.append(complete_chunk)
                    # @chunk LLMServiceChunk
                    async for chunk in generator:
                        chunk = cast(LLMServiceChunk, chunk)
                        if chunk.finish_reason is not None:
                            if chunk.finish_reason == "tool_calls":
                                # 检查是否禁用了工具调用结果携带功能
                                disabled_tool_results = merged_settings.get("disabled_tool_results", False)
                                
                                if not disabled_tool_results:
                                    # 未禁用工具调用结果，处理工具调用（包括本地工具和 MCP 工具）
                                    tool_call_response = await self._handle_all_tool_calls(
                                        complete_chunk.get("tool_calls")
                                    )
                                    chat_turns.extend(tool_call_response)
                                    complete_chunk["tool_calls_response"] = [
                                        tool_call for tool_call in tool_call_response
                                    ]
                                    yield {
                                        "type": "tool_calls",
                                        "tool_calls": complete_chunk["tool_calls"],
                                        "tool_calls_response": complete_chunk[
                                            "tool_calls_response"
                                        ],
                                    }
                                    need_to_continue = True
                                else:
                                    # 已禁用工具调用结果，直接结束
                                    logger.info("Tool results disabled, skipping tool execution")
                                    need_to_continue = False
                            else:
                                need_to_continue = False

                            complete_chunk["finish_reason"] = chunk.finish_reason
                            
                            # 兜底：如果直到 finish 都没有记录结束时间（只有思考没有内容），在此记录
                            if hasattr(messgae_content, '_thinking_started_at') and \
                               not hasattr(messgae_content, '_thinking_finished_at'):
                                messgae_content._thinking_finished_at = datetime.datetime.now(datetime.timezone.utc)
                                logger.info(f"Thinking finished at finish_reason (fallback)")
                            
                            yield {
                                "type": "finish",
                                "finish_reason": chunk.finish_reason,
                                "error": chunk.error,
                            }
                            break
                        elif chunk.reasoning_content is not None:
                            # 首次检测到 reasoning_content，记录思考开始时间
                            if not hasattr(messgae_content, '_thinking_started_at'):
                                messgae_content._thinking_started_at = datetime.datetime.now(datetime.timezone.utc)
                            
                            complete_chunk["reasoning_content"] = (
                                complete_chunk["reasoning_content"] or ""
                            ) + chunk.reasoning_content
                            yield {
                                "type": "think",
                                "msg": chunk.reasoning_content,
                            }

                        elif chunk.content is not None:
                            # 首次遇到普通内容，记录思考结束时间（如果有思考过程）
                            if hasattr(messgae_content, '_thinking_started_at') and \
                               not hasattr(messgae_content, '_thinking_finished_at'):
                                messgae_content._thinking_finished_at = datetime.datetime.now(datetime.timezone.utc)
                                logger.info(f"Thinking finished at first content chunk")
                            
                            complete_chunk["content"] = (
                                complete_chunk["content"] or ""
                            ) + chunk.content
                            yield {
                                "type": "text",
                                "msg": chunk.content,
                            }
                        elif "tool_calls" in chunk.additional_kwargs:
                            # 首次遇到工具调用，记录思考结束时间（如果有思考过程）
                            if hasattr(messgae_content, '_thinking_started_at') and \
                               not hasattr(messgae_content, '_thinking_finished_at'):
                                messgae_content._thinking_finished_at = datetime.datetime.now(datetime.timezone.utc)
                                logger.info(f"Thinking finished at first tool_calls chunk")
                            
                            if complete_chunk.get("tool_calls") is None:
                                complete_chunk["tool_calls"] = []
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
                except asyncio.CancelledError:
                    logger.debug("User stopped generation")
                    complete_chunk["finish_reason"] = "user_stop"
                    raise
                except Exception as e:
                    logger.exception(f"Error during completion generation: {e}")
                    complete_chunk["finish_reason"] = "error"
                    complete_chunk["error"] = f"{e}"
                    yield {
                        "type": "finish",
                        "finish_reason": "error",
                        "error": f"{e}",
                    }
                    need_to_continue = False
                finally:
                    if complete_chunk["finish_reason"] == "user_stop":
                        await asyncio.wait_for(
                            asyncio.shield(
                                self._save_generation_resources(
                                    messgae_content,
                                    complete_chunk,
                                    model,
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
                            safesave=False,
                        )

        finally:
            logger.debug("session completed")

    # 辅助方法

    async def _validate_session(self, session_id: str):
        """验证会话是否存在"""
        session = await self.session_repo.get_session_by_id(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Invalid session id")
        return session

    async def _get_conversation_messages(self, session, current_message_id: str):
        """获取对话消息

        根据会话绑定的角色配置和会话自定义设置构建提示词
        """
        # 获取会话设置
        session_settings = session.settings or {}

        # 如果有绑定的角色，从角色设置中继承默认值
        character_settings = {}
        if hasattr(session, "character") and session.character:
            character_settings = session.character.settings or {}

        # 合并策略：会话设置优先，未设置的字段从角色继承
        merged_settings = {**character_settings, **session_settings}

        return await self.memory_manager_service.get_conversation_messages(
            session_id=session.id,
            model_name=session.model.model_name if session.model else None,
            user_message_id=current_message_id,
            max_messages=merged_settings.get("max_memory_length", 9999) or 9999,
            # max_tokens=merged_settings.get("max_memory_tokens", 32 * 1024)
            # or 32 * 1024,
            prompt_settings={
                "assistant_name": merged_settings.get("assistant_name"),
                "assistant_identity": merged_settings.get("assistant_identity"),
                "system_prompt": merged_settings.get("system_prompt", ""),
                "use_user_prompt": merged_settings.get("use_user_prompt", False),
            },
            disabled_tool_results=merged_settings.get("disabled_tool_results", False),
        )

    async def _validate_model_config(self, session):
        """验证模型配置"""
        model = session.model
        provider = await self.model_repo.get_provider(model.provider_id)
        if model is None:
            raise HTTPException(status_code=404, detail="Invalid model name")
        return model, provider

    def _extract_model_params(self, session, model):
        """提取模型参数

        优先使用会话的设置，如果会话没有设置则从角色配置继承
        """
        # 获取会话设置
        session_settings = session.settings or {}

        # 如果有绑定的角色，从角色设置中继承默认值
        character_settings = {}
        if hasattr(session, "character") and session.character:
            character_settings = session.character.settings or {}

        # 合并策略：会话设置优先，未设置的字段从角色继承
        merged_settings = {**character_settings, **session_settings}

        return {
            "web_search_enabled": merged_settings.get("web_search_enabled"),
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

    def _create_error_response(self, error_msg: str):
        """创建错误响应"""
        chunk = LLMServiceChunk()
        chunk.finish_reason = "error"
        chunk.error = "An error occurred during processing"
        return self.chunk_to_response(chunk)

    async def _save_generation_resources(
        self,
        assistant_content: MessageContent,
        complete_chunk: dict,
        model,
        safesave=False,
    ):
        async def save(message_content: MessageContent):
            if message_content is None:
                logger.error("Message content not found")
                return
            
            # 计算思考时长（如果有记录）
            thinking_duration_ms = None
            if hasattr(message_content, '_thinking_started_at') and \
               hasattr(message_content, '_thinking_finished_at'):
                thinking_duration_ms = int(
                    (message_content._thinking_finished_at - 
                     message_content._thinking_started_at).total_seconds() * 1000
                )
                logger.info(f"Thinking duration calculated: {thinking_duration_ms}ms")
            else:
                logger.warning(f"Thinking timestamps not found. Has start: {hasattr(message_content, '_thinking_started_at')}, Has finish: {hasattr(message_content, '_thinking_finished_at')}")
            
            message_content.role = "assistant"
            message_content.reasoning_content = complete_chunk.get("reasoning_content")
            message_content.content = complete_chunk.get("content")
            additional_kwargs = [
                "tool_calls",
                "name",
                "tool_call_id",
                "tool_calls_response",
            ]
            message_content.additional_kwargs = {}
            for key in additional_kwargs:
                if key in complete_chunk:
                    message_content.additional_kwargs[key] = complete_chunk[key]
            message_content.tool_calls = complete_chunk.get("tool_calls")
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
                logger.info(f"Thinking duration saved to meta_data: {thinking_duration_ms}ms")
            
            # 如果有 usage 信息，保存到 meta_data
            if complete_chunk.get("usage"):
                message_content.meta_data["usage"] = complete_chunk["usage"]
                logger.info(
                    f"Tokens saved: prompt={complete_chunk['usage']['prompt_tokens']}, "
                    f"completion={complete_chunk['usage']['completion_tokens']}, "
                    f"total={complete_chunk['usage']['total_tokens']}"
                )
            
            logger.debug("22222")

        if not safesave:
            await save(assistant_content)
            await self.session_repo.session.commit()
        else:
            db_manager = get_db_manager()
            async with db_manager.async_session_factory() as session:
                try:
                    logger.debug("11111111111")

                    stmt = (
                        select(MessageContent)
                        .filter(MessageContent.id == assistant_content.id)
                        .limit(1)
                    )
                    result = await session.execute(stmt)
                    message_content = result.scalar_one_or_none()
                    save(message_content)
                    await session.commit()
                except Exception as e:
                    logger.error(f"数据库会话提交失败")
                    logger.exception(e)
                    await session.rollback()
                    # raise
                finally:
                    logger.debug("数据库会话已关闭")
        logger.debug(" _save_generation_resources Generation cleanup completed")

    async def token_statistics(self, session_id: str) -> dict:
        from app.tokenizer.auto_tokenizer import get_tokenizer

        session = await self.session_repo.get_session_by_id(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")

        # 获取会话设置
        session_settings = session.settings or {}

        # 如果有绑定的角色，从角色设置中继承默认值
        character_settings = {}
        if hasattr(session, "character") and session.character:
            character_settings = session.character.settings or {}

        # 合并策略：会话设置优先，未设置的字段从角色继承
        merged_settings = {**character_settings, **session_settings}

        model = session.model

        conversation_messages = (
            await self.memory_manager_service.get_conversation_messages(
                session_id=session_id,
                model_name=session.model.model_name if session.model else None,
                user_message_id=None,
                max_messages=merged_settings.get("max_memory_length", 9999) or 9999,
                max_tokens=merged_settings.get("max_memory_tokens", 32 * 1024)
                or 32 * 1024,
                prompt_settings={
                    "assistant_name": merged_settings.get("assistant_name"),
                    "assistant_identity": merged_settings.get("assistant_identity"),
                    "system_prompt": merged_settings.get("system_prompt", ""),
                    "use_user_prompt": merged_settings.get("use_user_prompt", False),
                },
                disabled_tool_results=merged_settings.get("disabled_tool_results", False),
            )
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
            merged_settings.get("max_memory_tokens", max_memory_tokens)
            or max_memory_tokens
        )

        return (
            {
                "max_memory_tokens": max_memory_tokens,
                "system_prompt_tokens": system_prompt_tokens,
                "summary_tokens": summary_tokens,
                "context_tokens": context_tokens,
            },
        )
