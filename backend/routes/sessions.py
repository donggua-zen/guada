import datetime
import os
from flask import Blueprint, jsonify, request
from services import (
    character_service,
    message_service,
    session_service,
    vector_memory,
    summary_service,
)

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.route("/v1/sessions", methods=["GET"])
def get_sessions():
    return jsonify(
        {"success": True, "data": {"items": session_service.get_all_sessions()}}
    )


@sessions_bp.route("/v1/sessions_", methods=["POST"])
def create_or_get_sessions():
    try:
        character = character_service.get_character_by_id(request.json["character_id"])

        data = session_service.create_or_resume_session(
            user_id=request.json["user_id"],
            character_id=request.json["character_id"],
            name=character["title"],
        )
        if data is None:
            return jsonify(
                {"success": False, "error": "Failed to create or resume session."}
            )

        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions", methods=["POST"])
def create_sessions():
    try:

        session_data = {
            "title": request.json["title"] if "title" in request.json else "",
            "user_id": "123",
            "avatar_url": "",
            "description": "An helpful AI assistant",
            "settings": {
                "memory_type": "sliding_window",
                "model_id": "",
                "system_prompt": "You are a helpful AI assistant that can answer any question asked by the user",
            },
        }
        if "character_id" in request.json:
            character = character_service.get_character_by_id(
                request.json["character_id"]
            )
            session_data["title"] = character["title"]
            session_data["avatar_url"] = character["avatar_url"]
            session_data["description"] = character["description"]

            fields = [
                "assistant_name",
                "assistant_identity",
                "system_prompt",
                "memory_type",
                "max_memory_length",
                "short_term_memory_length",
            ]
            if "settings" in character:
                for field in fields:
                    if field in character["settings"]:
                        session_data["settings"][field] = character["settings"][field]

        data = session_service.add_new_session(session_data)
        if data is None:
            return jsonify(
                {"success": False, "error": "Failed to create or resume session."}
            )

        # 拷贝头像
        avatar_path = character["avatar_url"]
        if avatar_path.startswith("/static/avatars/") and os.path.exists(
            "." + avatar_path
        ):
            source_file_path = "." + avatar_path
            target_file_path = "." + "/static/avatars/session-" + data["id"] + ".png"
            with open(source_file_path, "rb") as source_file:
                with open(target_file_path, "wb") as target_file:
                    target_file.write(source_file.read())

        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    try:
        session_service.delete_session(session_id)
        message_service.delete_messages_by_session_id(session_id)
        vector_memory.delete_session_memories(session_id)
        summary_service.delete_summary_by_session_id(session_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>", methods=["GET"])
def get_session(session_id):
    try:
        data = session_service.query_session(session_id=session_id)
        if len(data) == 0:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Session with ID {session_id} not found.",
                    }
                ),
                404,
            )
        if "memory_type" not in data[0] or data[0]["memory_type"] == "":
            data[0]["memory_type"] = "sliding_window"
        return jsonify({"success": True, "data": data[0]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@sessions_bp.route("/v1/sessions/<session_id>", methods=["PUT"])
def update_session(session_id):
    try:
        data = request.json
        data["updated_at"] = datetime.datetime.now(datetime.timezone.utc)
        session_service.update_session(session_id, request.json)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
