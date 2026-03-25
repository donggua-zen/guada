from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any

from app.database import get_db_session
from app.dependencies import get_settings_service
from app.services.settings_manager import SettingsManager

settings_router = APIRouter(prefix="/api/v1", tags=["settings"])


# async def get_settings_service(db_session: AsyncSession = Depends(get_db_session)):
#     return SettingsManager(db_session)


@settings_router.get("/settings")
async def get_settings(
    settings_service: SettingsManager = Depends(get_settings_service),
):
    settings = {
        "default_chat_model_id": settings_service.get("default_chat_model_id", None),
        "default_search_model_id": settings_service.get(
            "default_search_model_id", None
        ),
        "default_summary_model_id": settings_service.get(
            "default_summary_model_id", None
        ),
        "search_prompt_context_length": settings_service.get(
            "search_prompt_context_length", 10
        ),
        "search_api_key": settings_service.get("search_api_key", ""),
        "summary_model_id": settings_service.get("summary_model_id", None),
        "summary_prompt": settings_service.get("summary_prompt", ""),
        # 新增的默认模型设置
        "default_title_summary_model_id": settings_service.get("default_title_summary_model_id", None),
        "default_title_summary_prompt": settings_service.get("default_title_summary_prompt", ""),
        "default_translation_model_id": settings_service.get("default_translation_model_id", None),
        "default_translation_prompt": settings_service.get("default_translation_prompt", ""),
        "default_history_compression_model_id": settings_service.get("default_history_compression_model_id", None),
        "default_history_compression_prompt": settings_service.get("default_history_compression_prompt", ""),
    }
    return settings


@settings_router.put("/settings")
async def update_settings(
    request_data: dict[str, Any],
    settings_service: SettingsManager = Depends(get_settings_service),
):
    settings = {
        "default_chat_model_id": request_data.get("default_chat_model_id", None),
        "default_search_model_id": request_data.get("default_search_model_id", None),
        "default_summary_model_id": request_data.get("default_summary_model_id", None),
        "search_prompt_context_length": request_data.get(
            "search_prompt_context_length", 10
        ),
        "search_api_key": request_data.get("search_api_key", ""),
        "summary_model_id": request_data.get("summary_model_id", None),
        "summary_prompt": request_data.get("summary_prompt", ""),
        # 新增的默认模型设置
        "default_title_summary_model_id": request_data.get("default_title_summary_model_id", None),
        "default_title_summary_prompt": request_data.get("default_title_summary_prompt", ""),
        "default_translation_model_id": request_data.get("default_translation_model_id", None),
        "default_translation_prompt": request_data.get("default_translation_prompt", ""),
        "default_history_compression_model_id": request_data.get("default_history_compression_model_id", None),
        "default_history_compression_prompt": request_data.get("default_history_compression_prompt", ""),
    }

    for key, value in settings.items():
        settings_service.set(key, value)
    await settings_service.save()
    await settings_service.load()
    return settings_service.get_all()
