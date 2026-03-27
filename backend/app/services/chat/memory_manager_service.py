import base64
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.repositories.message_repository import MessageRepository
from app.tokenizer.auto_tokenizer import get_tokenizer
from app.utils import convert_webpath_to_filepath

logger = logging.getLogger(__name__)


class MemoryManagerService:
    """
    内存管理服务

    负责管理对话历史、上下文窗口和记忆策略。
    提供对话消息获取、标题生成、总结等功能。

    Attributes:
        message_repo: 消息仓库实例，用于数据库操作
    """

    # 图片文件 MIME 类型映射
    IMAGE_MIME_TYPES: Dict[str, str] = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "webp": "image/webp",
        "tiff": "image/tiff",
    }

    # 默认配置常量
    DEFAULT_MAX_MESSAGES: int = 200
    DEFAULT_SUMMARY_MESSAGE_COUNT: int = 3
    MAX_BATCH_SIZE: int = 100

    def __init__(self, message_repo: MessageRepository):
        """
        初始化内存管理服务

        Args:
            message_repo: 消息仓库实例
        """
        self.message_repo = message_repo
        self._tokenizer_cache: Dict[str, Any] = {}

    async def get_conversation_messages(
        self,
        session_id: str,
        user_message_id: Optional[str] = None,
        max_messages: Optional[int] = None,
        skip_tool_calls: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        获取对话历史消息

        从数据库中检索指定会话的对话消息，支持分页、文件内容加载。
        消息按时间倒序返回（最新的在前）。

        ⚠️ 注意：此方法不再处理系统提示词，调用方需要自行构造并添加到消息列表

        Args:
            session_id: 会话 ID
            user_message_id: 可选的用户消息 ID，如果提供则只获取到此消息为止的历史
            max_messages: 最大消息数量，默认为 DEFAULT_MAX_MESSAGES (200)
            skip_tool_calls: 是否跳过包含工具调用的轮次。如果为 True，则过滤掉所有包含 tool_calls
                            或 tool_calls_response 的消息轮次；默认为 False（保留所有消息）

        Returns:
            List[Dict[str, Any]]: 消息列表，每个消息是一个字典，包含 role、content 等字段
                                 消息按时间倒序排列（最新在前），调用方需要自行反转

        Raises:
            ValueError: 如果 session_id 为空或无效
            Exception: 数据库查询失败或其他未知错误

        Example:
            >>> messages = await memory_manager.get_conversation_messages(
            ...     session_id="session_123",
            ...     max_messages=50,
            ...     skip_tool_calls=True  # 跳过工具调用轮次
            ... )
            >>> # 调用方需要自行添加系统提示词（如果有）
            >>> if system_prompt:
            ...     messages.insert(0, {"role": "system", "content": system_prompt})
            >>> # 注意：返回的消息已经是倒序（最新在前），无需再次反转
        """
        # 参数验证
        if not session_id or not isinstance(session_id, str):
            raise ValueError(f"无效的 session_id: {session_id}")

        # 使用默认值
        if max_messages is None:
            max_messages = self.DEFAULT_MAX_MESSAGES

        conversation_messages: List[Dict[str, Any]] = []

        # 分批获取消息直到达到上限
        while len(conversation_messages) < max_messages:
            # 计算本次请求的数量
            remaining = max_messages - len(conversation_messages)
            batch_size = min(self.MAX_BATCH_SIZE, remaining)

            query_args = {
                "session_id": session_id,
                "start_message_id": None,
                "end_message_id": user_message_id,
                "include_start": False,
                "include_end": True,
                "offset": len(conversation_messages),
                "limit": batch_size,
                "order_type": "desc",
                "with_files": True,
                "with_contents": True,
                "only_current_content": True,
            }

            messages = await self.message_repo.get_messages(**query_args)
            if not messages:  # 没有更多消息则跳出循环
                break

            include_fields = ["contents"]
            if query_args["with_files"]:
                include_fields.append("files")

            for msg in messages:
                # 转换为字典并处理内容结构
                msg_dict = await msg.to_dict_async(include=include_fields)
                transformed_msgs = self._transform_content_structure(
                    msg_dict,
                    skip_tool_calls=skip_tool_calls,
                )
                # 反转后添加（保持原始顺序）
                transformed_msgs.reverse()
                conversation_messages.extend(transformed_msgs)

        # 反转为正序（最新的在前）
        conversation_messages.reverse()
        return conversation_messages

    async def get_recent_messages_for_summary(
        self,
        session_id: str,
        skip_tool_calls: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        获取最近的对话消息用于总结任务

        获取最近的 3 条消息（不含系统消息），用于生成会话标题或其他总结任务。
        返回的消息按时间正序排列（从旧到新）。

        ⚠️ 注意：此方法不再处理系统提示词，返回的消息仅包含用户和助手对话

        Args:
            session_id: 会话 ID
            skip_tool_calls: 是否跳过包含工具调用的轮次。默认为 True（总结任务通常不需要工具调用细节）

        Returns:
            List[Dict[str, Any]]: 最多 3 条消息（不含系统消息），按时间正序排列（从旧到新）
                                 如果会话中没有非系统消息，返回空列表

        Raises:
            ValueError: 如果 session_id 为空或无效
            Exception: 数据库查询失败或其他未知错误

        Example:
            >>> recent_msgs = await memory_manager.get_recent_messages_for_summary(
            ...     session_id="session_123",
            ...     skip_tool_calls=True  # 跳过工具调用轮次
            ... )
        """
        # 参数验证
        if not session_id or not isinstance(session_id, str):
            raise ValueError(f"无效的 session_id: {session_id}")

        # 复用现有方法获取最近的消息（不指定 end_message_id，默认获取到最新消息）
        all_messages = await self.get_conversation_messages(
            session_id=session_id,
            user_message_id=None,  # 不指定，获取最新消息
            max_messages=self.DEFAULT_SUMMARY_MESSAGE_COUNT,  # 限制 3 条
            skip_tool_calls=skip_tool_calls,
        )

        # 过滤掉系统消息（理论上不应该有，因为 get_conversation_messages 不再返回系统消息）
        non_system_messages = [
            msg for msg in all_messages if msg.get("role") != "system"
        ]

        # get_conversation_messages 返回的是倒序（最新在前），需要反转成正序（从旧到新）
        non_system_messages.reverse()

        # 只取最新的 3 条（已经是正序：从旧到新）
        return non_system_messages[: self.DEFAULT_SUMMARY_MESSAGE_COUNT]

    # def get_memory_strategy(self, memory_type: str) -> MemoryStrategy:
    #     pass
    def _transform_content_structure(
        self, msg: Dict[str, Any], skip_tool_calls: bool = True
    ) -> List[Dict[str, Any]]:
        """
        转换消息内容结构为模型可识别的格式

        处理消息的内容和附件（图片、文本文件），转换为 LLM API 所需的格式。
        支持多轮对话的消息拆分和工具调用结果的处理。

        Args:
            msg: 消息字典，包含 'role'、'contents' 和可选的 'files' 键
            skip_tool_calls: 是否跳过包含工具调用的轮次。如果为 True，则过滤掉所有包含
                            tool_calls 或 tool_calls_response 的消息轮次

        Returns:
            List[Dict[str, Any]]: 转换后的消息列表，每条消息包含 role、content 等字段
                                 可能返回多条消息（当 assistant 有多个 turn 时）

        Raises:
            ValueError: 如果 msg 格式不正确或缺少必需字段
            KeyError: 如果访问不存在的字段
        """
        # 输入验证
        if not isinstance(msg, dict):
            raise ValueError(f"msg 必须是字典类型，实际：{type(msg)}")
        if "role" not in msg:
            raise ValueError("msg 必须包含 'role' 字段")
        if "contents" not in msg or not isinstance(msg["contents"], list):
            raise ValueError("msg 必须包含 'contents' 列表字段")

        transformed_msgs: List[Dict[str, Any]] = []

        if msg["role"] == "assistant":
            # 处理助手消息（可能包含多个 turn 和工具调用）
            for turn in msg["contents"]:
                base_msg = {
                    "role": turn.get("role", "assistant"),
                    "content": turn.get("content", "") or "",
                    "reasoning_content": turn.get("reasoning_content"),
                }

                # 处理工具调用
                tool_calls = turn.get("additional_kwargs", {}).get("tool_calls")
                if tool_calls:
                    # 只有在未跳过工具调用时才添加
                    if not skip_tool_calls:
                        base_msg["tool_calls"] = tool_calls
                    else:
                        # 跳过时不添加此 turn（包含工具调用的整个轮次）
                        continue

                transformed_msgs.append(base_msg)

                # 处理工具响应
                tool_responses = turn.get("additional_kwargs", {}).get(
                    "tool_calls_response"
                )
                if tool_responses and not skip_tool_calls:
                    # 添加每个工具响应作为独立消息
                    transformed_msgs.extend(
                        [
                            {
                                "role": "tool",
                                **res,
                            }
                            for res in tool_responses
                        ]
                    )

        else:
            # 处理用户消息
            if not msg["contents"]:
                logger.warning(f"用户消息 contents 为空：{msg}")
                return [{"role": msg["role"], "content": ""}]

            active_content = msg["contents"][0]
            transformed_msgs = [
                {
                    "role": msg["role"],
                    "content": active_content.get("content", ""),
                }
            ]

            # 处理附加文件
            files = msg.get("files")
            if files and isinstance(files, list):
                # 构建包含基础内容和文件内容的列表
                content_parts = [
                    {
                        "text": transformed_msgs[0]["content"],
                        "type": "text",
                    }
                ]

                # 添加每个文件的内容
                for i, file in enumerate(files):
                    if not isinstance(file, dict):
                        logger.warning(f"文件信息格式错误：{file}")
                        continue

                    file_type = file.get("file_type")
                    if file_type == "image":
                        image_part = self._transform_image_file(file)
                        if image_part:
                            content_parts.append(image_part)
                    elif file_type == "text":
                        text_part = self._transform_text_file(file, i)
                        if text_part:
                            content_parts.append(text_part)
                    else:
                        logger.debug(f"未知的文件类型：{file_type}")

                transformed_msgs[0]["content"] = content_parts

        return transformed_msgs

    def _transform_image_file(self, file: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        将图像文件转换为模型可识别的 base64 格式

        支持本地文件路径和远程 URL 两种形式。对于本地文件，读取并编码为 base64；
        对于远程 URL，直接使用。

        Args:
            file: 包含图像文件信息的字典，应包含以下键：
                  - url: 文件 URL 或路径
                  - file_extension: 文件扩展名（用于确定 MIME 类型）

        Returns:
            Optional[Dict[str, Any]]: 转换后的图像内容字典，格式为：
                                      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
                                      如果文件不存在或读取失败，返回 None

        Raises:
            Exception: 文件读取或编码过程中出现错误
        """
        # 输入验证
        if not isinstance(file, dict):
            logger.error(f"file 必须是字典类型，实际：{type(file)}")
            return None

        file_url = file.get("url", "")
        if not file_url:
            logger.warning("图片 URL 为空")
            return None

        image_body: Dict[str, str] = {}

        # 处理本地文件路径
        if file_url.startswith("/"):
            try:
                file_path = convert_webpath_to_filepath(file_url)

                # 安全检查：确保路径在允许的目录内
                if not self._is_safe_file_path(file_path):
                    logger.error(f"不安全的文件路径：{file_path}")
                    return None

                if os.path.exists(file_path):
                    with open(file_path, "rb") as image_file:
                        # 读取图片文件并编码为 base64
                        base64_data = base64.b64encode(image_file.read()).decode(
                            "utf-8"
                        )

                        # 根据文件扩展名确定 MIME 类型
                        file_extension = file.get("file_extension", "jpeg").lower()
                        mime_type = self.IMAGE_MIME_TYPES.get(
                            file_extension, "image/jpeg"  # 默认 MIME 类型
                        )

                        # 构造 data URI 格式
                        image_body["url"] = f"data:{mime_type};base64,{base64_data}"
                    logger.debug(f"成功将图片 {file_path} 转换为 base64 格式")
                else:
                    logger.warning(f"图片文件不存在：{file_path}")
                    image_body["url"] = ""  # 文件不存在时设置为空

            except FileNotFoundError as e:
                logger.error(f"图片文件未找到：{file_url}, 错误：{str(e)}")
                image_body["url"] = ""
            except PermissionError as e:
                logger.error(f"图片文件权限错误：{file_url}, 错误：{str(e)}")
                image_body["url"] = ""
            except Exception as e:
                logger.error(f"图片文件读取失败：{file_url}, 错误：{str(e)}")
                image_body["url"] = ""  # 读取失败时设置为空
        else:
            # 远程 URL 直接使用
            image_body["url"] = file_url

        return {
            "type": "image_url",
            "image_url": image_body,
        }

    def _is_safe_file_path(self, file_path: str) -> bool:
        """
        检查文件路径是否安全（防止目录遍历攻击）

        Args:
            file_path: 要检查的文件路径

        Returns:
            bool: 如果路径安全返回 True，否则返回 False
        """
        try:
            # 解析路径
            resolved_path = Path(file_path).resolve()

            # 获取项目根目录
            project_root = Path(__file__).parent.parent.parent.parent

            # 检查路径是否在项目目录内
            return str(resolved_path).startswith(str(project_root))
        except Exception as e:
            logger.error(f"路径安全检查失败：{file_path}, 错误：{str(e)}")
            return False

    def _transform_text_file(
        self, file: Dict[str, Any], index: int
    ) -> Optional[Dict[str, str]]:
        """
        将文本文件转换为模型可识别的格式

        将文本文件内容包装为特殊的 XML 标签格式，便于模型识别和处理。

        Args:
            file: 包含文本文件信息的字典，应包含以下键：
                  - file_name: 文件名
                  - content: 文件内容
            index: 文件索引（从 0 开始）

        Returns:
            Optional[Dict[str, str]]: 转换后的文本内容字典，格式为：
                                      {"text": "<ATTACHMENT_FILE>...</ATTACHMENT_FILE>", "type": "text"}
                                      如果文件信息无效，返回 None
        """
        # 输入验证
        if not isinstance(file, dict):
            logger.error(f"file 必须是字典类型，实际：{type(file)}")
            return None

        # 确保 file 对象具有所需属性
        file_name = file.get("file_name", "unknown")
        file_content = file.get("content", "")

        # 构建结构化的文本内容
        file_text = (
            f"\n\n<ATTACHMENT_FILE>\n"
            f"<FILE_INDEX>File {index}</FILE_INDEX>\n"
            f"<FILE_NAME>{file_name}</FILE_NAME>\n"
            f"<FILE_CONTENT>\n{file_content}\n</FILE_CONTENT>\n"
            f"</ATTACHMENT_FILE>\n"
        )

        return {
            "text": file_text,
            "type": "text",
        }
