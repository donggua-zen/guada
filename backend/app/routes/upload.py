from flask import Blueprint, jsonify, request


upload_bp = Blueprint("upload", __name__)


@upload_bp.route("/v1/messages/<message_id>/files", methods=["POST"])
def upload_message_file(message_id):
    from app.services.file_service import FileService

    file_service = FileService()

    try:
        # 检查是否有文件上传
        if "file" not in request.files:
            return jsonify({"success": False, "error": "没有上传文件"}), 400

        file = request.files["file"]

        # 检查文件名
        if file.filename == "":
            return jsonify({"success": False, "error": "未选择文件"}), 400

        file_info = file_service.upload_message_file(message_id, file)

        # 删除返回数据中的content字段
        file_info.pop("content", None)

        return jsonify({"success": True, "data": file_info})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
