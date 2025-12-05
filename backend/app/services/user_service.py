from app.repositories.user_repository import UserRepository


class UserService:
    def add_subaccount(self, user_id, data: dict):
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
            raise Exception("User not found")
        # 检查用户是否有权限添加子账户（只有主账户可以添加）
        if user.role != "primary":
            raise Exception("Only primary users can add subaccounts")
        # 检查要添加的用户是否已经存在
        if UserRepository.user_exists(email=data["email"]):
            raise Exception("No Permission")
        data["parent_id"] = user_id
        return UserRepository.add_user(data=data).to_dict()

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
            raise Exception("User not found")
        if user.role != "primary":
            raise Exception("No Permission")
        subaccounts = UserRepository.get_child_users_by_id(user_id=user_id)
        return [subaccount.to_dict() for subaccount in subaccounts]

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
            raise Exception("User not found")
        if user.role != "primary":
            raise Exception("No Permission")
        # 验证子账户是否存在及归属关系
        subaccount = UserRepository.get_user_by_id(user_id=subaccount_id)
        if not subaccount:
            raise Exception("Subaccount not found")
        if subaccount.parent_id != user_id:
            raise Exception("No Permission")
        # 执行删除操作
        UserRepository.delete_user(user_id=subaccount_id)
