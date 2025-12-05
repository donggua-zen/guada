from app.models import db, Message
from app.models.db_transaction import execute_in_transaction
from app.models.message_content import MessageContent


class MessageContentRepository:

    @staticmethod
    @execute_in_transaction
    def add_content(
        message_id: str,
        content: str,
        reasoning_content: str = None,
        meta_data: dict = None,
        set_current: bool = True,
    ):

        if set_current:
            # 批量更新：将该消息的所有内容 is_current 设为 False
            db.session.query(MessageContent).filter(
                MessageContent.message_id == message_id,
                MessageContent.is_current == True,
            ).update({"is_current": False})

        message_conetnt = MessageContent(
            message_id=message_id,
            content=content,
            reasoning_content=reasoning_content,
            meta_data=meta_data,
            is_current=set_current,
        )

        db.session.add(message_conetnt)
        return message_conetnt

    @staticmethod
    @execute_in_transaction
    def delete_conent(id: str):
        return db.session.query(MessageContent).filter(MessageContent.id == id).delete()

    @staticmethod
    def get_content(id: str):
        message_content = (
            db.session.query(MessageContent)
            .filter(
                MessageContent.id == id,
            )
            .first()
        )

        if message_content is None:
            return None
        return message_content
