from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import joinedload
from app.models.character import Character


class CharacterRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化CharacterRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def get_characters(self, user_id: Optional[str | list[str]] = None):
        if isinstance(user_id, str):
            stmt = select(Character).filter(Character.user_id == user_id)
            result = await self.session.execute(stmt)
            characters = result.scalars().all()
        elif isinstance(user_id, list):
            stmt = (
                select(Character)
                .filter(Character.user_id.in_(user_id))
                .filter(Character.is_public == True)
            )
            result = await self.session.execute(stmt)
            characters = result.scalars().all()
        else:
            stmt = select(Character)
            result = await self.session.execute(stmt)
            characters = result.scalars().all()
        return characters

    async def create_character(self, user_id: str, data: dict):
        character = Character(
            **data,
            user_id=user_id,
        )

        self.session.add(character)
        await self.session.flush()
        return await self.get_character_by_id(character.id, with_model=True)

    async def update_character(self, id, data: dict):
        stmt = select(Character).filter(Character.id == id)
        result = await self.session.execute(stmt)
        character = result.scalar_one_or_none()

        if character:
            for key, value in data.items():
                setattr(character, key, value)
            return character
        return None

    async def delete_character(self, id):
        stmt = delete(Character).where(Character.id == id)
        result = await self.session.execute(stmt)
        return result.rowcount

    async def get_character_by_id(
        self, id, user_id: Optional[str] = None, with_model: bool = True
    ):
        stmt = select(Character).filter(Character.id == id)
        if user_id:
            stmt = stmt.filter(Character.user_id == user_id)
        if with_model:
            stmt = stmt.options(joinedload(Character.model))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()