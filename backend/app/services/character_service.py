import os
from typing import Optional

from app.models.user import User
from app.exceptions import APIException
from app.repositories.character_repository import CharacterRepository as CharacterRepo
from app.repositories.user_repository import UserRepository
from app.services.upload_service import UploadService
from app.utils import convert_webpath_to_filepath, remove_file
from app.schemas.common import PaginatedResponse
from app.schemas.character import CharacterOut

# from app.models.db_transaction import get_transaction_manager


class CharacterService:
    def __init__(self, character_repo: CharacterRepo, user_repo: UserRepository):
        # 初始化UploadService实例，避免重复创建
        self.upload_service = UploadService()
        self.character_repo = character_repo
        self.user_repo = user_repo

    def __del__(self):
        pass

    async def get_characters(self, user_id: Optional[str | list[list]] = None):
        characters = await self.character_repo.get_characters(user_id=user_id)
        return PaginatedResponse(items=characters, size=len(characters))

    async def get_shared_characters(self, user: User):
        parent_id = user.id
        if user.role != "primary" and user.parent_id is not None:
            parent_id = user.parent_id
        child_users = await self.user_repo.get_child_users_by_id(user_id=parent_id)
        user_ids = [parent_id] + [user.id for user in child_users]
        characters = await self.character_repo.get_characters(user_id=user_ids)
        return PaginatedResponse(items=characters, size=len(characters))

    async def create_character(self, user: User, data: dict):

        # 创建角色对象
        character = await self.character_repo.create_character(
            user_id=user.id, data=data
        )

        # 返回完整数据
        return character

    async def update_character(self, id, user: User, data: dict):

        character = await self.character_repo.get_character_by_id(id, user_id=user.id)
        if not character:
            raise APIException("Character not found", 404)
        character.update(data)

        if "avatar_url" in data and data["avatar_url"] != character.avatar_url:
            old_avatar_path = convert_webpath_to_filepath(character.avatar_url)
            if old_avatar_path:
                remove_file(old_avatar_path)

        return character

    async def delete_character(self, id, user: User):
        character = await self.character_repo.get_character_by_id(id, user_id=user.id)
        if character:
            await self.character_repo.delete_character(id)
            avatar_url = character.avatar_url
            if avatar_url and avatar_url.startswith("/static/avatars/character-"):
                os.remove(convert_webpath_to_filepath(avatar_url))

    async def get_character_by_id(self, id, user: User = None):
        character = await self.character_repo.get_character_by_id(
            id, user_id=user.id if user else None
        )
        if character:
            return character
        raise APIException("Character not found", status_code=404)

    async def upload_avatar(self, character_id, user: User, avatar_file):
        character = await self.character_repo.get_character_by_id(
            character_id, user_id=user.id
        )
        if not character:
            raise APIException("Character not found", status_code=404)
        # 使用实例变量避免重复创建
        avatar_url = self.upload_service.upload_avatar(avatar_file, size=(128, 128))
        return await self.update_character(
            character_id, user=user, data={"avatar_url": avatar_url}
        )
