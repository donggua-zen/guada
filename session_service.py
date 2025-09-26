from openai import OpenAI, APIError
import os
from tinydb import TinyDB, Query
import ulid


# 对话管理类
class _SessionService:
    def __init__(self):
        self.db = TinyDB("./data/sessions.json")
        pass

    def create_or_resume_session(self, user_id: str, character_id: str):
        """
        创建新会话或恢复现有会话

        :param user_id: 用户ID
        :param character_id: 角色ID
        :return: 会话对象，如果不存在则创建新的会话并返回，否则返回已存在的会话
        """
        # 查询用户和角色对应的会话
        session = self.query_session(user_id=user_id, character_id=character_id)
        # 如果会话不存在，则创建新的会话；否则返回已存在的会话
        if len(session) == 0:
            return self.add_new_session(user_id, character_id)
        else:
            return session[0]

    def get_all_sessions(self):
        return self.db.all()

    def add_new_session(self, user_id, character_id):
        id = ulid.new().str
        data = {
            "id": id,
            "user_id": user_id,
            "character_id": character_id,
        }
        self.db.insert(data)
        return data

    def update_session(self, session_id, new_data):
        self.db.update(new_data, Query().id == session_id)

    def query_session(self, session_id=None, user_id=None, character_id=None):
        sessionQuery = Query()
        query_conditions = []

        if session_id is not None:
            query_conditions.append(sessionQuery.id == session_id)
        if user_id is not None:
            query_conditions.append(sessionQuery.user_id == user_id)
        if character_id is not None:
            query_conditions.append(sessionQuery.character_id == character_id)

        if not query_conditions:
            return []

        combined_query = query_conditions[0]
        for condition in query_conditions[1:]:
            combined_query &= condition

        return self.db.search(combined_query)

    def delete_session(self, session_id):
        self.db.remove(Query().id == session_id)


_session_service = _SessionService()


def get_session_service() -> _SessionService:
    return _session_service
