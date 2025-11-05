import time
from typing import Generator, Literal, Optional, Union, overload
from openai import OpenAI, APIError


class LLMServiceChunk:
    content: Optional[str] = None
    reasoning_content: Optional[str] = None
    finish_reason: Optional[str] = None

    def __str__(self):
        """用户友好的字符串表示"""
        return f"LLMServiceChunk(content={self.content}, reasoning_content={self.reasoning_content}, finish_reason={self.finish_reason})"


class LLMService:

    def __init__(self, base_url, api_key):

        self.base_url = base_url
        self.api_key = api_key

        self.llm_client = OpenAI(base_url=base_url, api_key=self.api_key)

    def get_models(self):
        try:

            # 调用OpenAI SDK获取模型列表
            models = self.llm_client.app.models.list()

            # 提取模型ID列表
            model_list = [model.id for model in app.models.data]

            return model_list
        except Exception as e:
            return []

    @overload
    def generate_response(
        self,
        model: str,
        messages: list,
        temperature: float = ...,
        stream: Literal[False] = ...,
        thinking: bool = ...,
    ) -> LLMServiceChunk: ...

    @overload
    def generate_response(
        self,
        model: str,
        messages: list,
        temperature: float = ...,
        stream: Literal[True] = ...,
        thinking: bool = ...,
    ) -> Generator[Union[LLMServiceChunk, dict], None, None]: ...
    def generate_response(
        self,
        model,
        messages,
        temperature=None,
        top_p=None,
        frequency_penalty=None,
        stream=False,
        thinking=False,
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
            response = self.llm_client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=2500,
                frequency_penalty=frequency_penalty,
                top_p=top_p,
                temperature=temperature,
                stream=stream,
                extra_body=(
                    {"enable_thinking": thinking} if thinking is not None else {}
                ),
            )
            if stream:
                return self._handle_stream_response(response)
            else:
                return self._handle_non_stream_response(response)
        except APIError as e:
            print(f"Exception:{e}\n")
            raise Exception(str(e))
        except Exception as e:
            print(f"Exception:{e}\n")
            raise e

    def _handle_stream_response(self, response):
        """
        处理流式API响应并生成数据块

        Args:
            response: 流式API响应对象

        Yields:
            LLMServiceChunk: 包含推理内容和响应内容的数据块对象


        """
        try:
            response_chunk = LLMServiceChunk()
            for chunk in response:
                delta = chunk.choices[0].delta
                # print("chunk:", delta)
                if chunk.choices[0].finish_reason is not None:
                    print("finished,finish_reason:" + chunk.choices[0].finish_reason)
                    response_chunk.finish_reason = chunk.choices[0].finish_reason
                elif (
                    hasattr(delta, "reasoning_content")
                    and delta.reasoning_content is not None
                    and len(delta.reasoning_content) > 0
                ):
                    response_chunk.reasoning_content = delta.reasoning_content
                elif (
                    hasattr(delta, "content")
                    and delta.content is not None
                    and len(delta.content) > 0
                ):
                    response_chunk.content = delta.content
                else:
                    continue
                yield response_chunk
        except GeneratorExit as e:
            print(f"GeneratorExit: {e}\n")
            return None
        finally:
            if response is not None:
                self.close_api_connection(response)

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
        return response_chunk

    def close_api_connection(self, response):
        """强制关闭底层API连接"""
        try:
            # 方法1: 尝试直接关闭响应
            if hasattr(response, "close"):
                response.close()
                print("已关闭API连接")
                return

            # 方法2: 使用底层客户端关闭
            client = self.llm_client._client
            if client and hasattr(client, "close"):
                client.close()
                print("已关闭OpenAI客户端连接")

            # 方法3: 使用requests/httpx底层关闭
            if hasattr(response, "_response"):
                raw_response = response._response
                if hasattr(raw_response, "close"):
                    raw_response.close()
                    print("已关闭底层HTTP连接")
        except Exception as e:
            print(f"关闭连接时出错: {e}")
