import datetime
import os
from flask import Blueprint, jsonify, request

from app.services import CharacterService

character_service = CharacterService()


characters_bp = Blueprint("characters", __name__)


@characters_bp.route("/v1/characters", methods=["GET"])
def get_characters():
    try:
        all_characters = character_service.get_all_characters()

        characters = [
            {
                "id": char.get("id"),
                "title": char.get("title"),
                "description": char.get("description"),
                "avatar_url": char.get("avatar_url"),
            }
            for char in all_characters
        ]
        return jsonify({"success": True, "data": {"items": characters}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@characters_bp.route("/v1/characters", methods=["POST"])
def create_character():
    try:
        json_data = request.json
        fields = [
            "title",
            "description",
            "avatar_url",
            "settings",
        ]

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
            "use_user_prompt",
        ]

        for field in fields:
            if field not in json_data:
                return (
                    jsonify(
                        {"success": False, "error": f"Field '{field}' is required."}
                    ),
                    400,
                )
        for field in extended_fields:
            if field not in json_data["settings"]:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": f"Field 'settings.{field}' is required.",
                        }
                    ),
                    400,
                )

        # character = {field: json_data.get(field) for field in fields}
        character = character_service.create_character(json_data)
        return jsonify({"success": True, "data": character})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@characters_bp.route("/v1/characters/<character_id>", methods=["DELETE"])
def delete_character(character_id):
    try:
        character_service.delete_character(character_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@characters_bp.route("/v1/characters/<character_id>", methods=["PUT"])
def update_character(character_id):
    try:
        request_data = request.json
        fields = ["title", "description", "avatar_url", "settings"]

        data = {field: request_data.get(field) for field in fields}
        character_service.update_character(character_id, data)
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@characters_bp.route("/v1/characters/<character_id>", methods=["GET"])
def get_character(character_id):
    try:
        character = character_service.get_character_by_id(character_id)
        return jsonify({"success": True, "data": character})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@characters_bp.route("/v1/characters/<character_id>/avatars", methods=["POST"])
def upload_character_avatar(character_id):
    try:
        data = character_service.upload_avatar(character_id, request.files["avatar"])
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
