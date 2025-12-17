import os
from typing import Optional

from app.exceptions import APIException
from app.repositories.character_repository import CharacterRepository as CharacterRepo
from app.repositories.user_repository import UserRepository
from app.services.upload_service import UploadService
from app.utils import convert_webpath_to_filepath, remove_file
from app.models.db_transaction import smart_transaction


class CharacterService:
    def __init__(self):
        # 初始化UploadService实例，避免重复创建
        self.upload_service = UploadService()
        pass

    def __del__(self):
        pass

    def get_characters(self, user_id: Optional[str | list[list]] = None):
        characters = CharacterRepo.get_characters(user_id=user_id)
        return [character.to_dict() for character in characters]

    def get_shared_characters(self, user_id: str):
        user = UserRepository.get_user_by_id(user_id)
        parent_id = user_id
        if user.role != "primary" and user.parent_id is not None:
            parent_id = user.parent_id
        child_users = UserRepository.get_child_users_by_id(user_id=parent_id)
        user_ids = [parent_id] + [user.id for user in child_users]
        characters = CharacterRepo.get_characters(user_id=user_ids)
        return [character.to_dict() for character in characters]

    def create_character(self, user_id: str, data: dict):

        # 创建字符对象

        character = CharacterRepo.create_character(user_id=user_id, data=data)

        # 返回完整数据
        return character.to_dict()

    def update_character(self, id, user_id: str, data: dict):

        with smart_transaction():
            character = CharacterRepo.get_character_by_id(id, user_id=user_id)
            if not character:
                raise APIException("Character not found", 404)
            character.update(data)

        if "avatar_url" in data and data["avatar_url"] != character.avatar_url:
            old_avatar_path = convert_webpath_to_filepath(character.avatar_url)
            if old_avatar_path:
                remove_file(old_avatar_path)

        return character.to_dict()

    def delete_character(self, id, user_id: str):
        character = CharacterRepo.get_character_by_id(id, user_id=user_id)
        if character:
            CharacterRepo.delete_character(id)
            avatar_url = character.avatar_url
            if avatar_url and avatar_url.startswith("/static/avatars/character-"):
                os.remove(convert_webpath_to_filepath(avatar_url))

    def get_character_by_id(self, id, user_id: str = None):
        character = CharacterRepo.get_character_by_id(id, user_id=user_id)
        if character:
            return character.to_dict()
        raise APIException("Character not found", status_code=404)

    def upload_avatar(self, character_id, user_id: str, avatar_file):
        character = self.get_character_by_id(character_id)
        # 使用实例变量避免重复创建
        avatar_url = self.upload_service.upload_avatar(avatar_file, size=(128, 128))
        self.update_character(
            character_id, user_id=user_id, data={"avatar_url": avatar_url}
        )
        return {"url": avatar_url}
