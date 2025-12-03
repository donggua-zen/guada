import os
from typing import Optional

from app.repositories.character_repository import CharacterRepository as CharacterRepo
from app.repositories.user_repository import UserRepository
from app.services.upload_service import UploadService
from app.utils import convert_webpath_to_filepath, remove_file


class CharacterService:
    def __init__(self):
        # 初始化UploadService实例，避免重复创建
        self.upload_service = UploadService()
        pass

    def __del__(self):
        pass

    def get_characters(self, user_id: Optional[str | list[list]] = None):
        return CharacterRepo.get_characters(user_id=user_id)

    def get_shared_characters(self, user_id: str):
        user = UserRepository.get_user_by_id(user_id)
        parent_id = user_id
        if user["role"] == "child" and user["parent_id"] is None:
            parent_id = user["parent_id"]
        child_users = UserRepository.get_child_users_by_id(user_id=parent_id)
        user_ids = [parent_id] + [user["id"] for user in child_users]
        return CharacterRepo.get_characters(user_id=user_ids)

    def create_character(self, data: dict):
        fields = [
            "title",
            "description",
            "avatar_url",
            "settings",
            "model_id",
            "settings",
        ]

        data_filtered = {
            field: data.get(field) for field in fields if data.get(field) is not None
        }

        # 创建字符对象

        character = CharacterRepo.create_character(data_filtered)

        # 返回完整数据
        return character

    def update_character(self, id, user_id: str, data: dict):

        fields = [
            "title",
            "description",
            "avatar_url",
            "model_id",
            "settings",
            "is_public",
        ]

        data_filtered = {}
        # 处理基础字段
        for field in fields:
            if field in data:
                data_filtered[field] = data[field]

        character = self.get_character_by_id(id, user_id=user_id)
        if not character:
            raise ValueError(f"Character with ID {id} does not exist.")

        CharacterRepo.update_character(id, data_filtered)
        if (
            "avatar_url" in data_filtered
            and data["avatar_url"] != character["avatar_url"]
        ):
            old_avatar_path = convert_webpath_to_filepath(character["avatar_url"])
            if old_avatar_path:
                remove_file(old_avatar_path)
        character.update(data_filtered)
        return character

    def delete_character(self, id, user_id: str):
        character = CharacterRepo.get_character_by_id(id, user_id=user_id)
        if character:
            CharacterRepo.delete_character(id)
            avatar_url = character.get("avatar_url")
            if avatar_url and avatar_url.startswith("/static/avatars/character-"):
                os.remove(convert_webpath_to_filepath(avatar_url))

    def get_character_by_id(self, id, user_id: str = None):
        character = CharacterRepo.get_character_by_id(id, user_id=user_id)
        if character:
            return character
        raise ValueError(f"Character with ID {id} does not exist.")

    def upload_avatar(self, character_id, user_id: str, avatar_file):
        character = self.get_character_by_id(character_id)
        # 使用实例变量避免重复创建
        avatar_url = self.upload_service.upload_avatar(avatar_file, size=(128, 128))
        self.update_character(
            character_id, user_id=user_id, data={"avatar_url": avatar_url}
        )
        return {"url": avatar_url}
