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
        fields = [
            "title",
            "description",
            "name",
            "identity",
            "avatar_url",
            "detailed_setting",
        ]
        data_filtered = {
            field: data.get(field) for field in fields if data.get(field) is not None
        }

        # 创建字符对象
        character = Character(
            **data_filtered,
        )

        self.db_session.add(character)
        self.db_session.commit()

        # 返回完整数据
        return {
            "id": character.id,
            **data_filtered,
        }

    def update_character(self, id, new_data):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            fields = [
                "title",
                "description",
                "name",
                "identity",
                "avatar_url",
                "user_id",
                "detailed_setting",
            ]

            for key, value in new_data.items():
                if hasattr(character, key) and key in fields:
                    setattr(character, key, value)
            self.db_session.commit()

    def delete_character(self, id):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            self.db_session.delete(character)
            self.db_session.commit()

    def get_character_by_id(self, id):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        fields = [
            "id",
            "title",
            "description",
            "name",
            "identity",
            "avatar_url",
            "user_id",
            "detailed_setting",
        ]
        if character:
            return {key: getattr(character, key) for key in fields}
        return None


_character_service = _CharacterService()


def get_character_service() -> _CharacterService:
    return _character_service
