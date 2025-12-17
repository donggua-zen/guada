import os
import shutil
import traceback
from typing import Optional
import uuid

from app.utils import convert_image_to_jpeg, convert_webpath_to_filepath
from config import STATIC_FILES_DIR


class UploadService:

    def upload_avatar(self, file, size: Optional[tuple | list] = None):
        try:
            """
            上传用户头像文件并转换为JPEG格式

            参数:
                file: 上传的文件对象，应包含filename属性
                size: 可选参数，指定转换后图片的尺寸，格式为(width, height)的元组

            返回值:
                str: 头像文件的Web访问路径

            异常:
                ValueError: 当文件类型无效时抛出
            """
            # 添加头像上传配置
            upload_folder = os.path.join(str(STATIC_FILES_DIR), "avatars")
            web_path = os.path.join("static", "avatars")
            allowed_extensions = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"}

            # 确保上传目录存在
            os.makedirs(upload_folder, exist_ok=True)

            def allowed_file(filename):
                return (
                    "." in filename
                    and filename.rsplit(".", 1)[1].lower() in allowed_extensions
                )

            # 检查文件类型合法性
            if not file or not allowed_file(file.filename):
                raise ValueError("Invalid file type")

            # 生成唯一文件名
            # 修改为使用uuid生成随机唯一文件名
            # file_extension = file.filename.rsplit(".", 1)[1].lower()
            unique_filename = f"{uuid.uuid4().hex}.jpg"
            # 保存文件
            file_path = os.path.join(upload_folder, unique_filename)

            convert_image_to_jpeg(file, file_path, size)

            return os.path.join(web_path, unique_filename)
        except:
            traceback.print_exc()
            raise

    def duplicate_avatar(self, avatar_path):
        if avatar_path and avatar_path.startswith("/static/avatars/"):
            source_file_path = convert_webpath_to_filepath(avatar_path)
            if os.path.exists(source_file_path):
                target_web_path = os.path.join(
                    "static", "avatars", f"{uuid.uuid4().hex}.jpg"
                )
                target_file_path = convert_webpath_to_filepath(target_web_path)
                try:
                    shutil.copy2(source_file_path, target_file_path)
                    return target_web_path
                except IOError as e:
                    print(f"Failed to copy avatar: {e}")
        return None
