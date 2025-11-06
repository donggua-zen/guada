import datetime
import os
from flask import Blueprint, jsonify, request


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
        upload_folder = os.path.join("app", "static", "avatars")  # 更规范的路径构建
        allowed_extensions = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"}

        # 确保上传目录存在
        os.makedirs(upload_folder, exist_ok=True)

        def allowed_file(filename):
            return (
                "." in filename
                and filename.rsplit(".", 1)[1].lower() in allowed_extensions
            )

        # 检查文件类型
        if file and allowed_file(file.filename):
            # 生成唯一文件名
            unique_filename = f"{type}-{uid}.jpg"
            # 保存文件
            file_path = os.path.join(upload_folder, unique_filename)

            try:
                from PIL import Image

                # 打开图片并转换为RGB模式(去除alpha通道)
                image = Image.open(file)
                if image.mode in ("RGBA", "LA", "P"):
                    # 如果图片有透明通道，转换为RGB并添加白色背景
                    background = Image.new("RGB", image.size, (255, 255, 255))
                    if image.mode == "P":
                        image = image.convert("RGBA")
                    background.paste(
                        image, mask=image.split()[-1] if image.mode == "RGBA" else None
                    )
                    image = background
                elif image.mode != "RGB":
                    image = image.convert("RGB")

                # 保存为JPEG格式
                image.save(file_path, "JPEG", quality=95)
            except ImportError:
                # 如果没有安装PIL，则直接保存原文件
                file.save(file_path)
            except Exception as e:
                # 图片处理出错时尝试直接保存
                file.save(file_path)

            # 生成访问URL
            avatar_url = f"/static/avatars/{unique_filename}"

            from app.services.character_service import CharacterService
            from app.services.session_service import SessionService

            if type == "session":
                service = SessionService()
                service.update_session(uid, {"avatar_url": avatar_url})
            elif type == "character":
                service = CharacterService()
                service.update_character(uid, {"avatar_url": avatar_url})
            return jsonify({"success": True, "data": {"url": avatar_url}})
        else:
            return jsonify({"success": False, "error": "不支持的文件类型"}), 400

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


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
