import os
import shutil
import traceback
from typing import Optional
import uuid

from fastapi import HTTPException
from app.utils import convert_image_to_jpeg, convert_webpath_to_filepath
from app.config import settings


class UploadService:
    # 定义允许的文件扩展名常量
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"}

    # 定义头像上传相关路径常量
    AVATAR_UPLOAD_SUBDIR = "avatars"
    AVATAR_WEB_PATH_PREFIX = "/static/avatars/"

    @classmethod
    def allowed_file(cls, filename: str) -> bool:
        """
        检查文件扩展名是否在允许的列表中

        Args:
            filename: 文件名

        Returns:
            bool: 如果文件类型允许返回True，否则返回False
        """
        return (
            "." in filename
            and filename.rsplit(".", 1)[1].lower() in cls.ALLOWED_EXTENSIONS
        )

    def upload_avatar(self, file, size: Optional[tuple | list] = None):
        """
        上传用户头像文件并转换为JPEG格式

        参数:
            file: 上传的文件对象，应包含filename属性
            size: 可选参数，指定转换后图片的尺寸，格式为(width, height)的元组

        返回值:
            str: 头像文件的Web访问路径

        异常:
            ValueError: 当文件类型无效时抛出
            IOError: 当文件操作失败时抛出
        """
        try:
            # 构建上传目录和Web路径
            upload_folder = os.path.join(
                str(settings.TATIC_FILES_DIR), self.AVATAR_UPLOAD_SUBDIR
            )
            web_path = os.path.join("static", self.AVATAR_UPLOAD_SUBDIR)

            # 确保上传目录存在
            os.makedirs(upload_folder, exist_ok=True)

            # 检查文件对象和文件类型合法性
            if not file:
                raise HTTPException(status_code=400, detail="File object is required")

            if not hasattr(file, "filename"):
                raise HTTPException(status_code=400, detail="File object must have filename attribute")

            if not self.allowed_file(file.filename):
                raise HTTPException(
                    status_code=400, 
                    detail=f"Invalid file type. Allowed types: {', '.join(self.ALLOWED_EXTENSIONS)}"
                )

            # 生成唯一文件名并保存
            unique_filename = f"{uuid.uuid4().hex}.jpg"
            file_path = os.path.join(upload_folder, unique_filename)

            # 转换并保存图片
            convert_image_to_jpeg(file, file_path, size)

            return os.path.join(web_path, unique_filename)

        except Exception as e:
            traceback.print_exc()
            if isinstance(e, HTTPException):
                raise
            raise HTTPException(status_code=500, detail=f"Failed to upload avatar: {str(e)}") from e

    def duplicate_avatar(self, avatar_path: str) -> Optional[str]:
        """
        复制现有头像文件并生成新的唯一文件名

        Args:
            avatar_path: 原始头像的Web路径

        Returns:
            str: 新头像的Web路径，如果复制失败则返回None
        """
        try:
            if not avatar_path or not avatar_path.startswith(
                self.AVATAR_WEB_PATH_PREFIX
            ):
                return None

            source_file_path = convert_webpath_to_filepath(avatar_path)
            if not os.path.exists(source_file_path):
                return None

            # 生成新的目标路径
            target_web_path = os.path.join(
                "static", "avatars", f"{uuid.uuid4().hex}.jpg"
            )
            target_file_path = convert_webpath_to_filepath(target_web_path)

            # 使用copy2复制文件，保留元数据
            shutil.copy2(source_file_path, target_file_path)
            return target_web_path

        except (IOError, OSError) as e:
            print(f"Failed to copy avatar: {e}")
            return None
        except Exception as e:
            print(f"Unexpected error when copying avatar: {e}")
            traceback.print_exc()
            return None
