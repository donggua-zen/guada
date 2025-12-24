from fastapi import APIRouter, Depends, Request
from app.dependencies import get_character_service, get_current_user
from app.schemas.avatar import AvatarOut
from app.schemas.character import CharacterItemOut, CharacterOut
from app.schemas.common import PaginatedResponse
from app.services import CharacterService
from app.models.user import User


characters_router = APIRouter(prefix="/api/v1")


@characters_router.get(
    "/characters", response_model=PaginatedResponse[CharacterItemOut]
)
async def get_characters(
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    return await character_service.get_characters(user_id=current_user.id)


@characters_router.get(
    "/shared/characters", response_model=PaginatedResponse[CharacterItemOut]
)
async def get_shared_characters(
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    return await character_service.get_shared_characters(current_user)


@characters_router.post("/characters", response_model=CharacterOut)
async def create_character(
    request: Request,
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    json_data = await request.json()
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

    data_filtered = {
        field: json_data.get(field) for field in fields if json_data.get(field)
    }

    for field in fields:
        if field not in json_data:
            raise Exception(f"Field '{field}' is required.")
    for field in extended_fields:
        if field not in json_data["settings"]:
            raise Exception(f"Field 'settings.{field}' is required.")

    return await character_service.create_character(
        user=current_user, data=data_filtered
    )


@characters_router.delete("/characters/{character_id}")
async def delete_character(
    character_id: str,
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    await character_service.delete_character(character_id, user=current_user)


@characters_router.put("/characters/{character_id}", response_model=CharacterOut)
async def update_character(
    character_id: str,
    request: Request,
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    request_data = await request.json()
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
    return await character_service.update_character(
        character_id, user=current_user, data=data
    )


@characters_router.get("/characters/{character_id}", response_model=CharacterOut)
async def get_character(
    character_id: str,
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    return await character_service.get_character_by_id(character_id, user=current_user)


@characters_router.post("/characters/{character_id}/avatars", response_model=AvatarOut)
async def upload_character_avatar(
    character_id: str,
    request: Request,
    character_service: CharacterService = Depends(get_character_service),
    current_user: User = Depends(get_current_user),
):
    # 从request获取上传的文件
    form = await request.form()
    avatar_file = form.get("avatar")

    return await character_service.upload_avatar(
        character_id, user=current_user, avatar_file=avatar_file
    )
