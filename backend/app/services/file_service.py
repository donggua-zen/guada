from app.repositories.file_repository import FileRepository as FileRepo
from app.repositories.message_repository import MessageRepository


class FileService:
    def __init__(self):
        pass

    def add_file(
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
        return FileRepo.add_file(
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

    def delete_file(self, file_id: int):
        if not FileRepo.delete_file(file_id):
            raise Exception("删除文件失败")
        return {}

    def upload_message_file(self, message_id, file):
        # 添加hashlib导入用于计算文件hash
        import hashlib

        message = MessageRepository.get_message(message_id)
        session_id = message["session_id"]
        message_id = message["id"]

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
            file_size = len(file.read())
            file.seek(0)  # 重置文件指针

            # 读取文件内容
            file_content = file.read().decode("utf-8")
            file.seek(0)  # 重置文件指针

            # 计算文件hash值
            file_hash = hashlib.sha256(file_content.encode("utf-8")).hexdigest()

            # 设置文件类型为text
            file_type = "text"

            # 调用file_service保存文件信息到数据库
            file_info = self.add_file(
                file_name=file_name,
                display_name=display_name,
                file_ext=file_ext,
                file_type=file_type,
                file_size=file_size,
                file_content=file_content,
                session_id=session_id,
                message_id=message_id,
                content_hash=file_hash,  # 使用计算出的hash值替换空字符串
            )

            return file_info

        except Exception as e:
            raise e
