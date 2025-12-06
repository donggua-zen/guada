# auth.py
from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from app.exceptions import (
    AuthenticationError,
    NotFoundError,
    ParameterError,
    PerssionDeniedError,
)
from app.models.database import db
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.services.user_service import UserService
from app.utils.decorators import handle_response
from app.models.db_transaction import smart_transaction

users_bp = Blueprint("users", __name__)

user_service = UserService()


@users_bp.route("/api/v1/auth/register", methods=["POST"])
@handle_response
def register():
    data = request.get_json()

    if User.query.filter_by(username=data["username"]).first():
        raise Exception("用户名已存在")

    if User.query.filter_by(email=data["email"]).first():
        raise Exception("邮箱已存在")

    user = User(username=data["username"], email=data["email"])
    user.set_password(data["password"])

    db.session.add(user)
    db.session.commit()

    access_token = create_access_token(identity=user.id)

    return {
        "message": "用户注册成功",
        "access_token": access_token,
        "user": user.to_dict(),
    }


@users_bp.route("/api/v1/auth/login", methods=["POST"])
@handle_response
def login():
    data = request.get_json()
    type = data.get("type")
    phone = None
    email = None
    password = None

    if type == "phone":
        phone = data.get("phone")
        password = data.get("password")
        if not phone or not password:
            raise ParameterError("请填写手机号码和密码")
    elif type == "email":
        email = data.get("email")
        password = data.get("password")
        if not email or not password:
            raise ParameterError("请填写邮箱和密码")
    else:
        raise ParameterError("请选择正确的登录方式")

    user = (
        User.query.filter_by(phone=data["phone"]).first()
        if type == "phone"
        else User.query.filter_by(email=data["email"]).first()
    )

    if user and user.check_password(data["password"]):
        access_token = create_access_token(identity=user.id)
        return {
            "access_token": access_token,
            "user": user.to_dict(),
        }

    raise AuthenticationError("用户名或密码错误")


@users_bp.route("/api/v1/user/profile", methods=["GET"])
@jwt_required()
@handle_response
def get_profile():
    user_id = get_jwt_identity()
    user = UserRepository.get_user_by_id(user_id=user_id)
    return user.to_dict()


@users_bp.route("/api/v1/user/profile", methods=["PUT"])
@jwt_required()
@handle_response
def update_profile():
    user_id = get_jwt_identity()
    data = request.get_json()
    UserRepository.update_user(user_id, data)


@users_bp.route("/api/v1/user/password", methods=["PUT"])
@jwt_required()
@handle_response
def update_password():
    user_id = get_jwt_identity()
    data = request.get_json()
    old_password = data.get("old_password")
    new_password = data.get("new_password")
    if not old_password or not new_password:
        raise ParameterError("请填写旧密码和新密码")
    return user_service.update_password(user_id, old_password, new_password)


@users_bp.route("/api/v1/subaccounts", methods=["POST"])
@jwt_required()
@handle_response
def create_subaccount():
    user_id = get_jwt_identity()
    data = request.get_json()
    account = user_service.create_subaccount(user_id, data)
    return account


@users_bp.route("/api/v1/subaccounts", methods=["GET"])
@jwt_required()
@handle_response
def get_subaccounts():
    user_id = get_jwt_identity()
    accounts = user_service.get_subaccounts(user_id)
    return accounts


@users_bp.route("/api/v1/subaccounts/<account_id>", methods=["DELETE"])
@jwt_required()
@handle_response
def delete_subaccount(account_id):
    user_id = get_jwt_identity()
    subaccount = UserRepository.get_user_by_id(user_id=account_id)
    if subaccount.role != "subaccount" or subaccount.parent_id != user_id:
        raise PerssionDeniedError("该用户不是子账户")
    user_service.delete_subaccount(user_id, account_id)


@users_bp.route("/api/v1/subaccounts/<account_id>", methods=["PUT"])
@jwt_required()
@handle_response
def update_subaccount(account_id):
    with smart_transaction():
        user_id = get_jwt_identity()
        subaccount = UserRepository.get_user_by_id(account_id)
        data = request.get_json()
        if not subaccount or subaccount.role != "subaccount":
            raise NotFoundError("该用户不存在")
        if user_id != account_id and user_id != subaccount.parent_id:
            raise PerssionDeniedError("无权限")

        fields = ["nickname", "email", "phone"]
        for field in fields:
            if field in data:
                setattr(subaccount, field, data[field])
        if user_id != account_id:
            if "password" in data:
                subaccount.set_password(data["password"])


# 上传头像
@users_bp.route("/api/v1/user/avatars", methods=["POST"])
@jwt_required()
@handle_response
def upload_avatar():
    user_id = get_jwt_identity()
    return user_service.upload_avatar(
        user_id=user_id, avatar_file=request.files["avatar"]
    )
