import os
import uuid

from app.utils import convert_image_to_jpeg


class UploadService:
    pass

    def upload_avatar(
        self,
        file,
    ):
        # 添加头像上传配置
        upload_folder = os.path.join("app", "static", "avatars")  # 更规范的路径构建
        web_path = os.path.join("static", "avatars")
        allowed_extensions = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"}

        # 确保上传目录存在
        os.makedirs(upload_folder, exist_ok=True)

        def allowed_file(filename):
            return (
                "." in filename
                and filename.rsplit(".", 1)[1].lower() in allowed_extensions
            )

        # 检查文件类型
        if not file or not allowed_file(file.filename):
            raise ValueError("Invalid file type")

        # 生成唯一文件名
        # 修改为使用uuid生成随机唯一文件名
        # file_extension = file.filename.rsplit(".", 1)[1].lower()
        unique_filename = f"{uuid.uuid4().hex}.jpg"
        # 保存文件
        file_path = os.path.join(upload_folder, unique_filename)

        convert_image_to_jpeg(file, file_path)

        return os.path.join(web_path, unique_filename)

    def convert_webpath_to_filepath(self, web_path):
        file_path = os.path.join("app", web_path)
        return file_path
