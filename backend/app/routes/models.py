from fastapi import APIRouter, Depends, Request
from app.dependencies import get_model_service, get_current_user
from app.schemas.common import PaginatedResponse
from app.services.model_service import ModelService
from app.models.user import User
from app.schemas.model import ModelCreate, ModelOut, ModelUpdate
from app.schemas.model_provider import (
    ModelProviderCreate,
    ModelProviderOut,
    ModelProviderUpdate,
)


models_router = APIRouter(prefix="/api/v1")


@models_router.get("/models", response_model=PaginatedResponse[ModelProviderOut])
async def get_models(
    model_service: ModelService = Depends(get_model_service),
    current_user: User = Depends(get_current_user),
):
    return await model_service.get_models_and_providers(current_user)


@models_router.delete("/models/{model_id}")
async def delete_model(
    model_id: str, model_service: ModelService = Depends(get_model_service)
):
    await model_service.delete_model(model_id)


@models_router.post("/models", response_model=ModelOut)
async def create_model(
    request: ModelCreate, model_service: ModelService = Depends(get_model_service)
):
    return await model_service.add_model(
        model_name=request.model_name,
        model_type=request.model_type,
        provider_id=request.provider_id,
        name=request.name,
        features=request.features,
        max_tokens=request.max_tokens,
        max_output_tokens=request.max_output_tokens,
    )


@models_router.put("/models/{model_id}", response_model=ModelOut)
async def update_model(
    model_id: str,
    request: ModelUpdate,
    model_service: ModelService = Depends(get_model_service),
):
    data = {
        "model_name": request.model_name,
        "model_type": request.model_type,
        "name": request.name,
        "features": request.features,
        "max_tokens": request.max_tokens,
        "max_output_tokens": request.max_output_tokens,
    }
    return await model_service.update_model(model_id, data)


@models_router.post("/providers", response_model=ModelProviderOut)
async def create_provider(
    request: ModelProviderCreate,
    model_service: ModelService = Depends(get_model_service),
    current_user: User = Depends(get_current_user),
):
    return await model_service.add_provider(
        current_user,
        name=request.name,
        api_key=request.api_key,
        api_url=request.api_url,
    )


@models_router.put("/providers/{provider_id}", response_model=ModelProviderOut)
async def update_provider(
    provider_id: str,
    request: ModelProviderUpdate,
    model_service: ModelService = Depends(get_model_service),
):
    data = {
        "name": request.name,
        "api_key": request.api_key,
        "api_url": request.api_url,
    }
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
