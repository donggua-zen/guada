import os
from pathlib import Path
import ulid

from models import Character, SessionLocal


class _CharacterService:
    def __init__(self):
        self.db_session = SessionLocal()

    def __del__(self):
        self.db_session.close()

    def get_all_characters(self):
        characters = self.db_session.query(Character).all()
        results = [
            {
                "id": character.id,
                "name": character.name,
                "title": character.title,
                "description": character.description,
                "avatar_url": character.avatar_url,
                "identity": character.identity,
                "detailed_setting": character.detailed_setting,
                "user_id": character.user_id,
                "created_at": character.created_at,
                "updated_at": character.updated_at,
            }
            for character in characters
        ]

        return results

    def add_new_character(self, data: dict):
        # 分离固定字段和动态数据
        fixed_fields = {
            "name": data.get("name", ""),
            "identity": data.get("identity", ""),
            "avatar_url": data.get("avatar_url", ""),
            "detailed_setting": data.get("detailed_setting", ""),
            "user_id": data.get("user_id", "123"),
        }

        # 创建字符对象
        character = Character(
            **fixed_fields,
        )

        self.db_session.add(character)
        self.db_session.commit()

        # 返回完整数据
        return {
            **fixed_fields,
        }

    def update_character(self, id, new_data):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            # 更新固定字段
            if "name" in new_data:
                character.name = new_data.get("name")
            if "identity" in new_data:
                character.identity = new_data.get("identity")
            if "avatar_url" in new_data:
                character.avatar_url = new_data.get("avatar_url")
            if "user_id" in new_data:
                character.user_id = new_data.get("user_id")
            if "detailed_setting" in new_data:
                character.detailed_setting = new_data.get("detailed_setting")

            self.db_session.commit()

    def delete_character(self, id):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            self.db_session.delete(character)
            self.db_session.commit()

    def get_character_by_id(self, id):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            return {
                "id": character.id,
                "title": character.title,
                "name": character.name,
                "identity": character.identity,
                "avatar_url": character.avatar_url,
                "user_id": character.user_id,
                "detailed_setting": character.detailed_setting,
            }
        return None


_character_service = _CharacterService()


def get_character_service() -> _CharacterService:
    return _character_service
