from openai import OpenAI
from app.models.user import User
from app.exceptions import APIException
from app.repositories.model_repository import ModelRepository as ModelRepo
from app.schemas.common import PaginatedResponse
from app.schemas.model import ModelOut
from app.schemas.model_provider import ModelProviderOut


class ModelService:
    def __init__(self, model_repo: ModelRepo):
        self.model_repo = model_repo

    async def get_models_and_providers(self, user: User):
        user_id = user.id if user.role == "primary" else user.parent_id
        results = await self.model_repo.get_providers_with_models(user_id)
        return PaginatedResponse(items=[ModelProviderOut.model_validate(m) for m in results])

    async def get_providers(self):
        providers = await self.model_repo.get_providers()
        return PaginatedResponse(
            items=[ModelProviderOut.model_validate(p) for p in providers],
            size=len(providers),
        )

    async def delete_model(self, model_id):
        if not await self.model_repo.delete_model(model_id):
            raise APIException("Model not found", status_code=404)

    async def delete_provider(self, provider_id):
        await self.model_repo.delete_provider(provider_id)

    async def add_model(
        self,
        model_name,
        model_type,
        provider_id,
        name=None,
        features=None,
        max_tokens: int = None,
        max_output_tokens: int = None,
    ):
        model = await self.model_repo.add_model(
            model_name=model_name,
            model_type=model_type,
            name=name,
            provider_id=provider_id,
            features=features,
            max_tokens=max_tokens,
            max_output_tokens=max_output_tokens,
        )
        return model

    async def add_provider(self, user: User, name, api_key, api_url):
        provider = await self.model_repo.add_provider(
            user_id=user.id,
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        return provider

    async def get_model(self, model_id):
        model = await self.model_repo.get_model(model_id)
        if not model:
            raise APIException("Model not found", status_code=404)
        return model

    async def update_model(self, model_id, data):
        model = await self.model_repo.update_model(model_id, data)
        return model

    async def update_provider(self, provider_id, data):
        provider = await self.model_repo.update_provider(provider_id, data)
        return provider

    async def get_model_by_name(self, model_name, provider_name=None):
        model = await self.model_repo.get_model_by_name(model_name, provider_name)
        if not model:
            raise APIException("Model not found", status_code=404)
        return model

    async def get_provider_by_name(self, provider_name):
        provider = await self.model_repo.get_provider_by_name(provider_name)
        if not provider:
            raise APIException("Provider not found", status_code=404)
        return provider

    async def get_provider_remote_models(self, user: User, provider_id):
        provider = await self.model_repo.get_provider(provider_id=provider_id)
        if not provider or provider.user_id != user.id:
            raise APIException("Provider not found", status_code=404)
        api_key = provider.api_key
        api_url = provider.api_url
        client = OpenAI(base_url=api_url, api_key=api_key)

        try:
            # 获取模型列表
            models = client.models.list()

            # 提取模型信息并格式化
            model_list = []
            for model in models:
                model_data = {
                    "model_name": model.id,
                    "model_type": "text",  # 默认类型，可根据需要进一步分类
                    "features": [],  # 默认功能列表为空
                }
                model_list.append(model_data)

            return PaginatedResponse(
                items=[ModelOut.model_validate(m) for m in model_list],
                size=len(model_list),
            )
        except Exception as e:
            raise APIException(
                f"Failed to fetch models from provider: {str(e)}", status_code=500
            )
