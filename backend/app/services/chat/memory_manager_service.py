import base64
import logging
import os
from typing import Optional

from app.repositories.message_repository import MessageRepository
from app.tokenizer.auto_tokenizer import get_tokenizer
from app.utils import convert_webpath_to_filepath

logger = logging.getLogger(__name__)


class MemoryManagerService:

    def __init__(self, message_repo: MessageRepository):
        self.message_repo = message_repo

    def _construct_system_message(self, prompt_settings):
        system_prompt_parts = []

        # 安全地获取 system_prompt
        if "system_prompt" not in prompt_settings:
            return None
        if prompt_settings["system_prompt"] is None:
            return None
        system_prompt_parts.append(prompt_settings["system_prompt"])
        return {
            "role": "system" if not prompt_settings.get("use_user_prompt") else "user",
            "content": "\n".join(system_prompt_parts),
        }

    async def get_conversation_messages(
        self,
        session_id: str,
        model_name: str,
        user_message_id: str,
        max_messages: Optional[int] = 200,
        max_tokens: Optional[int] = None,
        prompt_settings: dict = {},
    ) -> list[dict]:

        conversation_messages = []
        tokens_total = 0
        tokenizer = get_tokenizer(model_name)

        system_message = self._construct_system_message(prompt_settings)
        if system_message:  # 添加系统消息
            tokens_total += tokenizer.count_tokens(system_message["content"])
            system_message["tokens"] = tokens_total
            max_messages -= 1

        while max_messages > len(conversation_messages) and tokens_total <= max_tokens:
            args = {
                "session_id": session_id,
                "start_message_id": None,
                "end_message_id": user_message_id,
                "include_start": False,
                "include_end": True,
                "offset": len(conversation_messages),
                "limit": min(100, max_messages - len(conversation_messages)),
                "order_type": "desc",
                "with_files": True,
                "with_contents": True,
                "only_current_content": True,
            }

            messages = await self.message_repo.get_messages(**args)
            if not messages:  # 没有更多消息则跳出循环
                break
            include = ["contents"]
            if args["with_files"]:  # 获取文件内容
                include.append("files")

            for msg in messages:
                transformed_msg = self._transform_content_structure(
                    await msg.to_dict_async(include=include)
                )
                if max_tokens:
                    transformed_msg["tokens"] = tokenizer.count_tokens(
                        transformed_msg["content"]
                    )
                    tokens_total += transformed_msg["tokens"]

                    if tokens_total > max_tokens:
                        break
                    conversation_messages.append(transformed_msg)

        if system_message:
            conversation_messages.append(system_message)

        conversation_messages.reverse()
        return conversation_messages

    # def get_memory_strategy(self, memory_type: str) -> MemoryStrategy:
    #     pass
    def _transform_content_structure(self, msg: dict):
        """
        生成消息内容，如果包含文件则添加文件内容作为附件。

        Args:
            msg (dict): 包含 'contents' 和可选 'files' 键的消息字典

        Returns:
            str or list: 消息内容字符串或包含文本和文件内容的列表
        """
        if "contents" in msg:
            msg["content"] = [
                content["content"]
                for content in msg["contents"]
                if content["is_current"]
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
                image_part = self._transform_image_file(file)
                if image_part:
                    content_parts.append(image_part)
            elif file.get("file_type") == "text":
                text_part = self._transform_text_file(file, i)
                if text_part:
                    content_parts.append(text_part)

        return {**msg, "content": content_parts}

    def _transform_image_file(self, file: dict):
        """
        将图像文件转换为模型可识别的格式

        Args:
            file (dict): 包含图像文件信息的字典

        Returns:
            dict: 转换后的图像内容字典
        """
        file_url = file.get("url", "")
        image_body = {}
        if file_url.startswith("/"):
            file_path = convert_webpath_to_filepath(file_url)
            try:
                if os.path.exists(file_path):
                    with open(file_path, "rb") as image_file:
                        # 读取图片文件并编码为base64
                        base64_data = base64.b64encode(image_file.read()).decode(
                            "utf-8"
                        )

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
                        image_body["url"] = f"data:{mime_type};base64,{base64_data}"
                    logger.debug(f"成功将图片 {file_path} 转换为base64格式")
                else:
                    logger.warning(f"图片文件不存在: {file_path}")
                    image_body["url"] = ""  # 文件不存在时设置为空
            except Exception as e:
                logger.error(f"图片文件读取失败: {file_path}, 错误: {str(e)}")
                image_body["url"] = ""  # 读取失败时设置为空
        else:
            image_body["url"] = file_url

        return {
            "type": "image_url",
            "image_url": image_body,
        }

    def _transform_text_file(self, file: dict, index: int):
        """
        将文本文件转换为模型可识别的格式

        Args:
            file (dict): 包含文本文件信息的字典
            index (int): 文件索引

        Returns:
            dict: 转换后的文本内容字典
        """
        # 确保 file 对象具有所需属性
        file_name = file.get("file_name", "unknow")
        file_content = file.get("content", "")

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
