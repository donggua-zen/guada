# 新增头像上传接口
import datetime
import os
from flask import Blueprint, jsonify, request

from app.services import session_service, character_service


upload_bp = Blueprint("upload", __name__)


@upload_bp.route("/v1/sessions/<session_id>/avatars", methods=["POST"])
def upload_session_avatar(session_id):
    return upload_avatar("session", session_id)


@upload_bp.route("/v1/characters/<character_id>/avatars", methods=["POST"])
def upload_character_avatar(character_id):
    return upload_avatar("character", character_id)


def upload_avatar(type: str, uid: str):
    try:
        # 检查是否有文件上传
        if "avatar" not in request.files:
            return jsonify({"success": False, "error": "没有上传文件"}), 400

        file = request.files["avatar"]

        # 检查文件名
        if file.filename == "":
            return jsonify({"success": False, "error": "未选择文件"}), 400

        # 添加头像上传配置
        upload_folder = "./static/avatars"
        allowed_extendsions = {"png", "jpg", "jpeg", "gif"}

        # 确保上传目录存在
        os.makedirs(upload_folder, exist_ok=True)

        def allowed_file(filename):
            return (
                "." in filename
                and filename.rsplit(".", 1)[1].lower() in allowed_extendsions
            )

        # 检查文件类型
        if file and allowed_file(file.filename):
            # 生成安全的文件名
            # filename = secure_filename(file.filename)
            # 生成唯一文件名
            file_extension = file.filename.rsplit(".", 1)[1].lower()
            unique_filename = f"{type}-{uid}.{file_extension}"
            # 保存文件
            file_path = os.path.join(upload_folder, unique_filename)
            file.save(file_path)

            # 生成访问URL
            avatar_url = f"/static/avatars/{unique_filename}"
            if type == "session":
                session_service.update_session(uid, {"avatar_url": avatar_url})
            else:
                character_service.update_character(uid, {"avatar_url": avatar_url})
            return jsonify({"success": True, "data": {"url": avatar_url}})
        else:
            return jsonify({"success": False, "error": "不支持的文件类型"}), 400

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
