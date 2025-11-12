from flask import Blueprint, Response, jsonify, request
import app
from app.services import SummaryService
from app.services import MessageService
from app.services import SessionService
from app.utils.vector_memory import get_vector_memory

vector_memory = get_vector_memory()
message_service = MessageService()
summary_service = SummaryService()
session_service = SessionService()

messages_bp = Blueprint("messages", __name__)


@messages_bp.route("/v1/sessions/<session_id>/messages", methods=["GET"])
def get_messages(session_id):
    try:
        messages = message_service.get_messages(session_id=session_id)

        for message in messages:
            if "files" in message:
                for file in message["files"]:
                    file.pop("content")

        return jsonify({"success": True, "data": {"items": messages}})
    except Exception as e:
        print(e)
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/sessions/<session_id>/messages", methods=["DELETE"])
def clear_session_messages(session_id):
    try:
        message_service.delete_messages_by_session_id(session_id)
        summary_service.delete_summary_by_session_id(session_id)
        vector_memory.delete_session_memories(session_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/messages/<message_id>", methods=["DELETE"])
def delete_message(message_id):
    try:
        message_service.delete_message(message_id)
        vector_memory.delete_memory_by_message_id(message_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/messages/<message_id>", methods=["PUT"])
def update_message(message_id):
    try:
        message_service.update_message(message_id, {"content": request.json["content"]})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/sessions/<session_id>/messages", methods=["POST"])
def add_message(session_id):
    try:
        # 添加新消息到完整历史
        message = message_service.add_message(
            session_id=session_id,
            role="user",
            content=request.json.get("content", ""),
            parent_id=None,
        )

        return jsonify({"success": True, "data": message})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/message-content/<content_id>/active", methods=["PUT"])
def update_message_active_content(content_id):
    try:
        message_service.set_message_current_content(content_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
