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
        results = [character.to_dict() for character in characters]

        return results

    def add_new_character(self, data: dict):
        fields = [
            "title",
            "description",
            "avatar_url",
            "settings",
        ]
        extended_fields = [
            "assistant_name",
            "assistant_identity",
            "system_prompt",
            "memory_type",
            "max_memory_length",
            "short_term_memory_length",
        ]

        data_filtered = {
            field: data.get(field) for field in fields if data.get(field) is not None
        }

        settings = (
            {
                key: value
                for key, value in data.get("settings").items()
                if key in extended_fields
            }
            if data.get("settings")
            else {}
        )

        data_filtered["settings"] = settings

        # 创建字符对象
        character = Character(
            **data_filtered,
        )

        self.db_session.add(character)
        self.db_session.commit()

        # 返回完整数据
        return character.to_dict()

    def update_character(self, id, data: dict):

        fields = [
            "title",
            "description",
            "avatar_url",
            "user_id",
        ]

        extended_fields = [
            "assistant_name",
            "assistant_identity",
            "system_prompt",
            "memory_type",
            "max_memory_length",
            "short_term_memory_length",
        ]

        data_filtered = {}
        # 处理基础字段
        for field in fields:
            if field in data:
                data_filtered[field] = data[field]

        # 处理settings字段
        if "settings" in data:
            settings = {}
            for field in extended_fields:
                if field in data["settings"]:
                    settings[field] = data["settings"][field]
            data_filtered["settings"] = settings

        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            for key, value in data_filtered.items():
                if hasattr(character, key):
                    setattr(character, key, value)
            self.db_session.commit()
            return character.to_dict()
        raise ValueError(f"Character with ID {id} does not exist.")

    def delete_character(self, id):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            self.db_session.delete(character)
            self.db_session.commit()

    def get_character_by_id(self, id):
        character = self.db_session.query(Character).filter(Character.id == id).first()
        if character:
            return character.to_dict()
        return None


_character_service = _CharacterService()


def get_character_service() -> _CharacterService:
    return _character_service
