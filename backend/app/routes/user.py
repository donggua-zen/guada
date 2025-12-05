# auth.py
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from app.models.database import db
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.services.user_service import UserService
from app.utils.decorators import handle_exceptions
from app.models.db_transaction import smart_transaction

user_bp = Blueprint("user", __name__)

user_service = UserService()


@user_bp.route("/api/v1/auth/register", methods=["POST"])
@handle_exceptions
def register():
    data = request.get_json()

    if User.query.filter_by(username=data["username"]).first():
        return jsonify({"error": "用户名已存在"}), 400

    if User.query.filter_by(email=data["email"]).first():
        return jsonify({"error": "邮箱已存在"}), 400

    user = User(username=data["username"], email=data["email"])
    user.set_password(data["password"])

    db.session.add(user)
    db.session.commit()

    access_token = create_access_token(identity=user.id)

    return (
        jsonify(
            {
                "message": "用户注册成功",
                "access_token": access_token,
                "user": user.to_dict(),
            }
        ),
        201,
    )


@user_bp.route("/api/v1/auth/login", methods=["POST"])
@handle_exceptions
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
            return jsonify({"success": False, "error": "请填写手机号码和密码"}), 400
    elif type == "email":
        email = data.get("email")
        password = data.get("password")
        if not email or not password:
            return jsonify({"success": False, "error": "请填写邮箱和密码"}), 400
    else:
        return jsonify({"success": False, "error": "请选择正确的登录方式"}), 400

    user = (
        User.query.filter_by(phone=data["phone"]).first()
        if type == "phone"
        else User.query.filter_by(email=data["email"]).first()
    )

    if user and user.check_password(data["password"]):
        access_token = create_access_token(identity=user.id)
        return jsonify(
            {
                "success": True,
                "data": {
                    "access_token": access_token,
                    "user": user.to_dict(),
                },
            }
        )

    return jsonify({"error": "用户名或密码错误"}), 401


@user_bp.route("/api/v1/user/profile", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_profile():
    user_id = get_jwt_identity()
    user = User.query.filter_by(id=user_id).first()
    return jsonify({"success": True, "data": user.to_dict()})


@user_bp.route("/api/v1/user/profile", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_profile():
    user_id = get_jwt_identity()
    data = request.get_json()
    UserRepository.update_user(user_id, data)
    return jsonify({"success": True})


@user_bp.route("/api/v1/user/password", methods=["PUT"])
@jwt_required()
def update_password():
    user_id = get_jwt_identity()
    data = request.get_json()
    old_password = data.get("old_password")
    new_password = data.get("new_password")
    if not old_password or not new_password:
        return jsonify({"error": "请填写旧密码和新密码"}), 400

    UserRepository.update_password(user_id, old_password, new_password)
    return {"success": True}


@user_bp.route("/api/v1/subaccounts", methods=["POST"])
@jwt_required()
@handle_exceptions
def create_subaccount():
    user_id = get_jwt_identity()
    data = request.get_json()
    account = user_service.create_subaccount(user_id, data)
    return jsonify({"success": True, "data": account})


@user_bp.route("/api/v1/subaccounts", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_subaccounts():
    user_id = get_jwt_identity()
    accounts = user_service.get_subaccounts(user_id)
    return jsonify({"success": True, "data": accounts})


@user_bp.route("/api/v1/subaccounts/<account_id>", methods=["DELETE"])
@jwt_required()
@handle_exceptions
def delete_subaccount(account_id):
    user_id = get_jwt_identity()
    subaccount = UserRepository.get_user_by_id(user_id=account_id)
    if subaccount.role != "subaccount" or subaccount.parent_id != user_id:
        return jsonify({"error": "该用户不是子账户"}), 400
    user_service.delete_subaccount(user_id, account_id)
    return jsonify({"success": True})


@user_bp.route("/api/v1/subaccounts/<account_id>", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_subaccount(account_id):
    with smart_transaction():
        user_id = get_jwt_identity()
        subaccount = UserRepository.get_user_by_id(account_id)
        data = request.get_json()
        if not subaccount or subaccount.role != "subaccount":
            return jsonify({"error": "该用户不存在"}), 400
        if user_id != account_id and user_id != subaccount.parent_id:
            return jsonify({"error": "无权限"}), 400

        fields = ["nickname", "email", "phone"]
        for field in fields:
            if field in data:
                setattr(subaccount, field, data[field])
        if user_id != account_id:
            if "password" in data:
                subaccount.set_password(data["password"])
    return jsonify({"success": True})
