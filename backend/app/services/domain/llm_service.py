import asyncio
import logging
from typing import AsyncGenerator, List, Literal, Optional, overload
from openai import AsyncOpenAI, APIError

logger = logging.getLogger(__name__)


class LLMServiceChunk:
    content: Optional[str] = None
    reasoning_content: Optional[str] = None
    finish_reason: Optional[str] = None
    error: Optional[str] = None
    additional_kwargs: Optional[dict] = {}
    usage: Optional[dict] = None  # 新增：usage 信息

    def __str__(self):
        """用户友好的字符串表示"""
        return f"LLMServiceChunk(content={self.content}, reasoning_content={self.reasoning_content}, finish_reason={self.finish_reason})"

    def to_dict(self):
        """
        将对象转换为字典格式

        Returns:
            dict: 包含对象属性的字典，包含以下键值对：
                - content: 内容信息
                - reasoning_content: 推理内容
                - finish_reason: 完成原因
                - error: 错误信息
                - usage: tokens 消耗信息（如果存在）
        """
        return {
            "content": self.content,
            "reasoning_content": self.reasoning_content,
            "finish_reason": self.finish_reason,
            "error": self.error,
            "additional_kwargs": self.additional_kwargs,
            "usage": self.usage,  # 新增
        }


class LLMService:

    def __init__(self, base_url, api_key):

        self.base_url = base_url
        self.api_key = api_key

        self.llm_client = AsyncOpenAI(base_url=base_url, api_key=self.api_key)

    @overload
    async def completions(
        self,
        model,
        messages,
        temperature,
        top_p,
        frequency_penalty,
        stream: Literal[False],
        thinking,
    ) -> LLMServiceChunk: ...

    @overload
    async def completions(
        self,
        model,
        messages,
        temperature,
        top_p,
        frequency_penalty,
        stream: Literal[True],
        thinking,
        complete_chunk: LLMServiceChunk = ...,
    ) -> AsyncGenerator[LLMServiceChunk, None]: ...

    async def completions(
        self,
        model: str,
        messages: list,
        temperature=None,
        top_p=None,
        frequency_penalty=None,
        stream=False,
        thinking=False,
        complete_chunk: LLMServiceChunk = None,
        tools: Optional[list[dict]] = None,
    ):
        """
        根据输入的messages和指定的模型生成响应。

        Args:
            model (str): 使用的模型名称。
            messages (list): 输入的消息列表。
            temperature (float, optional): 温度参数，用于控制生成文本的随机性。默认为0.75。
            stream (bool, optional): 是否以流式方式生成响应。默认为False。
            thinking (bool, optional): 是否在生成响应时启用思考功能。默认为False。

        Returns:
            如果stream为True，则返回一个生成器，生成包含"reasoning_content"和"content"的字典。
            如果stream为False，则返回一个元组，包含完整的响应文本和推理内容（如果有的话）。

        Raises:
            APIError: 如果API调用失败，则抛出此异常。
            Exception: 如果发生其他类型的异常，则抛出此异常。

        """
        response = None
        try:
            logger.debug("messages:%d", len(messages))
            logger.debug("freq_penalty: %s", frequency_penalty)
            logger.debug("top_p: %s", top_p)
            logger.debug("temperature: %s", temperature)

            extra_body = {}
            if thinking:
                extra_body["enable_thinking"] = thinking
            oai_messages = []
            for message in messages:
                # 构建基础消息对象，只包含必要字段
                print(message)
                oai_message = {
                    "role": message["role"],
                    "content": message.get("content", ""),
                }

                # 可选字段：如果存在则添加
                if message.get("reasoning_content"):
                    oai_message["reasoning_content"] = message["reasoning_content"]

                if message.get("tool_call_id"):
                    oai_message["tool_call_id"] = message["tool_call_id"]

                if message.get("tool_calls", None):
                    oai_message["tool_calls"] = []
                    for tool_call in message["tool_calls"]:
                        oai_message["tool_calls"].append(
                            {
                                "id": tool_call["id"],
                                "index": tool_call["index"],
                                "type": tool_call["type"],
                                "function": {
                                    "name": tool_call["name"],
                                    "arguments": tool_call["arguments"],
                                },
                            }
                        )
                oai_messages.append(oai_message)
            print(oai_messages)
            response = await self.llm_client.chat.completions.create(
                model=model,
                messages=oai_messages,
                frequency_penalty=frequency_penalty or None,
                top_p=top_p or None,
                temperature=temperature or None,
                stream=stream,
                extra_body=extra_body,
                timeout=60,
                tool_choice="auto",
                tools=tools,
            )
            if stream:
                # 对于异步流式响应，需要直接返回异步生成器
                async for chunk in response:
                    # 检查 chunk 是否包含 usage（通常在最后一个 chunk）
                    if hasattr(chunk, 'usage') and chunk.usage is not None:
                        logger.debug(f"Got usage from chunk: prompt={chunk.usage.prompt_tokens}, completion={chunk.usage.completion_tokens}, total={chunk.usage.total_tokens}")
                    
                    response_chunk = self._handle_stream_chunk(
                        chunk, complete_chunk=complete_chunk
                    )
                    if response_chunk:
                        yield response_chunk
                    else:
                        continue
            else:
                yield self._handle_non_stream_response(response)
        except APIError as e:
            logger.exception(f"Exception:{e}\n")
            raise Exception(str(e))
        except Exception as e:
            raise
        finally:
            if response is not None:
                await self.close_api_connection(response)

    def _handle_stream_chunk(self, chunk, complete_chunk: LLMServiceChunk = None):
        response_chunk = LLMServiceChunk()
        delta = chunk.choices[0].delta
        # logger.debug("chunk:", delta)
        
        # 提取 usage 信息（如果存在）
        if hasattr(chunk, 'usage') and chunk.usage is not None:
            response_chunk.usage = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens,
            }
            if complete_chunk is not None:
                complete_chunk.usage = response_chunk.usage
        
        if chunk.choices[0].finish_reason is not None:
            logger.debug("finished,finish_reason:" + chunk.choices[0].finish_reason)
            response_chunk.finish_reason = chunk.choices[0].finish_reason
            if complete_chunk is not None:
                complete_chunk.finish_reason = response_chunk.finish_reason

        elif (
            hasattr(delta, "reasoning_content")
            and delta.reasoning_content is not None
            and len(delta.reasoning_content) > 0
        ):
            response_chunk.reasoning_content = delta.reasoning_content
            if complete_chunk is not None:
                complete_chunk.reasoning_content = (
                    complete_chunk.reasoning_content or ""
                ) + delta.reasoning_content

        elif (
            hasattr(delta, "content")
            and delta.content is not None
            and len(delta.content) > 0
        ):
            response_chunk.content = delta.content
            if complete_chunk is not None:
                complete_chunk.content = (complete_chunk.content or "") + delta.content
        elif (
            hasattr(delta, "tool_calls")
            and delta.tool_calls is not None
            and len(delta.tool_calls) > 0
        ):
            response_chunk.additional_kwargs["tool_calls"] = []
            for tool_call in delta.tool_calls:
                tc = {}
                tc["id"] = tool_call.id
                tc["index"] = tool_call.index
                tc["type"] = "function"
                tc["name"] = tool_call.function.name
                tc["arguments"] = tool_call.function.arguments
                response_chunk.additional_kwargs["tool_calls"].append(tc)
        else:
            return None
        return response_chunk

    def _handle_non_stream_response(self, response):
        """
        处理非流式API响应并返回结果

        Args:
            response: 非流式API响应对象

        Returns:
            LLMServiceChunk: 包含推理内容和响应内容的数据块对象
        """
        response_chunk = LLMServiceChunk()
        if response.choices and response.choices[0].message:
            message = response.choices[0].message
            if hasattr(message, "reasoning_content") and message.reasoning_content:
                response_chunk.reasoning_content = message.reasoning_content
            if hasattr(message, "content") and message.content:
                response_chunk.content = message.content.strip()
            if hasattr(message, "tool_calls") and message.tool_calls:
                calls = []
                for tool_call in message.tool_calls:
                    tc = {}
                    tc["id"] = tool_call.id
                    tc["index"] = tool_call.index
                    tc["type"] = "function"
                    tc["arguments"] = tool_call.function.arguments
                    tc["name"] = tool_call.function.name
                    calls.append(tc)
                response_chunk.additional_kwargs["tool_calls"] = calls
            if hasattr(message, "finish_reason") and message.finish_reason:
                response_chunk.finish_reason = message.finish_reason

        return response_chunk

    async def close_api_connection(self, response):
        """强制关闭底层API连接"""
        try:
            # 方法1: 尝试直接关闭响应
            if hasattr(response, "close"):
                await response.close()
                logger.debug("已关闭API连接")
                return
            logger.warning("无法直接关闭API连接")
        except Exception as e:
            logger.exception(f"关闭连接时出错: {e}")
