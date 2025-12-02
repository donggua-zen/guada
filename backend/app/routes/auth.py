# auth.py
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from app.models.database import db
from app.models.user import User

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/v1/auth/register", methods=["POST"])
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


@auth_bp.route("/v1/auth/login", methods=["POST"])
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


@auth_bp.route("/v1/profile", methods=["GET"])
@jwt_required()
def profile():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    return jsonify(user.to_dict())
