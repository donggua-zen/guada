from app.models.user import User


class UserRepository:
    @staticmethod
    def get_user_by_id(user_id: str):
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return None
        return user.to_dict()

    @staticmethod
    def get_child_users_by_id(user_id: str):
        users = User.query.filter_by(parent_id=user_id).all()
        return [user.to_dict() for user in users]
