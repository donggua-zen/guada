from app.models import db, Model, ModelProvider
from app.models.db_transaction import smart_transaction_manager
from app.repositories.model_repository import ModelRepository as ModelRepo


class ModelService:
    def __init__(self):
        pass

    def get_models_and_providers(self, user_id):
        models = []
        providers = []
        results = ModelRepo.get_providers_with_models(user_id=user_id)
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
            raise ValueError(f"Model with ID '{model_id}' not found.")

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
            raise ValueError(f"Model with ID '{model_id}' not found.")
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
            raise ValueError(f"Model with name '{model_name}' not found.")
        return model.to_dict()

    def get_provider_by_name(self, provider_name):
        provider = ModelRepo.get_provider_by_name(provider_name)
        if not provider:
            raise ValueError(f"Provider with name '{provider_name}' not found.")
        return provider.to_dict()
