import os
from typing import Optional
import uuid
from app.repositories.file_repository import FileRepository as FileRepo
from app.utils import (
    build_url_path,
    convert_webpath_to_filepath,
    resize_and_convert_image,
)


class FileService:
    def __init__(self, file_repo: FileRepo):
        self.file_repo = file_repo

    async def add_file(
        self,
        file_name: str,
        display_name: str,
        file_ext: str,
        file_type: str,
        file_size: int,
        file_content: str,
        session_id: str,
        message_id: str,
        content_hash: str,
        url: str = None,
        preview_url: str = None,
    ):
        """
        添加文件到数据库

        :param file_name: 文件名
        :param display_name: 文件显示名称
        :param file_extension: 文件扩展名
        :param file_type: 文件类型(text, image, video, audio, file)
        :param file_size: 文件大小
        :param file_content: 文件内容
        :param session_id: 会话ID
        :param message_id: 消息ID
        :return: 文件信息
        """
        file = await self.file_repo.add_file(
            file_name,
            display_name,
            file_ext,
            file_type,
            file_size,
            file_content,
            session_id,
            message_id,
            content_hash,
            url,
            preview_url,
        )

        return file

    async def delete_file(self, file_id: int):
        if not await self.file_repo.delete_file(file_id):
            raise Exception("删除文件失败")
        return {}

    async def copy_message_file(self, file_id, message_id, session_id: Optional[str] = None):
        file = await self.file_repo.get_file(file_id)
        file_name = file["file_name"]
        display_name = file["display_name"]
        file_ext = file["file_ext"]
        file_type = file["file_type"]
        file_size = file["file_size"]
        file_content = file["file_content"]
        content_hash = file["content_hash"]
        if session_id is None:
            session_id = file["session_id"]
        return await self.add_file(
            file_name,
            display_name,
            file_ext,
            file_type,
            file_size,
            file_content,
            session_id,
            message_id,
            content_hash,
        )

    def upload_message_image_file(self, file):
        # 添加头像上传配置
        web_path = os.path.join("static", "uploads", "images")
        preview_web_path = os.path.join("static", "uploads", "previews")
        upload_folder = convert_webpath_to_filepath(web_path)
        preview_folder = convert_webpath_to_filepath(preview_web_path)

        unique_filename = f"{uuid.uuid4().hex}.jpg"
        # 确保上传目录存在
        os.makedirs(upload_folder, exist_ok=True)
        os.makedirs(preview_folder, exist_ok=True)
        file_path = os.path.join(upload_folder, unique_filename)
        preview_file_path = os.path.join(preview_folder, unique_filename)
        # 上传图
        resize_and_convert_image(
            file, file_path, width=512, height=None, force_scale=False
        )
        # 预览图
        resize_and_convert_image(
            file, preview_file_path, width=256, height=256, force_scale=False
        )

        return build_url_path(web_path, unique_filename), build_url_path(
            preview_web_path, unique_filename
        )

    async def upload_message_file(self, sessions_id, file):
        session_id = sessions_id
        allowed_jpeg_extensions = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"}

        try:

            # 获取文件基本信息
            file_name = file.filename
            display_name = (
                file.filename.rsplit(".", 1)[0]
                if "." in file.filename
                else file.filename
            )
            file_ext = (
                file.filename.rsplit(".", 1)[1].lower() if "." in file.filename else ""
            )
            pic_path = None
            preview_path = None
            file_content = None

            file_type = "text"
            file_size = len(file.read())
            file.seek(0)  # 重置文件指针

            if file_ext in allowed_jpeg_extensions:
                pic_path, preview_path = self.upload_message_image_file(file)
                file_type = "image"
            else:
                file_type = "text"
                # 读取文件内容
                file_content = file.read().decode("utf-8")
                file.seek(0)  # 重置文件指针

            # 计算文件hash值
            file_hash = "none"

            # 调用file_service保存文件信息到数据库
            file_info = await self.add_file(
                file_name=file_name,
                display_name=display_name,
                file_ext=file_ext,
                file_type=file_type,
                file_size=file_size,
                file_content=file_content,
                session_id=session_id,
                message_id=None,
                content_hash=file_hash,
                url=pic_path,
                preview_url=preview_path,
            )

            return file_info

        except Exception as e:
            raise e