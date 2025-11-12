import os
from pathlib import Path
import ulid

from app.models import db, Character
from app.models.db_transaction import smart_transaction_manager


class CharacterRepository:

    @staticmethod
    def get_all_characters():
        characters = db.session.query(Character).all()
        results = [character.to_dict() for character in characters]

        return results

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def create_character(data: dict):

        character = Character(
            **data,
        )

        db.session.add(character)

        # 返回完整数据
        return character.to_dict(flush=True)

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def update_character(id, data: dict):
        return db.session.query(Character).filter(Character.id == id).update(data)

    @staticmethod
    @smart_transaction_manager.execute_in_transaction
    def delete_character(id):
        character = db.session.query(Character).filter(Character.id == id).first()
        if character:
            db.session.delete(character)

    @staticmethod
    def get_character_by_id(id):
        character = db.session.query(Character).filter(Character.id == id).first()
        if character:
            return character.to_dict()
        return None
