import os
import ulid
from pathlib import Path
from tinydb import TinyDB, Query


class _MessageService:
    def __init__(self):
        self.db = TinyDB("./data/messages.json")

    def get_messages(
        self,
        session_id,
        start_message_id=None,
        tail_message_id=None,
        last_n_messages=None,
    ):
        condition = Query().session_id == session_id

        if start_message_id is not None:
            condition &= Query().id >= start_message_id

        if tail_message_id is not None:
            condition &= Query().id <= tail_message_id

        messages = self.db.search(condition)

        if last_n_messages is not None:
            messages = messages[-last_n_messages:]

        return messages

    def get_message(self, message_id):
        return self.db.get(Query().id == message_id)

    def add_message(self, session_id, role, content, reasoning_content=None):
        message_id = ulid.new().str
        message = {
            "id": message_id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "reasoning_content": reasoning_content,
        }
        self.db.insert(message)
        return message

    def update_message(self, message_id, data):
        self.db.update(data, Query().id == message_id)

    def delete_message(self, message_id):
        self.db.remove(Query().id == message_id)

    def delete_messages_by_session_id(self, session_id):
        self.db.remove(Query().session_id == session_id)


_message_service = _MessageService()


def get_message_service() -> _MessageService:
    return _message_service
