import os
from pathlib import Path
import ulid

from app.models import db, Character
from app.models.db_transaction import smart_transaction_manager


class CharacterService:
    def __init__(self):
        pass

    def __del__(self):
        pass

    def get_all_characters(self):
        characters = db.session.query(Character).all()
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
            "model_top_p",
            "model_temperature",
            "model_id",
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

        with smart_transaction_manager.transaction():
            character = Character(
                **data_filtered,
            )

            db.session.add(character)

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
            "model_top_p",
            "model_temperature",
            "model_id",
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

        character = db.session.query(Character).filter(Character.id == id).first()
        if character:
            with smart_transaction_manager.transaction():
                for key, value in data_filtered.items():
                    if hasattr(character, key):
                        setattr(character, key, value)
            return character.to_dict()
        raise ValueError(f"Character with ID {id} does not exist.")

    def delete_character(self, id):
        character = db.session.query(Character).filter(Character.id == id).first()
        if character:
            with smart_transaction_manager.transaction():
                db.session.delete(character)

    def get_character_by_id(self, id):
        character = db.session.query(Character).filter(Character.id == id).first()
        if character:
            return character.to_dict()
        return None
