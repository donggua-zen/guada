from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete
from app.models.user import User


class UserRepository:

    def __init__(self, session: AsyncSession):
        """
        初始化UserRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def get_primary_user(self):
        stmt = select(User).filter(User.role == "primary")
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: str) -> User | None:
        stmt = select(User).filter_by(id=user_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_by_phone(self, phone: str) -> User | None:
        stmt = select(User).filter_by(phone=phone)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_by_email(self, email: str) -> User | None:
        stmt = select(User).filter_by(email=email)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete_user_by_id(self, user_id: str):
        stmt = delete(User).where(User.id == user_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def get_child_users_by_id(self, user_id: str) -> list[User] | None:
        stmt = select(User).filter_by(parent_id=user_id)
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def add_user(self, data: dict):
        user = User(**data)
        self.session.add(user)
        await self.session.flush()
        return await self.get_user_by_id(user.id)

    async def update_user(self, user_id: str, data: dict):
        stmt = select(User).filter_by(id=user_id)
        result = await self.session.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            for key, value in data.items():
                setattr(user, key, value)
            await self.session.flush()
            return await self.get_user_by_id(user.id)
        return None

    async def delete_user(self, user_id: str):
        stmt = delete(User).where(User.id == user_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def set_password(self, user_id: str, password: str):
        stmt = select(User).filter_by(id=user_id)
        result = await self.session.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            user.set_password(password)  # 假设User模型有set_password方法
            return True
        return False

    async def user_exists(
        self,
        user_id: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> bool:
        """
        检查用户是否存在

        Args:
            user_id (Optional[str]): 用户ID
            email (Optional[str]): 用户邮箱
            phone (Optional[str]): 用户手机号

        Returns:
            bool: 用户存在返回True，否则返回False
        """
        stmt = select(User)
        conditions = []
        if user_id:
            conditions.append(User.id == user_id)
        if email:
            conditions.append(User.email == email)
        if phone:
            conditions.append(User.phone == phone)

        # 如果有任何条件，使用 OR 连接
        if conditions:
            stmt = stmt.filter(or_(*conditions))

        # 使用 exists() 更高效
        exists_stmt = select(stmt.exists())
        result = await self.session.execute(exists_stmt)
        return result.scalar()