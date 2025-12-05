import datetime
import os
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.services import CharacterService
from app.utils.decorators import handle_exceptions

character_service = CharacterService()


characters_bp = Blueprint("characters", __name__)


@characters_bp.route("/api/v1/characters", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_characters():
    user_id = get_jwt_identity()
    all_characters = character_service.get_characters(user_id=user_id)

    characters = [
        {
            "id": char.get("id"),
            "title": char.get("title"),
            "description": char.get("description"),
            "avatar_url": char.get("avatar_url"),
            "is_public": char.get("is_public"),
        }
        for char in all_characters
    ]
    return {"items": characters}


@characters_bp.route("/api/v1/shared/characters", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_shared_characters():
    user_id = get_jwt_identity()

    all_characters = character_service.get_shared_characters(user_id=user_id)

    characters = [
        {
            "id": char.get("id"),
            "title": char.get("title"),
            "description": char.get("description"),
            "avatar_url": char.get("avatar_url"),
            "is_public": char.get("is_public"),
        }
        for char in all_characters
    ]
    return {"items": characters}


@characters_bp.route("/api/v1/characters", methods=["POST"])
@jwt_required()
@handle_exceptions
def create_character():
    user_id = get_jwt_identity()
    json_data = request.json
    json_data["user_id"] = user_id
    fields = [
        "title",
        "description",
        "avatar_url",
        "model_id",
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
            raise Exception(f"Field '{field}' is required.")
    for field in extended_fields:
        if field not in json_data["settings"]:
            raise Exception(f"Field 'settings.{field}' is required.")

    # character = {field: json_data.get(field) for field in fields}
    character = character_service.create_character(json_data)
    return character


@characters_bp.route("/api/v1/characters/<character_id>", methods=["DELETE"])
@jwt_required()
@handle_exceptions
def delete_character(character_id):
    user_id = get_jwt_identity()
    character_service.delete_character(character_id, user_id=user_id)


@characters_bp.route("/api/v1/characters/<character_id>", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_character(character_id):
    request_data = request.json
    user_id = get_jwt_identity()
    fields = [
        "title",
        "description",
        "avatar_url",
        "model_id",
        "settings",
        "is_public",
    ]

    data = {
        field: request_data.get(field) for field in fields if request_data.get(field)
    }
    character_service.update_character(character_id, user_id=user_id, data=data)
    return data


@characters_bp.route("/api/v1/characters/<character_id>", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_character(character_id):
    user_id = get_jwt_identity()
    character = character_service.get_character_by_id(character_id, user_id=user_id)
    return character


@characters_bp.route("/api/v1/characters/<character_id>/avatars", methods=["POST"])
@jwt_required()
@handle_exceptions
def upload_character_avatar(character_id):
    user_id = get_jwt_identity()
    data = character_service.upload_avatar(
        character_id, user_id=user_id, avatar_file=request.files["avatar"]
    )
    return data
