from app.models.file import File as FileModel
from app.models.db_transaction import smart_transaction_manager
from app.models.database import db


class FileRepository:

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def add_file(
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
        filemodel = FileModel(
            content=file_content,
            file_name=file_name,
            file_extension=file_ext,
            display_name=display_name,
            file_type=file_type,
            file_size=file_size,
            session_id=session_id,
            message_id=message_id,
            content_hash=content_hash,
        )
        db.session.add(filemodel)
        return filemodel.to_dict(flush=True)

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_file(file_id: int):
        file = db.session.query(FileModel).filter(FileModel.id == file_id).first()
        if not file:
            return False
        db.session.delete(file)
        return True
