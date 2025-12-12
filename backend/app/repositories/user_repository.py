from typing import Optional
from app.models.user import User
from app import db
from app.models.db_transaction import execute_in_transaction


class UserRepository:

    @staticmethod
    def get_primary_user():
        return User.query.filter(User.role == "primary").first()

    @staticmethod
    def get_user_by_id(user_id: str) -> User | None:
        return User.query.filter_by(id=user_id).first()

    @staticmethod
    def delete_user_by_id(user_id: str):
        return User.query.filter_by(id=user_id).delete()

    @staticmethod
    def get_child_users_by_id(user_id: str) -> list[User] | None:
        return User.query.filter_by(parent_id=user_id).all()

    @staticmethod
    @execute_in_transaction
    def add_user(data: dict):
        user = User(**data)
        db.session.add(user)
        return user

    @staticmethod
    @execute_in_transaction
    def update_user(user_id: str, data: dict):
        return User.query.filter_by(id=user_id).update(data)

    @staticmethod
    @execute_in_transaction
    def delete_user(user_id: str):
        return User.query.filter_by(id=user_id).delete()

    @staticmethod
    @execute_in_transaction
    def set_password(user_id: str, password: str):
        pass

    @staticmethod
    def user_exists(
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
        query = db.session.query(User)
        conditions = []
        if user_id:
            conditions.append(User.id == user_id)
        if email:
            conditions.append(User.email == email)
        if phone:
            conditions.append(User.phone == phone)

        # 如果有任何条件，使用 OR 连接
        if conditions:
            query = query.filter(db.or_(*conditions))

        # 使用 exists() 更高效
        return db.session.query(query.exists()).scalar()
