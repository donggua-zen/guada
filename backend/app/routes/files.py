from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from app.utils.decorators import handle_response


files_bp = Blueprint("files", __name__)


@files_bp.route("/api/v1/sessions/<sessions_id>/files", methods=["POST"])
@jwt_required()
@handle_response
def upload_message_file(sessions_id):
    from app.services.file_service import FileService

    file_service = FileService()

    # 检查是否有文件上传
    if "file" not in request.files:
        raise Exception("没有上传文件")

    file = request.files["file"]

    # 检查文件名
    if file.filename == "":
        raise Exception("未选择文件")

    file_info = file_service.upload_message_file(sessions_id, file)

    # 删除返回数据中的content字段
    file_info.pop("content", None)

    return file_info


@files_bp.route("/api/v1/files/<file_id>", methods=["PUT"])
@jwt_required()
@handle_response
def update_message_file(file_id):
    from app.services.file_service import FileService

    file_service = FileService()

    message_id = request.json.get("message_id")
    type = request.json.get("type", "copy")
    if type == "copy":
        file_info = file_service.copy_message_file(file_id, message_id)
        return file_info
    else:
        raise Exception("不支持的type")
