import logging
from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import jwt_required
import app
from app.services import SummaryService
from app.services import MessageService
from app.services import SessionService
from app.utils.decorators import handle_exceptions
from app.utils.vector_memory import get_vector_memory

vector_memory = get_vector_memory()
message_service = MessageService()
summary_service = SummaryService()
session_service = SessionService()

messages_bp = Blueprint("messages", __name__)

logger = logging.getLogger(__name__)


@messages_bp.route("/api/v1/sessions/<session_id>/messages", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_messages(session_id):
    messages = message_service.get_messages(session_id=session_id)

    for message in messages:
        if "files" in message:
            for file in message["files"]:
                file.pop("content")

    return jsonify({"success": True, "data": {"items": messages}})


@messages_bp.route("/api/v1/sessions/<session_id>/messages", methods=["DELETE"])
@jwt_required()
@handle_exceptions
def clear_session_messages(session_id):
    message_service.delete_messages_by_session_id(session_id)
    summary_service.delete_summary_by_session_id(session_id)
    vector_memory.delete_session_memories(session_id)
    return jsonify({"success": True})


@messages_bp.route("/api/v1/messages/<message_id>", methods=["DELETE"])
@jwt_required()
@handle_exceptions
def delete_message(message_id):
    message_service.delete_message(message_id)
    vector_memory.delete_memory_by_message_id(message_id)
    return jsonify({"success": True})


@messages_bp.route("/api/v1/messages/<message_id>", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_message(message_id):
    message_service.update_message(message_id, {"content": request.json["content"]})
    return jsonify({"success": True})


@messages_bp.route("/api/v1/sessions/<session_id>/messages", methods=["POST"])
@jwt_required()
@handle_exceptions
def add_message(session_id):
    # 添加新消息到完整历史
    message = message_service.add_message(
        session_id=session_id,
        role="user",
        content=request.json.get("content", ""),
        files=request.json.get("files", []),
        replace_message_id=request.json.get("replace_message_id", None),
        parent_id=None,
    )
    return jsonify({"success": True, "data": message})


@messages_bp.route("/api/v1/message-content/<content_id>/active", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_message_active_content(content_id):
    message_id = request.json["message_id"]
    message_service.set_message_current_content(
        message_id=message_id, content_id=content_id
    )
    return jsonify({"success": True})


@messages_bp.route("/api/v1/sessions/<session_id>/messages/import", methods=["POST"])
@jwt_required()
@handle_exceptions
def import_messages(session_id):
    messages = request.json
    message_service.import_messages(session_id, messages)
    return jsonify({"success": True})
