from flask import Blueprint, request
from app.utils.decorators import handle_exceptions
from app.utils.settings_manager import SettingsManager

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/api/v1/settings", methods=["GET"])
@handle_exceptions
def get_settings():
    settings = {
        "default_chat_model_id": SettingsManager.get("default_chat_model_id", None),
        "default_search_model_id": SettingsManager.get("default_search_model_id", None),
        "default_summary_model_id": SettingsManager.get(
            "default_summary_model_id", None
        ),
        "search_prompt_context_length": SettingsManager.get(
            "search_prompt_context_length", 10
        ),
        "search_api_key": SettingsManager.get("search_api_key", ""),
        "summary_model_id": SettingsManager.get("summary_model_id", None),
        "summary_prompt": SettingsManager.get("summary_prompt", ""),
    }
    return settings


@settings_bp.route("/api/v1/settings", methods=["PUT"])
@handle_exceptions
def update_settings():
    settings = {
        "default_chat_model_id": request.json.get("default_chat_model_id", None),
        "default_search_model_id": request.json.get("default_search_model_id", None),
        "default_summary_model_id": request.json.get("default_summary_model_id", None),
        "search_prompt_context_length": request.json.get(
            "search_prompt_context_length", 10
        ),
        "search_api_key": request.json.get("search_api_key", ""),
        "summary_model_id": request.json.get("summary_model_id", None),
        "summary_prompt": request.json.get("summary_prompt", ""),
    }
    for key, value in settings.items():
        SettingsManager.set(key, value)
