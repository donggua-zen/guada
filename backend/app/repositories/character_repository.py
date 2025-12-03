import os
from pathlib import Path
from typing import Optional, Union
import ulid

from app.models import db, Character
from app.models.db_transaction import smart_transaction_manager


class CharacterRepository:

    @staticmethod
    def get_characters(user_id: Optional[str | list[str]] = None):
        if isinstance(user_id, str):
            characters = (
                db.session.query(Character).filter(Character.user_id == user_id).all()
            )
        elif isinstance(user_id, list):
            characters = (
                db.session.query(Character)
                .filter(Character.user_id.in_(user_id))
                .filter(Character.is_public == True)
                .all()
            )
        else:
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
    def get_character_by_id(id, user_id: Optional[str] = None):
        query = db.session.query(Character).filter(Character.id == id)
        if user_id:
            query = query.filter(Character.user_id == user_id)
        character = query.first()
        if character:
            return character.to_dict()
        return None
