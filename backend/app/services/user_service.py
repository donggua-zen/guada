from typing import Optional
from app.exceptions import NotFoundError, PerssionDeniedError, ValidationError
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.models.db_transaction import smart_transaction
from app.services.upload_service import UploadService
from app.utils import convert_webpath_to_filepath, remove_file


class UserService:
    def create_subaccount(self, user_id, data: dict):
        """
        为主账户添加子账户

        Args:
            user_id: 主账户的用户ID
            data: 包含子账户信息的字典，必须包含email等字段

        Returns:
            新创建的子账户用户对象

        Raises:
            Exception: 当用户不存在、不是主账户或子账户邮箱已存在时抛出异常
        """
        user = UserRepository.get_user_by_id(user_id=user_id)
        # 检查用户是否存在
        if not user:
            raise NotFoundError("User not found")
        # 检查用户是否有权限添加子账户（只有主账户可以添加）
        if user.role != "primary":
            raise PerssionDeniedError("Only primary users can add subaccounts")
        # 检查要添加的用户是否已经存在
        if UserRepository.user_exists(email=data["email"]):
            raise ValidationError("账户已存在")
        data["parent_id"] = user_id
        data["role"] = "subaccount"
        data["password_hash"] = ""
        password = data.pop("password")
        with smart_transaction():
            user = UserRepository.add_user(data=data)
            if password:  # 如果有密码，则设置密码
                user.set_password(password)
        return user.to_dict()

    def get_subaccounts(self, user_id):
        """
        获取指定用户的所有子账户

        Args:
            user_id: 用户的ID
            Returns:
                包含所有子账户的用户对象列表

            Raises:
                Exception: 当用户不存在或没有子账户时抛出异常
        """
        user = UserRepository.get_user_by_id(user_id=user_id)
        if not user:
            raise NotFoundError("User not found")
        if user.role != "primary":
            raise PerssionDeniedError("No Permission")
        subaccounts = UserRepository.get_child_users_by_id(user_id=user_id)
        return {"items": [subaccount.to_dict() for subaccount in subaccounts]}

    def delete_subaccount(self, user_id, subaccount_id):
        """
        删除指定的子账户

        Args:
            user_id: 主账户用户ID
            subaccount_id: 要删除的子账户ID

        Raises:
            Exception: 当用户不存在、没有权限或子账户不存在时抛出异常
        """
        # 验证主账户权限
        user = UserRepository.get_user_by_id(user_id=user_id)
        if not user:
            raise NotFoundError("User not found")
        if user.role != "primary":
            raise PerssionDeniedError("No Permission")
        # 验证子账户是否存在及归属关系
        subaccount = UserRepository.get_user_by_id(user_id=subaccount_id)
        if not subaccount:
            raise NotFoundError("Subaccount not found")
        if subaccount.parent_id != user_id:
            raise PerssionDeniedError("No Permission")
        # 执行删除操作
        UserRepository.delete_user(user_id=subaccount_id)

    def update_password(self, user_id, old_password, new_password):
        """
        更新用户的密码

        Args:
            user_id: 用户ID
            old_password: 旧密码
            new_password: 新密码

            Raises:
                Exception: 当用户不存在、密码错误或更新失败时抛出异常
        """

        user = UserRepository.get_user_by_id(user_id=user_id)
        if not user:
            raise NotFoundError("User not found")
        if not user.check_password(old_password):
            raise ValidationError("Password error")
        user.set_password(new_password)
        return {}

    def upload_avatar(self, user_id: str, avatar_file):
        user = UserRepository.get_user_by_id(user_id=user_id)
        if not user:
            raise NotFoundError("User not found")
        upload_service = UploadService()
        avatar_url = upload_service.upload_avatar(avatar_file, size=(128, 128))
        if user.avatar_url:
            old_avatar_path = convert_webpath_to_filepath(user.avatar_url)
            if old_avatar_path:
                remove_file(old_avatar_path)
        UserRepository.update_user(user_id=user_id, data={"avatar_url": avatar_url})
        return {"url": avatar_url}

    def reset_primary_password(
        self,
        password,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ):
        """
        重置主账户密码

        Args:
            password: 新密码
            email: 可选，主账户邮箱
            phone: 可选，主账户手机号

        Raises:
            ValidationError: 当既没有提供邮箱也没有提供手机号时抛出异常
        """
        if not email and not phone:
            raise ValidationError("Email or phone number is required")
        with smart_transaction():
            user = UserRepository.get_primary_user()
            if not user:
                user = User()
            if email:
                user.email = email
            if phone:
                user.phone = phone
            user.set_password(password)
