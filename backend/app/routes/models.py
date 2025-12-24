from fastapi import APIRouter, Depends, Request
from app.dependencies import get_model_service, get_current_user
from app.schemas.common import PaginatedResponse
from app.services.model_service import ModelService
from app.models.user import User
from app.schemas.model import ModelOut
from app.schemas.model_provider import ModelProviderOut


models_router = APIRouter(prefix="/api/v1")


@models_router.get("/models", response_model=PaginatedResponse[ModelProviderOut])
async def get_models(
    model_service: ModelService = Depends(get_model_service),
    current_user: User = Depends(get_current_user),
):
    models = await model_service.get_models_and_providers(current_user)
    return models


@models_router.delete("/models/{model_id}")
async def delete_model(
    model_id: str, model_service: ModelService = Depends(get_model_service)
):
    await model_service.delete_model(model_id)


@models_router.post("/models", response_model=ModelOut)
async def create_model(
    request: Request, model_service: ModelService = Depends(get_model_service)
):
    request_data = await request.json()
    fields = [
        "model_name",
        "model_type",
        "provider_id",
        "name",
        "features",
        "max_tokens",
        "max_output_tokens",
    ]
    data = {field: request_data.get(field) for field in fields}
    return await model_service.add_model(**data)


@models_router.put("/models/{model_id}", response_model=ModelOut)
async def update_model(
    model_id: str,
    request: Request,
    model_service: ModelService = Depends(get_model_service),
):
    request_data = await request.json()
    fields = [
        "model_name",
        "model_type",
        "name",
        "features",
        "max_tokens",
        "max_output_tokens",
    ]
    data = {field: request_data.get(field) for field in fields}
    return await model_service.update_model(model_id, data)


@models_router.post("/providers", response_model=ModelProviderOut)
async def create_provider(
    request: Request,
    model_service: ModelService = Depends(get_model_service),
    current_user: User = Depends(get_current_user),
):
    request_data = await request.json()
    fields = [
        "name",
        "api_key",
        "api_url",
    ]
    data = {field: request_data.get(field) for field in fields}
    return await model_service.add_provider(current_user, **data)


@models_router.put("/providers/{provider_id}", response_model=ModelProviderOut)
async def update_provider(
    provider_id: str,
    request: Request,
    model_service: ModelService = Depends(get_model_service),
):
    request_data = await request.json()
    fields = [
        "name",
        "api_key",
        "api_url",
    ]
    data = {field: request_data.get(field) for field in fields}
    return await model_service.update_provider(provider_id, data)


@models_router.delete("/providers/{provider_id}")
async def delete_provider(
    provider_id: str, model_service: ModelService = Depends(get_model_service)
):
    await model_service.delete_provider(provider_id)


@models_router.get("/providers/{provider_id}/remote_models")
async def get_provider_remote_models(
    provider_id: str,
    model_service: ModelService = Depends(get_model_service),
    current_user: User = Depends(get_current_user),
):
    return await model_service.get_provider_remote_models(
        current_user, provider_id=provider_id
    )
