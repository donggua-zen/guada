import datetime
import os
import shutil
from flask import Blueprint, jsonify, request
from app.services import SummaryService
from app.services import MessageService
from app.services import SessionService


session_service = SessionService()


from app.utils.vector_memory import get_vector_memory

vector_memory = get_vector_memory()

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.route("/v1/sessions", methods=["GET"])
def get_sessions():
    return jsonify(
        {"success": True, "data": {"items": session_service.get_all_sessions()}}
    )


@sessions_bp.route("/v1/sessions", methods=["POST"])
def create_session():
    try:
        session_data = {
            "title": request.json.get("title", ""),
            "character_id": request.json.get("character_id", None),
            "user_id": "123",  # TODO: 应该从认证信息中获取
            "avatar_url": "",
            "description": "An helpful AI assistant",
            "model_id": None,
            "settings": {
                "memory_type": "sliding_window",
                "system_prompt": "You are a helpful AI assistant that can answer any question asked by the user",
            },
        }

        data = session_service.create_session(session_data)

        if data is None:
            return jsonify(
                {"success": False, "error": "Failed to create or resume session."}
            )

        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    try:
        session_service.delete_session(session_id)
        vector_memory.delete_session_memories(session_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>", methods=["GET"])
def get_session(session_id):
    try:
        data = session_service.get_session_by_id(session_id)
        if not data:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Session with ID {session_id} not found.",
                    }
                ),
                404,
            )
        if "memory_type" not in data or data["memory_type"] == "":
            data["memory_type"] = "sliding_window"
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>", methods=["PUT"])
def update_session(session_id):
    try:
        data = request.json
        data["updated_at"] = datetime.datetime.now(datetime.timezone.utc)
        fields = ["title", "description", "avatar_url", "updated_at", "model_id"]

        extended_fields = [
            "assistant_name",
            "assistant_identity",
            "system_prompt",
            "memory_type",
            "max_memory_length",
            "max_memory_tokens",
            "short_term_memory_tokens",
            "model_top_p",
            "model_temperature",
            "model_id",
            "use_user_prompt",
            "web_search_enabled",
            "thinking_enabled",
        ]

        data_filtered = {}
        # 处理基础字段
        for field in fields:
            if field in data:
                data_filtered[field] = data[field]

        # 处理settings字段
        if "settings" in data:
            settings = {}
            for field in extended_fields:
                if field in data["settings"]:
                    settings[field] = data["settings"][field]
            data_filtered["settings"] = settings
        session_service.update_session(session_id, data_filtered)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>/avatars", methods=["POST"])
def upload_session_avatar(session_id):
    try:
        data = session_service.upload_avatar(session_id, request.files["avatar"])
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
