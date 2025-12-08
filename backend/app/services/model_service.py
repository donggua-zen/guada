from openai import OpenAI
from app.exceptions import APIException
from app.models import db, Model, ModelProvider
from app.models.db_transaction import smart_transaction_manager
from app.repositories.model_repository import ModelRepository as ModelRepo
from app.repositories.user_repository import UserRepository


class ModelService:
    def __init__(self):
        pass

    def get_models_and_providers(self, user_id):
        models = []
        providers = []
        user = UserRepository.get_user_by_id(user_id)
        models_user_id = user_id if user.role == "primary" else user.parent_id
        results = ModelRepo.get_providers_with_models(user_id=models_user_id)
        for result in results:
            models.extend([model.to_dict() for model in result.models])
            providers.append(result.to_dict())
        return {
            "models": models,
            "providers": providers,
        }

    def get_models(self):
        models = ModelRepo.get_models()
        return [model.to_dict() for model in models]

    def get_providers(self):
        providers = ModelRepo.get_providers()
        return [provider.to_dict() for provider in providers]

    def delete_model(self, model_id):
        if not ModelRepo.delete_model(model_id):
            raise APIException("Model not found", status_code=404)

    def delete_provider(self, provider_id):
        ModelRepo.delete_provider(provider_id)

    def add_model(
        self,
        model_name,
        model_type,
        provider_id,
        name=None,
        features=None,
        max_tokens: int = None,
        max_output_tokens: int = None,
    ):
        model = ModelRepo.add_model(
            model_name=model_name,
            model_type=model_type,
            name=name,
            provider_id=provider_id,
            features=features,
            max_tokens=max_tokens,
            max_output_tokens=max_output_tokens,
        )
        return model.to_dict()

    def add_provider(self, user_id, name, api_key, api_url):
        provider = ModelRepo.add_provider(
            user_id=user_id,
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        return provider.to_dict()

    def get_model(self, model_id):
        model = ModelRepo.get_model(model_id)
        if not model:
            raise APIException("Model not found", status_code=404)
        return model.to_dict()

    def update_model(self, model_id, data):
        model = ModelRepo.update_model(model_id, data)
        return model.to_dict()

    def update_provider(self, provider_id, data):
        provider = ModelRepo.update_provider(provider_id, data)
        return provider.to_dict()

    def get_model_by_name(self, model_name, provider_name=None):
        model = ModelRepo.get_model_by_name(model_name, provider_name)
        if not model:
            raise APIException("Model not found", status_code=404)
        return model.to_dict()

    def get_provider_by_name(self, provider_name):
        provider = ModelRepo.get_provider_by_name(provider_name)
        if not provider:
            raise APIException("Provider not found", status_code=404)
        return provider.to_dict()

    def get_provider_remote_models(self, user_id, provider_id):
        provider = ModelRepo.get_provider(provider_id=provider_id)
        if not provider or provider.user_id != user_id:
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

            return {"items": model_list}
        except Exception as e:
            raise APIException(
                f"Failed to fetch models from provider: {str(e)}", status_code=500
            )
