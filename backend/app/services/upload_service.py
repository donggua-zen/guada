import os
import shutil
import traceback
from typing import Optional
import uuid

from fastapi import HTTPException
from app.utils import convert_image_to_jpeg, convert_webpath_to_filepath, upload_paths
from app.config import settings


class UploadService:
    # 定义允许的文件扩展名常量
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"}

    # 头像上传相关配置（使用统一的路径管理）
    AVATAR_UPLOAD_SUBDIR = "avatars"

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
            # 使用统一的路径管理工具
            avatars_dir = upload_paths.get_avatars_upload_dir()
                    
            # 确保上传目录存在
            os.makedirs(avatars_dir, exist_ok=True)

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
            file_path = upload_paths.build_avatar_save_path(unique_filename)

            # 转换并保存图片
            convert_image_to_jpeg(file, file_path, size)
            
            # 使用统一的路径管理工具转换为 Web 路径
            return upload_paths.to_web_path(file_path, "avatars")

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
                upload_paths.avatars_web_prefix
            ):
                return None

            source_file_path = convert_webpath_to_filepath(avatar_path)
            if not os.path.exists(source_file_path):
                return None

            # 生成新的目标路径
            target_web_path = upload_paths.get_avatar_web_url(f"{uuid.uuid4().hex}.jpg")
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
