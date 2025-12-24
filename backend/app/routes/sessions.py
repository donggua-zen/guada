import datetime
from fastapi import APIRouter, Depends, Request
from app.dependencies import get_session_service, get_current_user
from app.schemas.common import PaginatedResponse
from app.services.session_service import SessionService
from app.models.user import User
from app.schemas.session import SessionItemOut, SessionOut
from app.utils.vector_memory import get_vector_memory


vector_memory = get_vector_memory()

sessions_router = APIRouter(prefix="/api/v1")


@sessions_router.get("/sessions", response_model=PaginatedResponse[SessionItemOut])
async def get_sessions(
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    sessions = await session_service.get_sessions(current_user)
    return sessions


@sessions_router.post("/sessions", response_model=SessionOut)
async def create_session(
    request: Request,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    json_data = await request.json()
    settings = json_data.get("settings", {})
    session_data = {
        "title": json_data.get("title", ""),
        "character_id": json_data.get("character_id", None),
        "avatar_url": "",
        "description": "An helpful AI assistant",
        "model_id": json_data.get("model_id", None),
        "settings": {
            "memory_type": "sliding_window",
            "system_prompt": "You are a helpful AI assistant that can answer any question asked by the user",
            "thinking_enabled": settings.get("thinking_enabled", False),
            "web_search_enabled": settings.get("web_search_enabled", False),
        },
    }

    data = await session_service.create_session(current_user, session_data)

    if data is None:
        raise Exception("Failed to create or resume session.")
    return data


@sessions_router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    await session_service.delete_session(session_id, current_user)
    vector_memory.delete_session_memories(session_id)


@sessions_router.get("/sessions/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: str,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    data = await session_service.get_session(session_id, current_user)
    if not data:
        raise Exception(f"Session with ID {session_id} not found.")
    return data


@sessions_router.put("/sessions/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: str,
    request: Request,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    data = await request.json()
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
    return await session_service.update_session(session_id, current_user, data_filtered)


@sessions_router.post("/sessions/{session_id}/avatars")
async def upload_session_avatar(
    session_id: str,
    request: Request,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    form = await request.form()
    avatar_file = form.get("avatar")
    return await session_service.upload_avatar(session_id, current_user, avatar_file)
