from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.utils.decorators import handle_exceptions


files_bp = Blueprint("files", __name__)


@files_bp.route("/api/v1/sessions/<sessions_id>/files", methods=["POST"])
@jwt_required()
@handle_exceptions
def upload_message_file(sessions_id):
    from app.services.file_service import FileService

    file_service = FileService()

    # 检查是否有文件上传
    if "file" not in request.files:
        return jsonify({"success": False, "error": "没有上传文件"}), 400

    file = request.files["file"]

    # 检查文件名
    if file.filename == "":
        return jsonify({"success": False, "error": "未选择文件"}), 400

    file_info = file_service.upload_message_file(sessions_id, file)

    # 删除返回数据中的content字段
    file_info.pop("content", None)

    return jsonify({"success": True, "data": file_info})


@files_bp.route("/api/v1/files/<file_id>", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_message_file(file_id):
    from app.services.file_service import FileService

    file_service = FileService()

    message_id = request.json.get("message_id")
    type = request.json.get("type", "copy")
    if type == "copy":
        file_info = file_service.copy_message_file(file_id, message_id)
        return jsonify({"success": True, "data": file_info})
    else:
        return jsonify({"success": False, "error": "不支持的type"}), 400
